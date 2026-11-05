"""Replay existing server assertions through real HTTP parsing, without sockets.

This is a handler-level adapter, not an HTTP integration runner. It does not
verify binding, TCP, disconnects, slow clients, concurrent transport or browsers.
Run from the checkout: PYTHONPATH=src python -m scripts.check_server_in_memory
"""
from __future__ import annotations

import http.client
import importlib
import io
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from urllib.parse import urlsplit


class MemoryTransport:
    """Only test-owned origins exist; there is no fallback to network access."""

    def __init__(self):
        self.servers = {}
        self.next_port = 46000
        self.requests = 0

    def make_server(self, address, handler):
        self.next_port += 1
        endpoint = (address[0], address[1] or self.next_port)
        if endpoint in self.servers:
            raise AssertionError("Duplicate in-memory origin")
        server = SimpleNamespace(
            server_address=endpoint, server_port=endpoint[1],
            RequestHandlerClass=handler,
            # Existing tests start a thread to serve. It immediately returns:
            # there is no listener, accept loop or real server lifecycle here.
            serve_forever=lambda: None, shutdown=lambda: None,
            server_close=lambda: self.servers.pop(endpoint, None),
        )
        self.servers[endpoint] = server
        return server

    def open(self, url):
        request = urllib.request.Request(url) if isinstance(url, str) else url
        parsed = urlsplit(request.full_url)
        if parsed.scheme != "http":
            raise AssertionError("Only in-memory HTTP test origins are supported")
        server = self.servers.get((parsed.hostname, parsed.port or 80))
        if server is None:
            raise AssertionError("Request did not name an in-memory test origin")
        method = request.get_method()
        if method not in {"GET", "HEAD", "POST"}:
            raise AssertionError("Unsupported method in the in-memory adapter")
        body = request.data or b""
        headers = dict(request.header_items())
        lower_names = {name.lower() for name in headers}
        if "host" not in lower_names:
            headers["Host"] = parsed.netloc
        if request.data is not None and "content-length" not in lower_names:
            headers["Content-Length"] = str(len(body))
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query
        raw = (method + " " + target + " HTTP/1.1\r\n"
               + "".join(name + ": " + value + "\r\n" for name, value in headers.items())
               + "\r\n").encode("latin-1") + body

        # Skip only the socket constructor/setup. Keep the production request
        # parser, do_GET/do_POST, response headers and body writer unchanged.
        handler = object.__new__(server.RequestHandlerClass)
        handler.server = server
        handler.client_address = ("127.0.0.1", 0)
        handler.rfile = io.BytesIO(raw)
        handler.wfile = io.BytesIO()
        handler.handle_one_request()
        response_bytes = handler.wfile.getvalue()
        connection = SimpleNamespace(makefile=lambda *args: io.BytesIO(response_bytes))
        response = http.client.HTTPResponse(connection, method=method)
        response.begin()
        self.requests += 1
        if response.status >= 400:
            raise urllib.error.HTTPError(request.full_url, response.status, response.reason,
                                         response.headers, response)
        return response


def main() -> int:
    transport = MemoryTransport()
    print("IN-MEMORY HANDLER CHECKS ONLY. No listener or TCP connection is created.", flush=True)
    # Guard application/test imports and discovery too, so future import-time
    # networking fails rather than escaping the test-only transport.
    with patch.object(socket, "socket", side_effect=AssertionError("Socket creation is forbidden")) as blocked:
        root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(root / "tests"))
        tests = importlib.import_module("test_server")
        suite = unittest.defaultTestLoader.loadTestsFromModule(tests)
        with patch("audio_review_desk.server.ThreadingHTTPServer", transport.make_server), \
             patch("urllib.request.urlopen", transport.open):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(f"Adapted assertions: {result.testsRun} tests; {transport.requests} memory requests; "
          f"{blocked.call_count} socket attempts; {len(transport.servers)} remaining fake origins.")
    print("The loopback assertion checks a constructor argument, not a bound interface. "
          "TCP, disconnects, slow clients, concurrent transport and browser behavior remain unverified.")
    return int(not result.wasSuccessful() or blocked.call_count != 0 or bool(transport.servers))


if __name__ == "__main__":
    raise SystemExit(main())
