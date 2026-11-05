"""Failed preparation must not reserve an unusable export destination."""
import contextlib
from concurrent.futures import ThreadPoolExecutor
import csv
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from audio_review_desk.cli import _publish_export, _write_export, main
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Workspace


class ExportSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "audio" / "测试.wav"
        write_wav(self.source, seconds=.01)
        self.original = self.source.read_bytes()
        self.workspace = Workspace(self.root / "workspace")
        self.workspace.scan(self.source.parent)

    def run_export(self, target, format="json", *extra):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return main(["export", "--workspace", str(self.workspace.root),
                         "--format", format, "--output", str(target), *extra])

    def protected_hashes(self):
        return [hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (self.source, self.workspace.db)]

    def test_changed_source_leaves_no_destination_and_corrected_retry_succeeds(self):
        for format in ("json", "csv"):
            with self.subTest(format=format):
                target = self.root / format / "nested" / f"reviews.{format}"
                self.source.write_bytes(self.original + b"changed")
                before = self.protected_hashes()
                self.assertEqual(self.run_export(target, format), 2)
                self.assertEqual(self.protected_hashes(), before)
                self.assertFalse(target.exists())
                self.assertFalse(target.parent.exists())
                self.source.write_bytes(self.original)
                before = self.protected_hashes()
                self.assertEqual(self.run_export(target, format), 0)
                self.assertEqual(self.protected_hashes(), before)
                if format == "json":
                    self.assertEqual(len(json.loads(target.read_text(encoding="utf-8"))["items"]), 1)
                else:
                    self.assertTrue(target.read_bytes().startswith(b"\xef\xbb\xbf"))
                    self.assertNotIn(b"\r\r\n", target.read_bytes())
                    rows = list(csv.DictReader(io.StringIO(target.read_text(encoding="utf-8-sig"))))
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]["label"], "测试.wav")

    def test_missing_source_does_not_create_export_paths(self):
        self.source.unlink()
        for format in ("json", "csv"):
            target = self.root / format / f"missing.{format}"
            self.assertEqual(self.run_export(target, format), 2)
            self.assertFalse(target.parent.exists())

    def test_serialization_failure_does_not_create_export_paths(self):
        cases = [("json", "export", {"invalid": float("nan")}),
                 ("csv", "export_csv", ValueError("serialization failed"))]
        for format, method, outcome in cases:
            with self.subTest(format=format):
                target = self.root / format / f"invalid.{format}"
                option = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
                with patch.object(Workspace, method, **option):
                    self.assertEqual(self.run_export(target, format), 2)
                self.assertFalse(target.parent.exists())

    def test_invalid_utf8_is_rejected_before_a_file_or_parent_is_created(self):
        for format, method, outcome in [("json", "export", {"invalid": "\ud800"}),
                                        ("csv", "export_csv", "\ud800")]:
            with self.subTest(format=format), patch.object(Workspace, method, return_value=outcome):
                target = self.root / format / f"encoding.{format}"
                self.assertEqual(self.run_export(target, format), 2)
                self.assertFalse(target.parent.exists())

    def test_existing_destinations_source_and_database_never_change(self):
        for target in (self.root / "existing.json", self.source, self.workspace.db):
            if not target.exists():
                target.write_bytes(b"keep this exact content")
            before = target.read_bytes(), self.protected_hashes()
            self.assertEqual(self.run_export(target), 2)
            self.assertEqual((target.read_bytes(), self.protected_hashes()), before)

    def test_destination_created_during_preparation_is_not_overwritten(self):
        target = self.root / "racing.json"
        original_export = self.workspace.export()

        def competing_writer(*args, **kwargs):
            target.write_bytes(b"another writer")
            return original_export

        with patch.object(Workspace, "export", side_effect=competing_writer):
            self.assertEqual(self.run_export(target), 2)
        self.assertEqual(target.read_bytes(), b"another writer")

    def test_filtered_outputs_keep_their_original_json_and_csv_shapes(self):
        for format in ("json", "csv"):
            with self.subTest(format=format):
                target = self.root / "filtered" / f"approved.{format}"
                self.assertEqual(self.run_export(target, format, "--status", "pass"), 0)
                if format == "json":
                    result = json.loads(target.read_text(encoding="utf-8"))
                    self.assertEqual(result["items"], [])
                    self.assertEqual(result["stats"]["files"], 0)
                else:
                    rows = list(csv.DictReader(io.StringIO(target.read_text(encoding="utf-8-sig"))))
                    self.assertEqual(rows, [])

    def test_write_flush_close_and_sync_failures_leave_retry_available(self):
        factory = tempfile.NamedTemporaryFile
        for format in ("json", "csv"):
            for failure in ("write", "short", "flush", "close", "sync"):
                with self.subTest(format=format, failure=failure):
                    target = self.root / f"{failure}.{format}"
                    before = self.protected_hashes()
                    owner = self

                    class FaultyStream:
                        def __init__(self, *args, **kwargs):
                            self.stream = factory(*args, **kwargs)

                        def __getattr__(self, name):
                            return getattr(self.stream, name)

                        def __enter__(self):
                            return self

                        def __exit__(self, *args):
                            self.stream.close()
                            owner.assertFalse(target.exists())
                            if failure == "close":
                                raise OSError("injected close failure")

                        def write(self, data):
                            owner.assertFalse(target.exists())
                            if failure in {"write", "short"}:
                                self.stream.write(data[:7])
                                if failure == "write":
                                    raise OSError("injected partial write failure")
                                return 7
                            return self.stream.write(data)

                        def flush(self):
                            owner.assertFalse(target.exists())
                            self.stream.flush()
                            if failure == "flush":
                                raise OSError("injected flush failure")

                    with contextlib.ExitStack() as stack:
                        stack.enter_context(patch("audio_review_desk.cli.tempfile.NamedTemporaryFile", FaultyStream))
                        if failure == "sync":
                            stack.enter_context(patch("audio_review_desk.cli.os.fsync", side_effect=OSError("sync failed")))
                        self.assertEqual(self.run_export(target, format), 2)
                    self.assertFalse(target.exists())
                    self.assertEqual(list(self.root.glob(".audio-review-export-*.tmp")), [])
                    self.assertEqual(self.protected_hashes(), before)
                    self.assertEqual(self.run_export(target, format), 0)
                    self.assertTrue(target.read_bytes())
                    self.assertEqual(self.protected_hashes(), before)

    def test_destination_created_at_publication_is_never_overwritten(self):
        target = self.root / "racing-final.json"

        def competing_writer(temporary, output):
            self.assertFalse(target.exists())
            self.assertEqual(len(json.loads(Path(temporary).read_bytes())["items"]), 1)
            target.write_bytes(b"another writer at publication")
            _publish_export(temporary, output)

        with patch("audio_review_desk.cli._publish_export", side_effect=competing_writer):
            self.assertEqual(self.run_export(target), 2)
        self.assertEqual(target.read_bytes(), b"another writer at publication")
        self.assertEqual(list(self.root.glob(".audio-review-export-*.tmp")), [])

    @unittest.skipUnless(os.name == "posix", "POSIX hard-link publication")
    def test_unsupported_hard_links_fail_without_unsafe_fallback(self):
        target = self.root / "unsupported.json"
        with patch("audio_review_desk.cli.os.link", side_effect=OSError(errno.EOPNOTSUPP, "unsupported")), \
                patch("audio_review_desk.cli.os.rename") as rename, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaisesRegex(OSError, "supports hard links"):
                _publish_export("temporary", target)
            self.assertEqual(self.run_export(target), 2)
        rename.assert_not_called()
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob(".audio-review-export-*.tmp")), [])
        self.assertEqual(self.run_export(target), 0)

    def test_cleanup_failure_preserves_success_or_original_failure(self):
        for fails in (False, True):
            with self.subTest(fails=fails):
                target = self.root / f"cleanup-{fails}.json"
                with contextlib.ExitStack() as stack:
                    stack.enter_context(patch("audio_review_desk.cli.os.unlink", side_effect=PermissionError("cleanup denied")))
                    if fails:
                        stack.enter_context(patch("audio_review_desk.cli.os.fsync", side_effect=OSError("original sync error")))
                    errors = stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
                    stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                    result = main(["export", "--workspace", str(self.workspace.root), "--output", str(target)])
                self.assertEqual(result, 2 if fails else 0)
                self.assertIn("Warning: could not remove temporary export", errors.getvalue())
                self.assertEqual(target.exists(), not fails)
                if fails:
                    self.assertIn("Error: original sync error", errors.getvalue())
                    self.assertEqual(self.run_export(target), 0)
                self.assertEqual(len(json.loads(target.read_bytes())["items"]), 1)
                for temporary in self.root.glob(".audio-review-export-*.tmp"):
                    temporary.unlink()

    @unittest.skipUnless(os.name == "posix", "POSIX permissions and symlinks")
    def test_private_permissions_and_existing_dangling_symlink(self):
        target = self.root / "private.json"
        self.assertEqual(self.run_export(target), 0)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        target = self.root / "dangling.json"
        missing = self.root / "missing.json"
        target.symlink_to(missing)
        self.assertEqual(self.run_export(target), 2)
        self.assertTrue(target.is_symlink())
        self.assertFalse(missing.exists())

    def test_windows_publication_uses_only_non_replacing_rename(self):
        target = self.root / "windows.json"
        with patch("audio_review_desk.cli.os.name", "nt"), \
                patch("audio_review_desk.cli.os.rename") as rename, \
                patch("audio_review_desk.cli.os.link") as link:
            _publish_export("temporary", target)
            rename.assert_called_once_with("temporary", target)
            link.assert_not_called()
            rename.side_effect = FileExistsError("destination exists")
            with self.assertRaises(FileExistsError):
                _publish_export("temporary", target)
            link.assert_not_called()

    def test_concurrent_exporters_publish_one_complete_winner(self):
        target = self.root / "concurrent.json"
        ready = threading.Barrier(2)
        payloads = [b"first" * 10000, b"second" * 10000]

        def publish(temporary, output):
            ready.wait(timeout=10)
            _publish_export(temporary, output)

        def export(data):
            try:
                _write_export(target, data)
                return "published"
            except FileExistsError:
                return "exists"

        with patch("audio_review_desk.cli._publish_export", side_effect=publish), \
                ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(export, payloads))
        self.assertCountEqual(outcomes, ["published", "exists"])
        self.assertIn(target.read_bytes(), payloads)
        self.assertEqual(list(self.root.glob(".audio-review-export-*.tmp")), [])

    def test_keyboard_interrupt_before_publication_cleans_up_and_allows_retry(self):
        target = self.root / "interrupted.json"
        with patch("audio_review_desk.cli.os.fsync", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                _write_export(target, b"complete data")
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob(".audio-review-export-*.tmp")), [])
        _write_export(target, b"complete data")
        self.assertEqual(target.read_bytes(), b"complete data")

    def test_uncertain_publication_never_removes_completed_destination(self):
        target = self.root / "uncertain.json"

        def publish_then_error(temporary, output):
            _publish_export(temporary, output)
            raise OSError("injected lost publication acknowledgment")

        with patch("audio_review_desk.cli._publish_export", side_effect=publish_then_error):
            self.assertEqual(self.run_export(target), 2)
        before = target.read_bytes()
        self.assertEqual(len(json.loads(before)["items"]), 1)
        self.assertEqual(list(self.root.glob(".audio-review-export-*.tmp")), [])
        self.assertEqual(self.run_export(target), 2)
        self.assertEqual(target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
