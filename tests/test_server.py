import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
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

    def post(self, payload, extra=None):
        headers = {"Content-Type": "application/json", "Origin": self.origin, "X-Review-Token": self.state["session"]}
        headers.update(extra or {})
        request = urllib.request.Request(self.origin + "/api/review", data=json.dumps(payload).encode(), headers=headers)
        return urllib.request.urlopen(request)

    def payload(self):
        return dict(key=self.state["items"][0]["key"], status="pass", score=0, issues=[], note="", expected_version=0)

    def test_only_loopback_and_strict_host(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get("/api/state", {"Host": "evil.example"})
        self.assertEqual(caught.exception.code, 403)

    def test_static_assets_are_packaged_and_private_paths_not_served(self):
        for path in ("/", "/app.js", "/style.css", "/ui.js"):
            with urllib.request.urlopen(self.origin + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        for path in ("/reviews.sqlite", "/../reviews.sqlite", "/api/import", "/source.wav"):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.get(path)
            self.assertEqual(caught.exception.code, 404)

    def test_same_origin_and_review_token_required(self):
        for headers in ({"Origin": "http://evil.example"}, {"X-Review-Token": "wrong"}, {"Origin": "null"}):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(self.payload(), headers)
            self.assertEqual(caught.exception.code, 403)
        with self.post(self.payload()) as response:
            self.assertTrue(json.load(response)["saved"])

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


if __name__ == "__main__":
    unittest.main()
