"""Cancellation must stop preparatory work without changing saved reviews."""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from audio_review_desk.audio import Decoder, file_sha256
from audio_review_desk.demo import write_wav
from audio_review_desk.jobs import ImportJobs
from audio_review_desk.workspace import ImportCancelled, Workspace


class ImportCancellationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.audio = self.root / "audio"
        write_wav(self.audio / "saved.wav", seconds=.1)
        self.workspace = Workspace(self.root / "workspace")
        item = self.workspace.scan(self.audio)["items"][0]
        self.key = item["key"]
        self.workspace.save_review(self.key, dict(status="pass", score=8,
            issues=[], note="Keep this review", expected_version=0))
        self.before = self.workspace.state()
        self.source_before = self.workspace.import_source()
        self.history_before = self.workspace.history(self.key)
        self.hash_before = file_sha256(self.audio / "saved.wav")
        self.cancelled = threading.Event()

    def tearDown(self):
        self.temporary.cleanup()

    def assert_preserved(self):
        self.assertEqual(self.workspace.state(), self.before)
        self.assertEqual(self.workspace.import_source(), self.source_before)
        self.assertEqual(self.workspace.history(self.key), self.history_before)
        self.assertEqual(file_sha256(self.audio / "saved.wav"), self.hash_before)

    def cancel_on_first(self, value):
        self.cancelled.set()
        yield value
        self.fail("Cancelled import consumed the remaining input")

    def test_cancel_during_directory_enumeration_stops_before_decoding(self):
        paths = self.cancel_on_first(self.audio / "saved.wav")
        with patch.object(Path, "rglob", return_value=paths), \
             patch("audio_review_desk.workspace.analyze") as analyze:
            with self.assertRaises(ImportCancelled):
                self.workspace.scan(self.audio, cancelled=self.cancelled)
            analyze.assert_not_called()
        self.assert_preserved()

    def test_cancel_during_csv_read_stops_before_decoding(self):
        manifest = self.root / "manifest.csv"
        manifest.write_text("path\naudio/saved.wav\n", encoding="utf-8")
        rows = self.cancel_on_first({"path": "audio/saved.wav"})
        reader = MagicMock(fieldnames=["path"])
        reader.__iter__.return_value = rows
        with patch("audio_review_desk.workspace.csv.DictReader", return_value=reader), \
             patch("audio_review_desk.workspace.analyze") as analyze:
            with self.assertRaises(ImportCancelled):
                self.workspace.import_manifest(manifest, cancelled=self.cancelled)
            analyze.assert_not_called()
        self.assert_preserved()

    def test_cancel_during_row_validation_does_not_read_later_rows(self):
        rows = self.cancel_on_first({"path": "saved.wav"})
        with patch("audio_review_desk.workspace.analyze") as analyze:
            with self.assertRaises(ImportCancelled):
                self.workspace.ingest(rows, self.audio, "manifest", cancelled=self.cancelled)
            analyze.assert_not_called()
        self.assert_preserved()

    def test_already_cancelled_malformed_manifest_is_not_parsed_as_a_failure(self):
        manifest = self.root / "invalid.json"
        manifest.write_text("not json", encoding="utf-8")
        self.cancelled.set()
        with patch.object(Path, "read_text", side_effect=AssertionError("Manifest was read")):
            with self.assertRaises(ImportCancelled):
                self.workspace.import_manifest(manifest, cancelled=self.cancelled)
        self.assert_preserved()

    def test_analysis_cancellation_propagates_and_closes_source_and_reference_decoders(self):
        for variant in ("source", "reference"):
            with self.subTest(variant=variant):
                self.cancelled.clear()
                source = self.audio / "saved.wav"
                reference = self.root / "reference" / "reference.wav"
                write_wav(reference, seconds=.1, amplitude=.1)
                reference_hash = file_sha256(reference)
                stopped = source if variant == "source" else reference
                closed = []
                owner = self

                class CancellingDecoder(Decoder):
                    def blocks(self, path, info):
                        if path != stopped:
                            yield from super().blocks(path, info)
                            return
                        try:
                            owner.cancelled.set()
                            yield b"\0" * 64
                            owner.fail("Cancelled analysis consumed another PCM block")
                        finally:
                            closed.append(path)

                self.workspace.decoder = CancellingDecoder()
                rows = [{"path": str(source), "reference_path": str(reference)}]
                with patch("audio_review_desk.workspace.file_sha256", wraps=file_sha256) as fallback_hash:
                    with self.assertRaises(ImportCancelled):
                        self.workspace.ingest(rows, self.root, "manifest", cancelled=self.cancelled)
                    # The independent B identity is captured before A decoding;
                    # cancellation must not trigger the failed-A fallback hash.
                    self.assertEqual(fallback_hash.call_count, 1)
                    self.assertEqual(fallback_hash.call_args.args, (reference,))
                self.assertEqual(closed, [stopped])
                self.assertEqual(file_sha256(reference), reference_hash)
                self.assert_preserved()

    def test_unset_cancellation_keeps_successful_scan_order_and_audio_results(self):
        write_wav(self.audio / "a.wav", seconds=.1, frequency=440)
        write_wav(self.audio / "z.wav", seconds=.1, frequency=880)
        expected = self.workspace.scan(self.audio)
        progress = []
        actual = self.workspace.scan(self.audio, cancelled=self.cancelled,
            progress=lambda *args: progress.append(args))
        self.assertEqual(actual["items"], expected["items"])
        self.assertEqual(actual["stats"], expected["stats"])
        self.assertEqual([row[2] for row in progress[::2]][:3], ["a.wav", "saved.wav", "z.wav"])

    def test_background_job_reports_cancellation_instead_of_malformed_manifest(self):
        manifest = self.root / "invalid.json"
        manifest.write_text("not json", encoding="utf-8")
        entered, release = threading.Event(), threading.Event()
        original = self.workspace.import_manifest

        def delayed(*args, **kwargs):
            entered.set()
            release.wait(5)
            return original(*args, **kwargs)

        jobs = ImportJobs(self.workspace)
        with patch.object(self.workspace, "import_manifest", side_effect=delayed):
            try:
                job = jobs.start("manifest", str(manifest))
                self.assertTrue(entered.wait(5))
                jobs.cancel(job["id"])
            finally:
                release.set()
                jobs.thread.join(5)
        self.assertFalse(jobs.thread.is_alive())
        self.assertEqual(jobs.snapshot()["state"], "cancelled")
        self.assert_preserved()


if __name__ == "__main__":
    unittest.main()
