"""Socket substitutes exercise production setup/handle; no TCP timing claims."""
import io
import http.client
from pathlib import Path
from types import SimpleNamespace
from audio_review_desk.demo import write_wav
import json
import unittest
from unittest.mock import patch
import test_server_origin


class Input(io.BytesIO):
    def __init__(self, data, failure=None):
        super().__init__(data)
        self.failure = failure
        self.lines = 0

    def readline(self, *args):
        self.lines += 1
        if self.failure == 'request' or self.failure == 'headers' and self.lines == 3:
            raise TimeoutError('synthetic read timeout')
        return super().readline(*args)

    def read(self, *args):
        if self.failure == 'body':
            raise TimeoutError('synthetic body timeout')
        return super().read(*args)


class SocketDouble:
    def __init__(self, raw, failure=None, write_failure=None):
        self.input = Input(raw, failure)
        self.timeouts = []
        self.output = bytearray()
        self.writes = 0
        self.write_failure = write_failure

    def settimeout(self, value):
        self.timeouts.append(value)

    def makefile(self, *args):
        return self.input

    def sendall(self, data):
        self.writes += 1
        if self.write_failure and self.writes == self.write_failure[0]:
            # Model a partial send, not an all-or-nothing write guarantee.
            self.output.extend(bytes(data)[:7])
            raise self.write_failure[1]('synthetic send failure')
        self.output.extend(data)


