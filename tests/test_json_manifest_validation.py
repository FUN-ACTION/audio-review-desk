"""Duplicate JSON properties cannot silently choose a different catalog."""
import contextlib
import io
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.cli import main
from audio_review_desk.demo import write_wav
from audio_review_desk.errors import error_code
from audio_review_desk.jobs import ImportJobs
from audio_review_desk.server import make_server
from scripts.check_server_in_memory import MemoryTransport
from audio_review_desk.workspace import ImportCancelled, SCHEMA, Workspace


class JsonManifestValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.audio = self.root / "音频"
        write_wav(self.audio / "声音.wav", seconds=.1)
        self.workspace = Workspace(self.root / "workspace")
        self.key = self.workspace.scan(self.audio)["items"][0]["key"]
        self.workspace.save_review(self.key, dict(status="pass", score=8,
            issues=[], note="Keep this review", expected_version=0))
        self.before = self.workspace.state()
        self.source_before = self.workspace.import_source()
        self.history_before = self.workspace.history(self.key)
        with self.workspace.connect() as connection:
            self.database_before = list(connection.iterdump())
        self.manifest = self.root / "clips.json"
        self.row = '{"id":"first","path":"音频/声音.wav"}'

    def document(self, items):
        return '{"schema":' + json.dumps(SCHEMA) + ',"items":[' + items + ']}'

    def assert_preserved(self):
        self.assertEqual(self.workspace.state(), self.before)
        self.assertEqual(self.workspace.import_source(), self.source_before)
        self.assertEqual(self.workspace.history(self.key), self.history_before)
        with self.workspace.connect() as connection:
            self.assertEqual(list(connection.iterdump()), self.database_before)

    def write_interval_manifest(self, field, value):
        # Even a valid earlier row must not reach analysis before validation ends.
        rows = [json.loads(self.row), dict(id='last', path='音频/声音.wav', **{field: value})]
        self.manifest.write_text(json.dumps(dict(schema=SCHEMA, items=rows)), encoding='utf-8')

    @staticmethod
    def invalid_intervals():
        for field in ('source_start', 'source_end'):
            for value in (10**400, -(10**400), float('nan'), float('inf'),
                          -float('inf'), '1e400', '-1e400', '-0.1'):
                yield field, value
        yield 'source_end', 0
        yield 'source_end', False

    def test_cli_interval_overflow_and_nonfinite_values_fail_before_analysis(self):
        for field, value in self.invalid_intervals():
            with self.subTest(field=field, value=value):
                self.write_interval_manifest(field, value)
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch('audio_review_desk.workspace.analyze') as analyze, \
                     contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    status = main(['import', str(self.manifest), '--workspace', str(self.workspace.root)])
                    analyze.assert_not_called()
                self.assertEqual(status, 2)
                self.assertEqual(stdout.getvalue(), '')
                self.assertIn('Source intervals must be finite, nonnegative, and increasing', stderr.getvalue())
                self.assertNotIn('Traceback', stderr.getvalue())
                self.assert_preserved()

    def test_background_http_interval_failures_keep_source_interval_error(self):
        transport = MemoryTransport()
        jobs = ImportJobs(self.workspace)
        with patch('audio_review_desk.server.ThreadingHTTPServer', transport.make_server), \
             patch('audio_review_desk.server.ImportJobs', return_value=jobs), \
             patch('audio_review_desk.server.secrets.token_urlsafe', return_value='test-token'):
            server = make_server(self.workspace, 0)
        self.addCleanup(server.server_close)
        origin = f'http://127.0.0.1:{server.server_port}'
        for field, value in self.invalid_intervals():
            with self.subTest(field=field, value=value):
                self.write_interval_manifest(field, value)
                payload = dict(kind='manifest', path=str(self.manifest), append=False)
                request = urllib.request.Request(origin + '/api/import', data=json.dumps(payload).encode(),
                    headers={'Content-Type': 'application/json', 'Origin': origin, 'X-Review-Token': 'test-token'})
                with patch('audio_review_desk.workspace.analyze') as analyze:
                    with transport.open(request) as response:
                        self.assertEqual(response.status, 202)
                    jobs.thread.join(5)
                    self.assertFalse(jobs.thread.is_alive())
                    analyze.assert_not_called()
                with transport.open(origin + '/api/job') as response:
                    result = json.loads(response.read())
                self.assertEqual(result['state'], 'failed')
                self.assertEqual(result['error_code'], 'source_interval')
                self.assertEqual(result['error'], 'Source intervals must be finite, nonnegative, and increasing')
                self.assert_preserved()

    def test_interval_numeric_strings_defaults_and_existing_bool_semantics(self):
        cases = [(0, .1, 0., .1), ('0', '0.1', 0., .1),
                 (' 1.25 ', '1.35', 1.25, 1.35), ('1e2', '100.1', 100., 100.1),
                 (None, None, 0., .1), ('', '', 0., .1),
                 (False, None, 0., .1), (True, '1.1', 1., 1.1), ('.9', True, .9, 1.)]
        for start, end, expected_start, expected_end in cases:
            with self.subTest(start=start, end=end):
                row = dict(id='valid', path='音频/声音.wav', source_start=start, source_end=end)
                self.manifest.write_text(json.dumps(dict(schema=SCHEMA, items=[row])), encoding='utf-8')
                item = self.workspace.import_manifest(self.manifest)['items'][0]
                self.assertEqual(item['source_start'], expected_start)
                self.assertEqual(item['source_end'], expected_end)

    def test_duplicate_properties_at_all_object_levels_fail_before_ingestion(self):
        cases = [
            (self.document(self.row + ',{"id":"last","path":"wrong.wav","path":"音频/声音.wav"}'), 'path'),
            (self.document(self.row + ',{"id":"old","id":"last","path":"音频/声音.wav"}'), 'id'),
            ('{"schema":"old","schema":' + json.dumps(SCHEMA) + ',"items":[' + self.row + ']}', 'schema'),
            ('{"schema":' + json.dumps(SCHEMA) + ',"items":[],"items":[' + self.row + ']}', 'items'),
            (self.document(self.row + ',{"id":"last","path":"音频/声音.wav","extra":{"nested":[{"x":1,"x":2}]}}'), 'x'),
            (self.document('{"path":"wrong.wav","p\\u0061th":"音频/声音.wav"}'), 'path'),
            (self.document('{"path":"音频/声音.wav","":1,"":2}'), ''),
        ]
        for append in (False, True):
            for content, name in cases:
                with self.subTest(append=append, name=name):
                    self.manifest.write_text(content, encoding="utf-8-sig")
                    with patch.object(self.workspace, "ingest") as ingest:
                        with self.assertRaises(ValueError) as error:
                            self.workspace.import_manifest(self.manifest, append=append)
                        self.assertEqual(str(error.exception), f"JSON manifest contains duplicate property {name!r}")
                        self.assertEqual(error_code(error.exception), "manifest_format")
                        ingest.assert_not_called()
                    self.assert_preserved()

    def test_cli_duplicate_error_has_failure_status_and_no_mutation(self):
        self.manifest.write_text(self.document(self.row + ',{"path":"bad.wav","path":"音频/声音.wav"}'), encoding="utf-8")
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = main(["import", str(self.manifest), "--workspace", str(self.workspace.root)])
        self.assertEqual(status, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("JSON manifest contains duplicate property 'path'", stderr.getvalue())
        self.assert_preserved()

    def test_background_job_uses_existing_manifest_format_ui_code(self):
        self.manifest.write_text(self.document('{"path":"音频/声音.wav","extra":{"Source unavailable":1,"Source unavailable":2}}'), encoding="utf-8")
        jobs = ImportJobs(self.workspace)
        jobs.start("manifest", str(self.manifest))
        jobs.thread.join(5)
        self.assertFalse(jobs.thread.is_alive())
        self.assertEqual(jobs.snapshot()["state"], "failed")
        self.assertEqual(jobs.snapshot()["error_code"], "manifest_format")
        self.assert_preserved()

    def test_unique_properties_unicode_bom_and_existing_defaults_remain_valid(self):
        for encoding in ("utf-8", "utf-8-sig"):
            with self.subTest(encoding=encoding):
                content = {"schema": SCHEMA, "extra": {"x": 1}, "items": [
                    {"id": "first", "path": "音频/声音.wav", "label": '中文, "标题"', "extra": {"x": 2}},
                    {"id": "second", "path": "音频/声音.wav", "extra": [{"x": 3}, {"x": 4}]},
                ]}
                self.manifest.write_text(json.dumps(content, ensure_ascii=False), encoding=encoding)
                items = {item["id"]: item for item in self.workspace.import_manifest(self.manifest)["items"]}
                self.assertEqual(items["first"]["label"], '中文, "标题"')
                self.assertEqual(items["second"]["label"], "second")
                self.assertTrue(items["second"]["eligible"])

    def test_already_cancelled_duplicate_manifest_is_not_read(self):
        cancelled = threading.Event()
        cancelled.set()
        self.manifest.write_text(self.document('{"path":"a","path":"b"}'), encoding="utf-8")
        with patch.object(Path, "read_text", side_effect=AssertionError("Manifest read")):
            with self.assertRaises(ImportCancelled):
                self.workspace.import_manifest(self.manifest, cancelled=cancelled)
        self.assert_preserved()

    def test_cancellation_during_object_hook_stops_before_duplicate_or_ingest(self):
        self.manifest.write_text(self.document('{"path":"a","path":"b"}'), encoding="utf-8")
        cancelled = threading.Event()
        loads = json.loads

        def cancel_before_hook(content, **kwargs):
            hook = kwargs["object_pairs_hook"]
            def cancelled_hook(pairs):
                cancelled.set()
                return hook(pairs)
            return loads(content, object_pairs_hook=cancelled_hook)

        with patch("audio_review_desk.workspace.json.loads", side_effect=cancel_before_hook), \
             patch.object(self.workspace, "ingest") as ingest:
            with self.assertRaises(ImportCancelled):
                self.workspace.import_manifest(self.manifest, cancelled=cancelled)
            ingest.assert_not_called()
        self.assert_preserved()


if __name__ == "__main__":
    unittest.main()
