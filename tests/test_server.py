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
        for path in ("/", "/app.js", "/style.css", "/ui.js", "/copy.js", "/motion.js", "/waveform.js", "/wave-math.js", "/listening.js", "/markers.js", "/fonts.css", "/transport.js"):
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
        for path in ('/studio-latin.woff2', '/studio-cjk.woff2', '/desk-display.woff2', '/desk-cjk-ui.woff2'):
            with urllib.request.urlopen(self.origin + path) as response:
                self.assertEqual(response.read(4), b'wOF2')
                self.assertIn('font', response.headers['Content-Type'])

    def test_workspace_scope_is_stable_opaque_and_separates_equal_folder_names(self):
        scope = self.state['workspace_id']
        self.assertRegex(scope, r'^[0-9a-f]{64}$')
        self.assertEqual(self.get('/api/state')['workspace_id'], scope)
        other = Workspace(self.root / 'another' / 'workspace')
        server = make_server(other, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/state') as response:
                state = json.load(response)
            self.assertEqual(state['workspace'], self.state['workspace'])
            self.assertNotEqual(state['workspace_id'], scope)
            self.assertNotIn(str(self.root), state['workspace_id'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_walkthrough_assets_ranges_and_path_boundary(self):
        for path in ('/tour/', '/tour/tour.js', '/tour/tour.css', '/tour/media-info.js', '/tour/preview.js', '/tour/studio.js', '/tour/studio-signal.js', '/tour/studio.css', '/geist-latin.woff2', '/MiSans-Regular.woff2', '/MiSans-License.pdf', '/workbench-studio.css', '/tour/media/workflow-zh.webp'):
            with urllib.request.urlopen(self.origin + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
        request=urllib.request.Request(self.origin+'/tour/media/workflow-zh.mp4',headers={'Range':'bytes=0-31'})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status,206)
            self.assertEqual(len(response.read()),32)
            self.assertEqual(response.headers['Content-Type'],'video/mp4')
        for path in ('/tour/../reviews.sqlite','/tour/media/../../reviews.sqlite','/tour/media/unlisted.mp4'):
            with self.assertRaises(urllib.error.HTTPError) as caught:self.get(path)
            self.assertEqual(caught.exception.code,404)

    def test_import_errors_have_stable_translation_codes(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post({'kind':'directory','path':str(self.root),'append':True},path='/api/import')
        self.assertEqual(caught.exception.code,422)
        self.assertEqual(json.load(caught.exception)['code'],'source_contains_workspace')
        for path in ('/motion-vendor.js','/commands.js','/markers.js','/errors.js','/motion-LICENSE.txt'):
            with urllib.request.urlopen(self.origin+path) as response:self.assertEqual(response.status,200)

    def test_3d_runtime_assets_are_served_with_browser_compatible_mime_types(self):
        source = Path(__file__).resolve().parents[1] / 'src/audio_review_desk/static/tour'
        assets = {
            'scene.js': ('text/javascript', 'application/javascript'),
            'scene-physics.js': ('text/javascript', 'application/javascript'),
            'reel-warp.js': ('text/javascript', 'application/javascript'),
            'scene-vendor.js': ('text/javascript', 'application/javascript'),
            'three-LICENSE.txt': ('text/plain',),
            'media/scene-poster.webp': ('image/webp',),
        }
        for name, content_types in assets.items():
            with self.subTest(asset=name):
                with urllib.request.urlopen(self.origin+'/tour/'+name+'?v=asset-check') as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(response.headers.get_content_type(), content_types)
                    if name.endswith('.js'):
                        self.assertEqual(response.headers.get_content_charset(), 'utf-8')
                    self.assertEqual(response.read(), (source/name).read_bytes())

    def test_static_media_types_do_not_depend_on_system_registry(self):
        with patch('audio_review_desk.server.mimetypes.guess_type', return_value=(None, None)):
            for route, expected in (
                ('/tour/media/scene-poster.webp', 'image/webp'),
                ('/tour/media/workflow-zh.webp', 'image/webp'),
                ('/tour/scene.js', 'text/javascript'),
                ('/MiSans-Regular.woff2', 'font/woff2'),
                ('/MiSans-License.pdf', 'application/pdf'),
            ):
                with self.subTest(route=route):
                    with urllib.request.urlopen(self.origin+route) as response:
                        self.assertEqual(response.headers.get_content_type(), expected)
                        self.assertTrue(response.read())

    def test_3d_routes_do_not_expose_build_inputs_or_unlisted_files(self):
        for path in ('/tour/package-lock.json', '/tour/node_modules/three/LICENSE',
                     '/tour/../reviews.sqlite', '/tour/media/../../reviews.sqlite',
                     '/tour/media/../scene-vendor.js', '/tour/scene-poster.webp',
                     '/tour/media/unlisted-poster.webp', '/tour/%2e%2e/reviews.sqlite'):
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(self.origin+path)
                self.assertEqual(caught.exception.code, 404)

    def test_score_presentation_assets_have_exact_bytes_and_portable_media_types(self):
        source = Path(__file__).resolve().parents[1] / 'src/audio_review_desk/static/tour'
        assets = {
            'score-scene.js': 'text/javascript',
            'score-math.js': 'text/javascript',
            'story-demo.js': 'text/javascript',
            'story-math.js': 'text/javascript',
            'sample-playback.js': 'text/javascript',
            'story-demo.css': 'text/css',
            'type.css': 'text/css',
            'score-serif.woff2': 'font/woff2',
            'score-sans.woff2': 'font/woff2',
            'score-serif-OFL.txt': 'text/plain',
            'media/score-poster.svg': 'image/svg+xml',
        }
        # These resources must render even on Windows without file associations.
        with patch('audio_review_desk.server.mimetypes.guess_type', return_value=(None, None)):
            for name, expected in assets.items():
                with self.subTest(asset=name):
                    with urllib.request.urlopen(self.origin+'/tour/'+name+'?v=score-check') as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.headers.get_content_type(), expected)
                        self.assertEqual(response.read(), (source/name).read_bytes())

    def test_score_asset_routes_reject_unlisted_files_and_traversal(self):
        for path in ('/tour/score-private.js', '/tour/score-serif.ttf',
                     '/tour/media/score-private.svg', '/tour/media/../score-scene.js',
                     '/tour/%2e%2e/reviews.sqlite'):
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(self.origin+path)
                self.assertEqual(caught.exception.code, 404)

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
