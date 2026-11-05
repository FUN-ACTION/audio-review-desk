"""Production HTTP parsing/handlers with byte streams, never sockets or a listener."""
import http.client
import io
import json
from pathlib import Path
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from audio_review_desk.demo import write_wav
from audio_review_desk.server import make_server
from audio_review_desk.workspace import Workspace


class OriginTests(unittest.TestCase):
    def setUp(self):
        self.guard = patch.object(socket, 'socket', side_effect=AssertionError('No sockets'))
        self.blocked = self.guard.start()
        self.addCleanup(self.guard.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        write_wav(root / 'audio' / 'a.wav', seconds=.1)
        self.workspace = Workspace(root / 'workspace')
        self.workspace.scan(root / 'audio')

    def server(self, port):
        def fake(address, handler):
            self.assertEqual(address, ('127.0.0.1', port))
            return SimpleNamespace(server_port=address[1] or 46001,
                                   RequestHandlerClass=handler)
        with patch('audio_review_desk.server.ThreadingHTTPServer', fake):
            return make_server(self.workspace, port)

    def request(self, server, method, headers, body=None, path='/api/state'):
        # A list of pairs, not dict/urllib: duplicates survive real HTTPMessage parsing.
        headers = list(headers)
        data = b'' if body is None else json.dumps(body).encode()
        if body is not None:
            headers += [('Content-Type', 'application/json'), ('Content-Length', str(len(data)))]
        raw = (f'{method} {path} HTTP/1.1\r\n' + ''.join(f'{k}: {v}\r\n' for k, v in headers) + '\r\n').encode('ascii') + data
        handler = object.__new__(server.RequestHandlerClass)
        handler.server = server
        handler.client_address = ('127.0.0.1', 0)
        handler.rfile, handler.wfile = io.BytesIO(raw), io.BytesIO()
        handler.handle_one_request()
        if sum(k.lower() == 'host' for k, _ in headers) > 1:
            self.assertGreater(len(handler.headers.get_all('Host')), 1)
        if sum(k.lower() == 'origin' for k, _ in headers) > 1:
            self.assertGreater(len(handler.headers.get_all('Origin')), 1)
        response = http.client.HTTPResponse(SimpleNamespace(makefile=lambda *a: io.BytesIO(handler.wfile.getvalue())), method=method)
        response.begin()
        result = response.read()
        self.assertEqual(self.blocked.call_count, 0)
        return response.status, json.loads(result) if result else None

    def state(self, server):
        status, state = self.request(server, 'GET', [('Host', f'127.0.0.1:{server.server_port}')])
        self.assertEqual(status, 200)
        return state

    def payload(self, state):
        row = state['items'][0]
        return dict(key=row['key'], expected_version=row['review']['version'],
                    status='pass', score=0, issues=[], note='origin test')

    def dump(self):
        with self.workspace.connect() as db:
            return '\n'.join(db.iterdump())

    def test_port80_all_equivalent_pairs_save_and_head(self):
        server = self.server(80)
        for host in ['127.0.0.1', '127.0.0.1:80']:
            self.assertEqual(self.request(server, 'HEAD', [('Host', host)])[0], 200)
            for origin in ['http://127.0.0.1', 'http://127.0.0.1:80']:
                with self.subTest(host=host, origin=origin):
                    state = self.state(server)
                    status, _ = self.request(server, 'POST', [('Host', host), ('Origin', origin),
                        ('X-Review-Token', state['session'])], self.payload(state), '/api/review')
                    self.assertEqual(status, 200)
                    saved = self.state(server)['items'][0]['review']
                    self.assertEqual(saved['note'], 'origin test')
                    self.assertEqual(saved['version'], state['items'][0]['review']['version'] + 1)

    def test_other_and_assigned_ports_require_exact_port(self):
        for requested in [8765, 0]:
            server = self.server(requested)
            port = server.server_port
            self.assertNotEqual(port, 0)
            state = self.state(server)
            for host in ['127.0.0.1', '127.0.0.1:80', '127.0.0.1:0']:
                self.assertEqual(self.request(server, 'GET', [('Host', host)])[0], 403)
            for origin in ['http://127.0.0.1', 'http://127.0.0.1:80', 'http://127.0.0.1:0']:
                before = self.dump()
                self.assertEqual(self.request(server, 'POST', [('Host', f'127.0.0.1:{port}'),
                    ('Origin', origin), ('X-Review-Token', state['session'])], self.payload(state), '/api/review')[0], 403)
                self.assertEqual(self.dump(), before)
            self.assertEqual(self.request(server, 'POST', [('Host', f'127.0.0.1:{port}'),
                ('Origin', f'http://127.0.0.1:{port}'), ('X-Review-Token', state['session'])], self.payload(state), '/api/review')[0], 200)

    def test_host_variants_and_duplicates_are_rejected_without_writes(self):
        server = self.server(80); state = self.state(server)
        invalid = ['localhost', 'localhost:80', '127.0.0.2', '[::1]', '2130706433',
                   '127.1', '127.0.0.1.', '127.0.0.1:080', '127.0.0.1:8765',
                   'user@127.0.0.1', '127.0.0.1/path', '127.0.0.1, evil.example']
        cases = [[], *[[('Host', value)] for value in invalid],
                 [('Host','127.0.0.1'),('hOsT','evil.example')],
                 [('Host','evil.example'),('Host','127.0.0.1')],
                 [('Host','127.0.0.1'),('Host','127.0.0.1')]]
        for headers in cases:
            with self.subTest(headers=headers):
                before = self.dump()
                self.assertEqual(self.request(server, 'GET', headers)[0], 403)
                self.assertEqual(self.request(server, 'POST', headers + [('Origin','http://127.0.0.1'),
                    ('X-Review-Token',state['session'])], self.payload(state), '/api/review')[0],403)
                self.assertEqual(self.dump(), before)

    def test_origin_variants_and_duplicates_are_rejected_without_writes(self):
        server = self.server(80); state = self.state(server)
        invalid = ['null', 'https://127.0.0.1', 'http://localhost', 'http://127.0.0.2',
                   'http://2130706433', 'http://127.0.0.1.', 'http://127.0.0.1:080',
                   'http://127.0.0.1:8765', 'http://127.0.0.1/', 'http://user@127.0.0.1',
                   'http://127.0.0.1 http://evil.example', 'http://127.0.0.1, http://evil.example']
        cases = [[], *[[('Origin', value)] for value in invalid],
                 [('Origin','http://127.0.0.1'),('Origin','http://evil.example')],
                 [('Origin','http://evil.example'),('Origin','http://127.0.0.1')],
                 [('Origin','http://127.0.0.1'),('oRiGiN','http://127.0.0.1')]]
        for headers in cases:
            with self.subTest(headers=headers):
                before = self.dump()
                self.assertEqual(self.request(server, 'POST', [('Host','127.0.0.1')] + headers +
                    [('X-Review-Token',state['session'])], self.payload(state), '/api/review')[0],403)
                self.assertEqual(self.dump(), before)

    def test_missing_and_stale_token_remain_forbidden(self):
        server = self.server(80); state = self.state(server)
        for token in [[], [('X-Review-Token','stale')]]:
            before = self.dump()
            status, result = self.request(server,'POST',[('Host','127.0.0.1'),('Origin','http://127.0.0.1')] + token,self.payload(state),'/api/review')
            self.assertEqual(status,403); self.assertEqual(result['code'],'reload_required')
            self.assertEqual(self.dump(),before)

    def test_forwarding_headers_cannot_authorize_other_host_or_origin(self):
        server = self.server(80); state = self.state(server)
        forwarded = [('Forwarded','host=127.0.0.1;proto=http'),('X-Forwarded-Host','127.0.0.1'),
                     ('X-Forwarded-Proto','http'),('X-Forwarded-Port','80')]
        for host, origin in [('evil.example','http://127.0.0.1'),('127.0.0.1','http://evil.example')]:
            before = self.dump()
            self.assertEqual(self.request(server,'POST',[('Host',host),('Origin',origin),
                ('X-Review-Token',state['session'])]+forwarded,self.payload(state),'/api/review')[0],403)
            self.assertEqual(self.dump(),before)
