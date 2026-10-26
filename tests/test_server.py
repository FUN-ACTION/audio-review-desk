import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import time
from unittest.mock import patch
from pathlib import Path

from audio_review_desk.demo import write_wav
from audio_review_desk.server import make_server
from audio_review_desk.workspace import Workspace


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        audio = self.root / "audio"
        write_wav(audio / "a.wav", seconds=.25)
        self.workspace = Workspace(self.root / "workspace")
        self.workspace.scan(audio)
        self.server = make_server(self.workspace, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.state = self.get("/api/state")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def get(self, path, headers=None):
        request = urllib.request.Request(self.origin + path, headers=headers or {})
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def post(self, payload, extra=None, path="/api/review"):
        headers = {"Content-Type": "application/json", "Origin": self.origin, "X-Review-Token": self.state["session"]}
        headers.update(extra or {})
        request = urllib.request.Request(self.origin + path, data=json.dumps(payload).encode(), headers=headers)
        return urllib.request.urlopen(request)

    def payload(self):
        return dict(key=self.state["items"][0]["key"], status="pass", score=0, issues=[], note="", expected_version=0)

    def test_only_loopback_and_strict_host(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get("/api/state", {"Host": "evil.example"})
        self.assertEqual(caught.exception.code, 403)

    def test_static_assets_are_packaged_and_private_paths_not_served(self):
        for path in ("/", "/app.js", "/style.css", "/ui.js", "/copy.js", "/motion.js", "/waveform.js", "/wave-math.js", "/intake.js", "/transport.js"):
            with urllib.request.urlopen(self.origin + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        for path in ("/reviews.sqlite", "/../reviews.sqlite", "/api/import", "/source.wav"):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.get(path)
            self.assertEqual(caught.exception.code, 404)

    def test_packaged_fonts_and_version_endpoint(self):
        from audio_review_desk import __version__
        self.assertEqual(self.get('/api/version'), {'version': __version__})
        for path in ('/studio-latin.woff2', '/studio-cjk.woff2'):
            with urllib.request.urlopen(self.origin + path) as response:
                self.assertEqual(response.read(4), b'wOF2')
                self.assertIn('font', response.headers['Content-Type'])

    def test_import_errors_have_stable_translation_codes(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post({'kind':'directory','path':str(self.root),'append':True},path='/api/import')
        self.assertEqual(caught.exception.code,422)
        self.assertEqual(json.load(caught.exception)['code'],'source_contains_workspace')
        for path in ('/motion-vendor.js','/commands.js','/markers.js','/errors.js','/motion-LICENSE.txt'):
            with urllib.request.urlopen(self.origin+path) as response:self.assertEqual(response.status,200)

    def test_same_origin_and_review_token_required(self):
        for headers in ({"Origin": "http://evil.example"}, {"X-Review-Token": "wrong"}, {"Origin": "null"}):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(self.payload(), headers)
            self.assertEqual(caught.exception.code, 403)
        with self.post(self.payload()) as response:
            self.assertTrue(json.load(response)["saved"])

    def test_native_picker_requires_authorization_and_cancel_preserves_catalog(self):
        with patch('audio_review_desk.server.choose', return_value=None) as choose:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post({'kind': 'directory'}, {'X-Review-Token': 'wrong'}, path='/api/browse')
            self.assertEqual(caught.exception.code, 403)
            choose.assert_not_called()
            with self.post({'kind': 'manifest'}, path='/api/browse') as response:
                self.assertIsNone(json.load(response)['path'])
            choose.assert_called_once_with('manifest', 'en')
        self.assertEqual(self.get('/api/state')['items'], self.state['items'])
        self.assertIsNone(self.get('/api/job')['id'])

    def test_stale_http_edit_is_conflict(self):
        with self.post(self.payload()):
            pass
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post(self.payload())
        self.assertEqual(caught.exception.code, 409)

    def test_audio_byte_ranges_and_bad_ranges(self):
        key = self.state["items"][0]["key"]
        url = self.origin + f"/media/{key}/a.wav"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-43"})) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(len(response.read()), 44)
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=-10"})) as response:
            self.assertEqual(len(response.read()), 10)
        for value in ("bytes=99999999-", "bytes=8-2", "bytes=-0", "garbage"):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(urllib.request.Request(url, headers={"Range": value}))
            self.assertEqual(caught.exception.code, 416)

    def test_modified_source_returns_conflict(self):
        write_wav(self.root / "audio" / "a.wav", seconds=.25, amplitude=.6)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post(self.payload())
        self.assertEqual(caught.exception.code, 409)

    def test_export_omits_explicit_paths_and_has_no_cors(self):
        with urllib.request.urlopen(self.origin + "/api/export") as response:
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
            exported = json.load(response)
            self.assertNotIn("path", exported["items"][0])

    def test_batch_and_undo_routes_preserve_audit_history(self):
        key=self.state['items'][0]['key']
        with self.post({'changes':[{'key':key,'expected_version':0}],'status':'fix'},path='/api/batch') as response:
            self.assertEqual(json.load(response)['saved'],1)
        with self.post({'key':key,'expected_version':1},path='/api/undo') as response:
            self.assertEqual(json.load(response)['review']['status'],'pending')
        self.assertEqual(len(self.get('/api/history/'+key)['history']),2)

    def test_gui_import_and_rescan_with_session_authorization(self):
        payload={'kind':'directory','path':str(self.root/'audio'),'append':True}
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post(payload,{'X-Review-Token':'wrong'},path='/api/import')
        self.assertEqual(caught.exception.code,403)
        with self.post(payload,path='/api/import') as response:
            self.assertEqual(response.status,202)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            job=self.get('/api/job')
            if job['state'] not in {'running','cancelling'}:break
            time.sleep(.02)
        self.assertEqual(job['state'],'succeeded')
        self.assertTrue(self.get('/api/state')['can_rescan'])
        with self.post({},path='/api/rescan') as response:
            self.assertEqual(response.status,202)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and self.get('/api/job')['state'] in {'running','cancelling'}:
            time.sleep(.02)

    def test_csv_export_download(self):
        with self.post(self.payload()):pass
        with urllib.request.urlopen(self.origin+'/api/export?format=csv&status=pass') as response:
            self.assertEqual(response.headers['Content-Type'],'text/csv; charset=utf-8')
            text=response.read().decode('utf-8-sig')
        self.assertIn('a.wav',text)
        self.assertNotIn(str(self.root),text)


if __name__ == "__main__":
    unittest.main()