class ConnectionTests(unittest.TestCase):
    setUp = test_server_origin.OriginTests.setUp
    server = test_server_origin.OriginTests.server
    request = test_server_origin.OriginTests.request
    state = test_server_origin.OriginTests.state
    payload = test_server_origin.OriginTests.payload
    dump = test_server_origin.OriginTests.dump

    def prepare(self, method='GET', path='/api/state', body=None, **options):
        server = self.server(8765)
        state = self.state(server)
        data = b'' if body is None else json.dumps(body).encode()
        headers = [('Host','127.0.0.1:8765'),('Origin','http://127.0.0.1:8765'),
                   ('X-Review-Token',state['session']),('Content-Type','application/json'),
                   ('Content-Length',str(len(data)))]
        raw=(f'{method} {path} HTTP/1.1\r\n'+''.join(f'{k}: {v}\r\n' for k,v in headers)+'\r\n').encode()+data
        connection = SocketDouble(raw, **options)
        handler = object.__new__(server.RequestHandlerClass)
        handler.request = connection
        handler.server = server
        handler.client_address = ('127.0.0.1',0)
        handler.setup()
        self.assertEqual(connection.timeouts,[30])
        return handler, connection

    def run_handler(self, handler, connection):
        try:
            handler.handle()
        finally:
            handler.finish()
        self.assertTrue(handler.close_connection)
        self.assertEqual(self.blocked.call_count,0)
        self.assertTrue(connection.input.closed)
        return bytes(connection.output)

    def test_request_header_and_body_timeouts_close_without_response_or_write(self):
        payload=self.payload(self.state(self.server(8765)))
        for failure in ['request','headers','body']:
            with self.subTest(failure=failure):
                before=self.dump()
                h,c=self.prepare('POST','/api/review',payload,failure=failure)
                self.assertEqual(self.run_handler(h,c),b'')
                self.assertEqual(self.dump(),before)

    def test_response_header_and_json_send_failures_never_append_error_response(self):
        for call in [1,2]:
            for error in [TimeoutError,BrokenPipeError,ConnectionResetError,ConnectionAbortedError,OSError]:
                with self.subTest(call=call,error=error):
                    h,c=self.prepare(write_failure=(call,error))
                    wire=self.run_handler(h,c)
                    self.assertEqual(c.writes,call)
                    self.assertLessEqual(wire.count(b'HTTP/1.0'),1)
                    self.assertNotIn(b'Audio file unavailable',wire)
                    self.assertNotIn(b'Could not read workspace',wire)

    def test_committed_save_survives_response_failure_without_retry(self):
        for error in [TimeoutError,BrokenPipeError]:
            state=self.state(self.server(8765)); payload=self.payload(state)
            h,c=self.prepare('POST','/api/review',payload,write_failure=(2,error))
            with patch.object(self.workspace,'save_review',wraps=self.workspace.save_review) as save:
                wire=self.run_handler(h,c)
            self.assertEqual(save.call_count,1)
            saved=self.workspace.state()['items'][0]['review']
            self.assertEqual(saved['version'],state['items'][0]['review']['version']+1)
            self.assertEqual(saved['note'],payload['note'])
            self.assertEqual(c.writes,2)
            self.assertNotIn(b'Save failed',wire)

    def test_preview_range_is_unchanged_and_stream_failure_does_not_emit_json(self):
        key=self.state(self.server(8765))['items'][0]['key']
        for error in [None,TimeoutError,ConnectionResetError]:
            h,c=self.prepare(path=f'/media/{key}/a.wav',write_failure=(2,error) if error else None)
            # Inject through the real parsed request, not handler.headers.
            raw=c.input.getvalue().replace(b'Host:',b'Range: bytes=0-15\r\nHost:',1)
            c.input.seek(0);c.input.write(raw);c.input.truncate();c.input.seek(0)
            wire=self.run_handler(h,c)
            self.assertIn(b'HTTP/1.0 206',wire)
            self.assertIn(b'Content-Length: 16',wire)
            if error:self.assertEqual(c.writes,2)
            else:self.assertEqual(len(wire.split(b'\r\n\r\n',1)[1]),16)
            self.assertNotIn(b'Audio file unavailable',wire)

    def test_business_timeout_is_not_misclassified_as_connection_failure(self):
        h,c=self.prepare()
        with patch.object(self.workspace,'state',side_effect=TimeoutError('synthetic file timeout')):
            wire=self.run_handler(h,c)
        self.assertIn(b'HTTP/1.0 422',wire)
        self.assertIn(b'Audio file unavailable',wire)

    def test_file_failure_after_headers_cannot_start_a_second_response(self):
        key=self.state(self.server(8765))['items'][0]['key']
        h,c=self.prepare(path=f'/media/{key}/a.wav')
        # Avoid interfering with preview preparation: inject at actual file open.
        path=self.workspace.preview(key,'a')
        with patch.object(self.workspace,'preview',return_value=path), patch.object(type(path),'open',side_effect=OSError('synthetic disk failure')):
            wire=self.run_handler(h,c)
        self.assertEqual(wire.count(b'HTTP/1.0'),1)
        self.assertEqual(c.writes,1)
        self.assertNotIn(b'Audio file unavailable',wire)

    def test_business_work_has_no_socket_deadline_wrapper(self):
        h,c=self.prepare()
        original=self.workspace.state
        def work():
            # A bounded synthetic calculation; deliberately no timing assertion.
            self.assertEqual(sum(range(10000)),49995000)
            return original()
        with patch.object(self.workspace,'state',side_effect=work) as state:
            wire=self.run_handler(h,c)
        self.assertEqual(state.call_count,1)
        self.assertIn(b'HTTP/1.0 200',wire)
        self.assertEqual(c.timeouts,[30])

    def test_flush_timeout_closes_after_one_response_without_second_json(self):
        h,c=self.prepare()
        stream=h.wfile.stream
        # Production ConnectionStream wraps this exact flush boundary. The
        # normal unbuffered socket writer seldom blocks here; this is defensive.
        calls = 0
        def fail_request_flush_once():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise TimeoutError('synthetic flush timeout')
        with patch.object(stream,'flush',side_effect=fail_request_flush_once) as flush:
            wire=self.run_handler(h,c)
        self.assertGreaterEqual(flush.call_count,1)
        self.assertEqual(wire.count(b'HTTP/1.0'),1)
        self.assertIn(b'HTTP/1.0 200',wire)
        self.assertEqual(c.writes,2)
        self.assertNotIn(b'Could not read workspace',wire)
        self.assertNotIn(b'Audio file unavailable',wire)

    def test_multiblock_preview_get_range_and_head_preserve_exact_bytes(self):
        # Only substitute preview resolution with a test-owned WAV. Production
        # setup, connection wrappers, HTTP parsing and stream serving all run.
        path = Path(self.temp.name) / 'multiblock.wav'
        write_wav(path, seconds=5)
        expected = path.read_bytes()
        self.assertGreater(len(expected), 2 * 65536)
        key = self.state(self.server(8765))['items'][0]['key']
        start, end = 65530, 131080
        for method, ranged in [('GET', False), ('GET', True), ('HEAD', True)]:
            with self.subTest(method=method, ranged=ranged):
                handler, connection = self.prepare(method, f'/media/{key}/a.wav')
                if ranged:
                    raw = connection.input.getvalue().replace(
                        b'Host:', f'Range: bytes={start}-{end}\r\nHost:'.encode(), 1)
                    connection.input.seek(0)
                    connection.input.write(raw)
                    connection.input.truncate()
                    connection.input.seek(0)
                before = self.dump()
                with patch.object(self.workspace, 'preview', return_value=path):
                    wire = self.run_handler(handler, connection)
                response = http.client.HTTPResponse(SimpleNamespace(
                    makefile=lambda *args: io.BytesIO(wire)), method=method)
                response.begin()
                body = response.read()
                selected = expected[start:end + 1] if ranged else expected
                self.assertEqual(response.status, 206 if ranged else 200)
                self.assertEqual(int(response.getheader('Content-Length')), len(selected))
                self.assertEqual(response.getheader('Content-Type'), 'audio/wav')
                self.assertEqual(response.getheader('Accept-Ranges'), 'bytes')
                self.assertEqual(response.getheader('Content-Range'),
                    f'bytes {start}-{end}/{len(expected)}' if ranged else None)
                self.assertEqual(body, b'' if method == 'HEAD' else selected)
                # Check raw bytes too: HTTPResponse deliberately hides HEAD bodies.
                self.assertEqual(wire.split(b'\r\n\r\n', 1)[1],
                    b'' if method == 'HEAD' else selected)
                self.assertEqual(connection.writes, 1 if method == 'HEAD'
                    else 1 + (len(selected) + 65535) // 65536)
                self.assertEqual(self.dump(), before)
                self.assertEqual(path.read_bytes(), expected)
