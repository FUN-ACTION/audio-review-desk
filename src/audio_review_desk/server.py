"""Small loopback-only review server. No upload, training, or source-edit API."""
from __future__ import annotations

import json
import hashlib
import mimetypes
import os
import re
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from urllib.parse import parse_qs, urlsplit

from .audio import AudioError
from .workspace import Conflict, Workspace, encode
from .jobs import ImportJobs
from .picker import choose
from .errors import error_code
from .json_input import loads_unique
from . import __version__

TOUR_FILES = {"index.html", "tour.css", "tour.js", "tour-copy.js", "media-info.js", "playback-policy.js", "preview.js", "studio.js", "studio-signal.js", "studio.css", "scene.js", "scene-physics.js", "scene-vendor.js", "three-LICENSE.txt", "reel-warp.js", "score-scene.js", "score-math.js", "story-demo.js", "story-demo.css", "story-math.js", "type.css", "score-serif.woff2", "score-serif-OFL.txt", "sample-playback.js", "score-sans.woff2", "note-geometry.js", "music-art.js", "music-art.css", "music-shader.js", "music-player.js", "art-stage.js", "signal-stage.js"}
TOUR_FILES.update({"workspace-link.js", "review-tabs.js", "local-review.js", "range-time.js"})
TOUR_MEDIA = { "workflow-zh.mp4", "workflow-en.mp4",
              "notes-zh.mp4", "notes-en.mp4", "range-zh.mp4", "range-en.mp4",
              "workflow-zh.webp", "workflow-en.webp", "notes-zh.webp", "notes-en.webp",
              "range-zh.webp", "range-en.webp", "scene-poster.webp", "score-poster.svg", "music-notes-poster.svg", "art-bloom.png", "art-wave.png", "art-prism.png"}


STATIC_MIME = {
    "html": "text/html", "css": "text/css", "js": "text/javascript",
    "txt": "text/plain", "webp": "image/webp", "png": "image/png", "mp4": "video/mp4",
    "woff2": "font/woff2", "pdf": "application/pdf", "svg": "image/svg+xml",
}


def static_content_type(name: str) -> str:
    # Windows registry associations vary between Python installations.
    return STATIC_MIME.get(name.rsplit(".", 1)[-1].lower()) or mimetypes.guess_type(name)[0] or "application/octet-stream"


class ConnectionIOError(OSError):
    """An error from the HTTP connection, not a workspace file or operation."""


class ConnectionStream:
    """Mark failures only at socket-backed stream read/write boundaries."""

    def __init__(self, stream):
        self.stream = stream

    def __getattr__(self, name):
        return getattr(self.stream, name)

    def _call(self, name, *args):
        try:
            return getattr(self.stream, name)(*args)
        except OSError as exc:
            raise ConnectionIOError("HTTP connection interrupted") from exc

    def read(self, *args):
        return self._call("read", *args)

    def readline(self, *args):
        return self._call("readline", *args)

    def write(self, *args):
        return self._call("write", *args)

    def flush(self):
        return self._call("flush")


