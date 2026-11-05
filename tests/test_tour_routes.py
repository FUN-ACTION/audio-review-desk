"""Exercise the real packaged route handler without opening a network socket."""
import io
from http.client import HTTPMessage
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urljoin, urlsplit

from audio_review_desk.server import make_server


class TourRouteTests(unittest.TestCase):
    def setUp(self):
        workspace = Mock(root=Path("/unused-route-test-workspace"))
        # Capture the production handler; never bind, listen, create a database,
        # start a thread or invoke BaseHTTPRequestHandler's socket constructor.
        with patch("audio_review_desk.server.ThreadingHTTPServer") as server:
            make_server(workspace, 0)
        self.handler_class = server.call_args.args[1]

    def request(self, path, method="GET", host="127.0.0.1:8765"):
        handler = object.__new__(self.handler_class)
        handler.server = SimpleNamespace(server_port=8765)
        handler.headers = HTTPMessage()
        handler.headers["Host"] = host
        handler.path = path
        handler.command = method
        handler.wfile = io.BytesIO()
        statuses, headers = [], {}
        handler.send_response = statuses.append
        handler.send_header = lambda key, value: headers.update({key: value})
        handler.end_headers = lambda: None
        (handler.do_HEAD if method == "HEAD" else handler.do_GET)()
        self.assertEqual(len(statuses), 1)
        return statuses[0], headers, handler.wfile.getvalue()

    def test_current_tour_module_graph_is_served_with_exact_source_bytes(self):
        static = Path(__file__).resolve().parents[1] / "src/audio_review_desk/static"
        pending, visited = ["/tour/tour.js?v=entry-check"], set()
        patterns = (
            r'''\b(?:import|export)\s+[\w$*{},\s]+?\s+from\s*(["'])(.*?)\1''',
            r'''\bimport\s*(["'])(.*?)\1''',
            r'''\bimport\s*\(\s*(["'])(.*?)\1\s*\)''',
        )
        while pending:
            route = pending.pop()
            path = urlsplit(route).path
            if path in visited:
                continue
            visited.add(path)
            with self.subTest(route=route):
                status, headers, data = self.request(route)
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], "text/javascript; charset=utf-8")
                self.assertEqual(int(headers["Content-Length"]), len(data))
                self.assertEqual(data, (static / path.lstrip("/")).read_bytes())
            code = re.sub(r"/\*.*?\*/", "", data.decode(), flags=re.S)
            code = re.sub(r"(?m)^\s*//.*$", "", code)
            for pattern in patterns:
                for _, module in re.findall(pattern, code):
                    self.assertFalse(urlsplit(module).scheme or urlsplit(module).netloc)
                    pending.append(urljoin(route, module))
        self.assertTrue({"/tour/review-tabs.js", "/tour/local-review.js",
                         "/tour/range-time.js", "/tour/workspace-link.js"} <= visited)

    def test_new_modules_keep_head_security_and_exact_allowlist_boundaries(self):
        for name in ("review-tabs.js", "local-review.js", "range-time.js"):
            with self.subTest(name=name):
                status, headers, body = self.request("/tour/" + name + "?v=head", "HEAD")
                self.assertEqual(status, 200)
                self.assertEqual(body, b"")
                self.assertGreater(int(headers["Content-Length"]), 0)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
                self.assertEqual(self.request("/tour/" + name, host="evil.example")[0], 403)
        for route in ("/tour/private-review.js", "/tour/../reviews.sqlite",
                      "/tour/%2e%2e/reviews.sqlite", "/tour/./local-review.js",
                      "/tour/local-review.js/extra", "/tour/media/../local-review.js"):
            with self.subTest(route=route):
                self.assertEqual(self.request(route)[0], 404)


if __name__ == "__main__":
    unittest.main()
