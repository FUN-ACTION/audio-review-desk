"""Raw HTTP framing through production handle(), with no network transport."""
import http.client
import io
import json
from types import SimpleNamespace
import unittest
import test_server_origin


class BodyStream(io.BytesIO):
    def __init__(self, raw, fail=False):
        super().__init__(raw)
        self.body_reads = []
        self.fail = fail

    def read(self, size=-1):
        self.body_reads.append(size)
        if self.fail:
            raise OSError('synthetic read failure')
        return super().read(size)


class FramingTests(unittest.TestCase):
    setUp = test_server_origin.OriginTests.setUp
    server = test_server_origin.OriginTests.server
    request = test_server_origin.OriginTests.request
    state = test_server_origin.OriginTests.state
    payload = test_server_origin.OriginTests.payload
    dump = test_server_origin.OriginTests.dump

    def run_post(self, fields, body, *, authorized=True, following=False, fail=False, protocol="HTTP/1.0",
                 path="/api/review", content_type="application/json"):
        server = self.server(8765)
        state = self.state(server)
        token = state['session'] if authorized else 'stale'
        headers = [('Host','127.0.0.1:8765'), ('Origin','http://127.0.0.1:8765'),
                   ('X-Review-Token',token), ('Content-Type',content_type),
                   ('Connection','keep-alive')] + fields
        raw = (f'POST {path} HTTP/1.1\r\n' + ''.join(f'{k}: {v}\r\n' for k,v in headers) + '\r\n').encode('latin1') + body
        if following:
            raw += b'GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:8765\r\n\r\n'
        handler = object.__new__(server.RequestHandlerClass)
        handler.server = server
        handler.protocol_version = protocol
        handler.client_address = ('127.0.0.1',0)
        handler.rfile = BodyStream(raw, fail)
        handler.wfile = io.BytesIO()
        before = self.dump()
        handler.handle()  # Real connection loop: close must prevent second request.
        wire = handler.wfile.getvalue()
        response = http.client.HTTPResponse(SimpleNamespace(makefile=lambda *a: io.BytesIO(wire)))
        response.begin()
        result = json.loads(response.read())
        self.assertTrue(handler.close_connection)
        self.assertEqual(response.getheader('Connection'),'close')
        self.assertEqual(wire.count(protocol.encode() + b' '),1)
        self.assertEqual(self.blocked.call_count,0)
        if response.status != 200:
            self.assertEqual(self.dump(),before)
        return response.status,result,handler,state

    def test_duplicate_lengths_and_lists_reject_before_body_or_following_request(self):
        for fields in [[('Content-Length','2'),('Content-Length','2')],
                       [('Content-Length','2'),('content-length','200')],
                       [('Content-Length','200'),('Content-Length','2')],
                       [('Content-Length','2, 2')]]:
            with self.subTest(fields=fields):
                status,result,h,_ = self.run_post(fields,b'{}',following=True)
                self.assertEqual(status,400)
                self.assertEqual(result['code'],'operation_failed')
                self.assertEqual(h.rfile.body_reads,[])
                self.assertEqual(len(h.headers.get_all('Content-Length')),len(fields))

    def test_all_transfer_encoding_forms_are_rejected(self):
        for values in [['chunked'],['identity'],[''],['gzip, chunked'],['chunked','identity']]:
            for length in [[],[('Content-Length','2')]]:
                with self.subTest(values=values,length=length):
                    status,result,h,_ = self.run_post([('Transfer-Encoding',v) for v in values]+length,b'{}',following=True)
                    self.assertEqual(status,400); self.assertEqual(result['code'],'operation_failed')
                    self.assertEqual(h.rfile.body_reads,[])

    def test_invalid_lengths_are_not_python_integer_syntax(self):
        for value in ['', '+2','-2','2.0','0x2','2_0','2 0','²']:
            with self.subTest(value=value):
                status,_,h,_ = self.run_post([('Content-Length',value)],b'{}')
                self.assertEqual(status,400); self.assertEqual(h.rfile.body_reads,[])

    def test_empty_and_oversized_lengths_do_not_read_or_convert_giant_int(self):
        for fields in [[],[('Content-Length','0')],[('Content-Length','000')],
                       [('Content-Length','131073')],[('Content-Length','9'*5000)]]:
            with self.subTest(fields=str(fields)[:80]):
                status,_,h,_ = self.run_post(fields,b'{}',following=True)
                self.assertEqual(status,413); self.assertEqual(h.rfile.body_reads,[])

    def test_short_valid_json_and_truncated_json_never_write(self):
        server=self.server(8765); payload=self.payload(self.state(server))
        for body in [json.dumps(payload).encode(),b'{']:
            status,result,h,_=self.run_post([('Content-Length',str(len(body)+5))],body)
            self.assertEqual(status,400); self.assertEqual(result['error'],'Incomplete request body')
            self.assertEqual(h.rfile.body_reads,[len(body)+5])

    def test_read_error_is_request_error_not_source_error(self):
        status,result,h,_=self.run_post([('Content-Length','2')],b'{}',fail=True)
        self.assertEqual(status,400); self.assertEqual(result['code'],'operation_failed')
        self.assertEqual(h.rfile.body_reads,[2])

    def test_authentication_precedes_body_validation_and_read(self):
        status,result,h,_=self.run_post([('Content-Length','2'),('Content-Length','3'),
            ('Transfer-Encoding','chunked')],b'{}',authorized=False,following=True)
        self.assertEqual(status,403); self.assertEqual(result['code'],'reload_required')
        self.assertEqual(h.rfile.body_reads,[])

    def test_normal_utf8_and_leading_zeros_preserve_exact_body_and_save(self):
        for zeros in ['', '0'*5000]:
            server=self.server(8765); payload=self.payload(self.state(server));payload['note']='门响 🎧'
            body=json.dumps(payload,ensure_ascii=False).encode('utf8')
            status,_,h,state=self.run_post([('Content-Length',zeros+str(len(body)))],body,following=True)
            self.assertEqual(status,200);self.assertEqual(h.rfile.body_reads,[len(body)])
            review=self.workspace.state()['items'][0]['review']
            self.assertEqual(review['note'],'门响 🎧')
            self.assertEqual(review['version'],state['items'][0]['review']['version']+1)
            self.assertTrue(h.rfile.getvalue()[h.rfile.tell():].startswith(b'GET /api/state'))

    def test_exact_maximum_length_is_allowed_to_json_parser(self):
        status,result,h,_=self.run_post([('Content-Length','131072')],b'{}'+b' '*131070)
        self.assertEqual(status,422)  # Valid JSON object, missing business key.
        self.assertEqual(h.rfile.body_reads,[131072])
        self.assertEqual(result['error'],'Missing audio version key')

    def test_http11_defensive_close_retains_unread_body_and_ignores_second_request(self):
        # Production currently responds HTTP/1.0. This deliberately enables the
        # inherited HTTP/1.1 keep-alive path to protect a future protocol change.
        # Unknown route/type may reject first (404/415), but must still close.
        cases = [
            ({}, [('Content-Length','2'),('Content-Length','3')], 400),
            ({}, [('Content-Length','2'),('Transfer-Encoding','chunked')], 400),
            ({}, [('Content-Length','131073')], 413),
            ({'authorized':False}, [('Content-Length','2')], 403),
            ({'path':'/api/unknown'}, [('Content-Length','2'),('Transfer-Encoding','chunked')], 404),
            ({'content_type':'text/plain'}, [('Content-Length','2'),('Transfer-Encoding','chunked')], 415),
        ]
        for options, fields, expected in cases:
            with self.subTest(options=options, fields=fields):
                status,_,handler,_ = self.run_post(fields,b'{}',following=True,
                    protocol='HTTP/1.1',**options)
                self.assertEqual(status,expected)
                self.assertEqual(handler.request_version,'HTTP/1.1')
                self.assertEqual(handler.headers['Connection'],'keep-alive')
                self.assertEqual(handler.rfile.body_reads,[])
                self.assertTrue(handler.rfile.getvalue()[handler.rfile.tell():].startswith(
                    b'{}GET /api/state HTTP/1.1\r\n'))