def make_server(workspace: Workspace, port: int = 8765) -> ThreadingHTTPServer:
    workspace.initialize()
    workspace_id = hashlib.sha256(os.path.normcase(str(workspace.root)).encode("utf-8")).hexdigest()
    session = secrets.token_urlsafe(32)
    jobs = ImportJobs(workspace)

    class Handler(BaseHTTPRequestHandler):
        server_version = "AudioReviewDesk"
        # Socket I/O only, not a deadline for decoding, database or file work.
        timeout = 30

        def setup(self):
            super().setup()
            self.rfile = ConnectionStream(self.rfile)
            self.wfile = ConnectionStream(self.wfile)

        def handle_one_request(self):
            self._response_started = False
            try:
                super().handle_one_request()
            except ConnectionIOError:
                self.close_connection = True

        def end_headers(self):
            # A failed/partial header write must never trigger another response.
            self._response_started = True
            super().end_headers()

        def log_message(self, *_args):
            pass

        def host_valid(self) -> bool:
            hosts = self.headers.get_all("Host", [])
            allowed = {f"127.0.0.1:{self.server.server_port}"}
            if self.server.server_port == 80:
                allowed.add("127.0.0.1")
            return len(hosts) == 1 and hosts[0] in allowed

        def origin_valid(self) -> bool:
            origins = self.headers.get_all("Origin", [])
            allowed = {f"http://127.0.0.1:{self.server.server_port}"}
            if self.server.server_port == 80:
                allowed.add("http://127.0.0.1")
            return len(origins) == 1 and origins[0] in allowed

        def headers_for(self, status: int, content_type: str, length: int, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            if self.command == "POST":
                self.send_header("Connection", "close")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()

        def json_response(self, payload: object, status: int = 200, extra: dict | None = None):
            if getattr(self, "_response_started", False):
                self.close_connection = True
                return
            if isinstance(payload, dict) and payload.get("error"):
                payload = dict(payload, code=payload.get("code") or error_code(payload["error"]))
            data = encode(payload).encode()
            self.headers_for(status, "application/json; charset=utf-8", len(data), extra)
            if self.command != "HEAD":
                self.wfile.write(data)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            try:
                if not self.host_valid():
                    return self.json_response({"error": "Use the printed 127.0.0.1 address"}, 403)
                path = urlsplit(self.path).path
                if path == "/api/version":
                    return self.json_response({"application": "audio-review-desk", "version": __version__})
                if path == "/api/state":
                    return self.json_response(dict(workspace.state(), session=session, version=__version__,
                                                   can_rescan=workspace.import_source() is not None,
                                                   workspace=workspace.root.name, workspace_id=workspace_id))
                if path == "/api/job":
                    return self.json_response(jobs.snapshot())
                if path in {"/tour", "/tour/"}:
                    if path == "/tour":
                        return self.json_response({}, 308, {"Location": "/tour/"})
                    path = "/tour/index.html"
                if path.startswith("/tour/"):
                    relative = path.removeprefix("/tour/")
                    if relative in TOUR_FILES or (relative.startswith("media/") and relative[6:] in TOUR_MEDIA):
                        resource = files("audio_review_desk").joinpath("static", "tour", relative)
                        content_type = static_content_type(relative)
                        if relative.endswith((".html", ".css", ".js")):
                            content_type += "; charset=utf-8"
                        return self.serve_audio(resource, content_type)
                if path == "/api/export":
                    query = parse_qs(urlsplit(self.path).query)
                    if query.get("format", ["json"])[0] == "csv":
                        status = query.get("status", ["all"])[0]
                        data = ("\ufeff" + workspace.export_csv(status)).encode()
                        self.headers_for(200, "text/csv; charset=utf-8", len(data),
                                         {"Content-Disposition": f'attachment; filename="reviews-{status}.csv"'})
                        if self.command != "HEAD":
                            self.wfile.write(data)
                        return
                    return self.json_response(workspace.export(), extra={"Content-Disposition": 'attachment; filename="audio-reviews.json"'})
                if match := re.fullmatch(r"/api/history/([0-9a-f]{64})", path):
                    workspace.asset(match[1])
                    return self.json_response({"history": workspace.history(match[1])})
                if match := re.fullmatch(r"/api/wave/([0-9a-f]{64})", path):
                    asset = workspace.asset(match[1])
                    return self.json_response({"a": asset["quality"].get("waveform", []),
                                               "b": asset.get("reference_quality", {}).get("waveform", [])})
                if match := re.fullmatch(r"/media/([0-9a-f]{64})/([ab])\.wav", path):
                    return self.serve_audio(workspace.preview(match[1], match[2]))
                name = {"/": "workbench.html", "/app.js": "workbench.js", "/ui.js": "ui.js", "/style.css": "workbench.css"}.get(path)
                if path in {"/marker-text.js", "/draft-recovery.js", "/draft-session.js", "/read-once.js", "/waveform-reader.js", "/read-recovery.js", "/job-poller.js", "/media-session.js", "/trim.js", "/audition.js", "/spectrogram.js", "/spectrum-math.js", "/copy.js", "/motion.js", "/motion-vendor.js", "/motion-LICENSE.txt", "/markers.js", "/listening.js", "/commands.js", "/errors.js", "/waveform.js", "/wave-math.js", "/transport.js", "/studio-latin.woff2", "/studio-cjk.woff2", "/desk-cjk-ui.woff2", "/fonts.css", "/desk-display.woff2", "/geist-latin.woff2", "/MiSans-Regular.woff2", "/MiSans-License.pdf", "/workbench-studio.css"}:
                    name = path[1:]
                if name:
                    data = files("audio_review_desk").joinpath("static", name).read_bytes()
                    content_type = static_content_type(name)
                    if name.endswith(".woff2"):
                        content_type = "font/woff2"
                    if name.endswith((".html", ".css", ".js")):
                        content_type += "; charset=utf-8"
                    self.headers_for(200, content_type, len(data))
                    if self.command != "HEAD":
                        self.wfile.write(data)
                    return
                self.json_response({"error": "Not found"}, 404)
            except ConnectionIOError:
                raise
            except Conflict as exc:
                self.json_response({"error": str(exc)}, 409)
            except (ValueError, AudioError, OSError) as exc:
                self.json_response({"error": str(exc) if isinstance(exc, ValueError) else "Audio file unavailable; rescan the workspace"}, 422)
            except Exception:
                self.json_response({"error": "Could not read workspace; check the catalog and disk space"}, 500)

        def serve_audio(self, path, content_type="audio/wav"):
            size = path.stat().st_size
            start, end, status = 0, size - 1, 200
            header = self.headers.get("Range")
            if header:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
                if not match or not any(match.groups()):
                    return self.json_response({"error": "Invalid byte range"}, 416, {"Content-Range": f"bytes */{size}"})
                left, right = match.groups()
                if not left:
                    start = max(0, size - int(right))
                else:
                    start = int(left)
                    end = min(size - 1, int(right)) if right else size - 1
                if start > end or start >= size:
                    return self.json_response({"error": "Unsatisfiable byte range"}, 416, {"Content-Range": f"bytes */{size}"})
                status = 206
            headers = {"Accept-Ranges": "bytes"}
            if status == 206:
                headers["Content-Range"] = f"bytes {start}-{end}/{size}"
            self.headers_for(status, content_type, end - start + 1, headers)
            if self.command == "HEAD":
                return
            with path.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    block = stream.read(min(65536, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)

        def do_POST(self):
            # Never reuse a stream whose request body may remain unread.
            # This does not impose a deadline on slow clients.
            self.close_connection = True
            try:
                if (not self.host_valid() or not self.origin_valid()
                        or not secrets.compare_digest(self.headers.get("X-Review-Token", ""), session)):
                    return self.json_response({"error": "Reload this local page before saving"}, 403)
                path = urlsplit(self.path).path
                if path not in {"/api/review", "/api/batch", "/api/undo", "/api/import", "/api/browse", "/api/cancel-import", "/api/rescan"}:
                    return self.json_response({"error": "Not found"}, 404)
                if self.headers.get_content_type() != "application/json":
                    return self.json_response({"error": "Expected application/json"}, 415)
                lengths = self.headers.get_all("Content-Length", [])
                if self.headers.get_all("Transfer-Encoding", []) or len(lengths) > 1:
                    return self.json_response({"error": "Invalid request framing", "code": "operation_failed"}, 400)
                if not lengths:
                    return self.json_response({"error": "Review body too large or empty"}, 413)
                value = lengths[0].strip(" \t")
                if not re.fullmatch(r"[0-9]+", value):
                    return self.json_response({"error": "Invalid request length", "code": "operation_failed"}, 400)
                # Avoid int's digit limit and bound conversion before reading.
                digits = value.lstrip("0") or "0"
                if len(digits) > 6 or (len(digits) == 6 and digits > "131072") or digits == "0":
                    return self.json_response({"error": "Review body too large or empty"}, 413)
                length = int(digits)
                try:
                    body = self.rfile.read(length)
                except ConnectionIOError:
                    raise
                except OSError:
                    return self.json_response({"error": "Could not read request body", "code": "operation_failed"}, 400)
                if len(body) != length:
                    return self.json_response({"error": "Incomplete request body", "code": "operation_failed"}, 400)
                payload = loads_unique(body, context="Request JSON")
                if not isinstance(payload, dict):
                    raise ValueError("Expected an object")
                if path == "/api/browse":
                    return self.json_response({"path": choose(payload.get("kind"), payload.get("language", "en"))})
                if path == "/api/import":
                    return self.json_response(jobs.start(payload.get("kind"), payload.get("path"), payload.get("append", True)), 202)
                if path == "/api/rescan":
                    previous = workspace.import_source()
                    if not previous:
                        raise ValueError("Import a folder or manifest first")
                    return self.json_response(jobs.start(previous["kind"], previous["path"], True), 202)
                if path == "/api/cancel-import":
                    return self.json_response(jobs.cancel(payload.get("id")))
                if path == "/api/batch":
                    return self.json_response(workspace.batch_review_result(payload.get("changes"), payload.get("status")))
                if not isinstance(payload.get("key"), str):
                    raise ValueError("Missing audio version key")
                if path == "/api/undo":
                    return self.json_response({"saved": True, "review": workspace.undo_review(payload["key"], payload.get("expected_version"))})
                review = workspace.save_review(payload["key"], payload)
                return self.json_response({"saved": True, "review": review})
            except ConnectionIOError:
                raise
            except Conflict as exc:
                self.json_response({"error": str(exc)}, 409)
            except (ValueError, KeyError, json.JSONDecodeError) as exc:
                self.json_response({"error": str(exc)}, 422)
            except OSError as exc:
                self.json_response({"error": "Source is unavailable; rescan before saving", "code": error_code(exc)}, 409)
            except Exception:
                self.json_response({"error": "Save failed; your draft is still in this page"}, 500)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server
