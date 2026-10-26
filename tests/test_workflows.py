import csv
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.audio import file_sha256
from audio_review_desk.demo import write_wav
from audio_review_desk.jobs import ImportJobs
from audio_review_desk.workspace import Conflict, ImportCancelled, Workspace


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.audio = self.root / "audio"
        self.workspace = Workspace(self.root / "workspace")
        write_wav(self.audio / "a.wav", seconds=.1)
        write_wav(self.audio / "b.wav", seconds=.1, amplitude=.3)
        self.workspace.scan(self.audio)

    def tearDown(self):
        self.temp.cleanup()

    def changes(self):
        return [{"key": item["key"], "expected_version": item["review"]["version"]}
                for item in self.workspace.state()["items"]]

    def test_append_keeps_other_collections_and_refresh_removes_missing_members(self):
        more = self.root / "more"
        write_wav(more / "c.wav", seconds=.1)
        write_wav(more / "d.wav", seconds=.1)
        self.assertEqual(self.workspace.scan(more, append=True)["stats"]["files"], 4)
        (more / "d.wav").unlink()
        self.assertEqual(self.workspace.scan(more, append=True)["stats"]["files"], 3)
        self.assertEqual(self.workspace.scan(more)["stats"]["files"], 1)

    def test_append_rejects_ambiguous_ids_without_changing_catalog(self):
        more = self.root / "more"
        write_wav(more / "a.wav", seconds=.1)
        before = self.workspace.state()
        with self.assertRaises(Conflict):
            self.workspace.scan(more, append=True)
        self.assertEqual(before["items"], self.workspace.state()["items"])

    def test_existing_reviews_survive_an_unchanged_import(self):
        item = self.workspace.state()["items"][0]
        self.workspace.save_review(item["key"], dict(status="pass", score=7, note="Keep", issues=[], expected_version=0))
        updated = self.workspace.scan(self.audio, append=True)
        self.assertEqual(updated["items"][0]["review"]["score"], 7)

    def test_legacy_catalog_keeps_review_keys_and_unassigned_members(self):
        item = self.workspace.state()["items"][0]
        self.workspace.save_review(item["key"], dict(status="pass", score=7, note="Legacy", issues=[], expected_version=0))
        # 0.1 catalogs had neither collection membership nor a saved import source.
        with self.workspace.connect() as connection:
            for row in connection.execute("SELECT key,metadata FROM assets").fetchall():
                metadata = json.loads(row["metadata"])
                metadata.pop("collection_id")
                connection.execute("UPDATE assets SET metadata=? WHERE key=?", (json.dumps(metadata), row["key"]))
            connection.execute("DELETE FROM settings WHERE key='import_source'")
        self.assertIsNone(self.workspace.import_source())
        (self.audio / "b.wav").unlink()
        appended = self.workspace.scan(self.audio, append=True)
        self.assertEqual(appended["stats"]["files"], 2)
        kept = next(row for row in appended["items"] if row["key"] == item["key"])
        self.assertEqual(kept["review"]["note"], "Legacy")
        replaced = self.workspace.scan(self.audio)
        self.assertEqual(replaced["stats"]["files"], 1)
        self.assertEqual(replaced["items"][0]["key"], item["key"])

    def test_cancelled_import_does_not_replace_catalog(self):
        before = self.workspace.state()
        cancelled = threading.Event()
        def progress(done, total, _label, _phase):
            if done == 1:
                cancelled.set()
        with self.assertRaises(ImportCancelled):
            self.workspace.scan(self.audio, progress=progress, cancelled=cancelled)
        self.assertEqual(before["items"], self.workspace.state()["items"])

    def test_progress_finishes_before_commit(self):
        calls = []
        self.workspace.scan(self.audio, progress=lambda *args: calls.append(args))
        self.assertEqual(calls[-1], (2, 2, "", "saving"))
        self.assertEqual(self.workspace.import_source()["kind"], "directory")
        self.assertNotIn(str(self.audio), json.dumps(self.workspace.state()))

    def test_batch_is_atomic_if_a_later_row_is_stale(self):
        changes = self.changes()
        self.workspace.save_review(changes[1]["key"], dict(status="fix", score=0, note="Zero is intentional", issues=[], expected_version=0))
        with self.assertRaises(Conflict):
            self.workspace.batch_review(changes, "exclude")
        items = self.workspace.state()["items"]
        self.assertEqual(items[0]["review"]["version"], 0)
        self.assertEqual(items[1]["review"]["score"], 0)

    def test_batch_keeps_notes_scores_and_history_and_cannot_approve(self):
        key = self.changes()[0]["key"]
        self.workspace.save_review(key, dict(status="pass", score=8, note="Listen at the end", issues=["noise"], expected_version=0))
        self.assertEqual(self.workspace.batch_review(self.changes(), "fix"), 2)
        review = self.workspace.state()["items"][0]["review"]
        self.assertEqual((review["note"], review["score"], review["origin"]), ("Listen at the end", 8, "batch_ui"))
        self.assertEqual(len(self.workspace.history(key)), 2)
        with self.assertRaises(ValueError):
            self.workspace.batch_review(self.changes(), "pass")

    def test_undo_appends_a_revision_and_checks_expected_version(self):
        key = self.changes()[0]["key"]
        self.workspace.save_review(key, dict(status="fix", score=0, note="First", issues=[], expected_version=0))
        self.workspace.save_review(key, dict(status="pass", score=9, note="Second", issues=[], expected_version=1))
        with self.assertRaises(Conflict):
            self.workspace.undo_review(key, 1)
        restored = self.workspace.undo_review(key, 2)
        self.assertEqual((restored["status"], restored["score"], restored["version"], restored["origin"]), ("fix", 0, 3, "undo"))
        self.assertEqual(len(self.workspace.history(key)), 3)

    def test_first_review_can_be_undone_to_unscored_pending(self):
        key = self.changes()[0]["key"]
        with self.assertRaises(ValueError):
            self.workspace.undo_review(key, 0)
        self.workspace.save_review(key, dict(status="fix", score=0, note="", issues=[], expected_version=0))
        restored = self.workspace.undo_review(key, 1)
        self.assertEqual(restored["status"], "pending")
        self.assertIsNone(restored["score"])

    def test_csv_filter_and_formula_escaping(self):
        key = self.changes()[0]["key"]
        self.workspace.save_review(key, dict(status="pass", score=0, note="=HYPERLINK(\"bad\")", issues=[], expected_version=0))
        rows = list(csv.DictReader(io.StringIO(self.workspace.export_csv("pass"))))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["score"], "0")
        self.assertTrue(rows[0]["note"].startswith("'="))
        self.assertNotIn("path", rows[0])

    def test_jobs_report_success_and_exclude_concurrent_imports(self):
        jobs = ImportJobs(self.workspace)
        entered, release = threading.Event(), threading.Event()
        original = self.workspace.scan
        def scan(*args, **kwargs):
            entered.set()
            release.wait(5)
            return original(*args, **kwargs)
        with patch.object(self.workspace, "scan", side_effect=scan):
            first = jobs.start("directory", str(self.audio))
            self.assertTrue(entered.wait(3))
            with self.assertRaises(Conflict):
                jobs.start("directory", str(self.audio))
            release.set()
            jobs.thread.join(5)
        self.assertEqual(jobs.snapshot()["state"], "succeeded")
        self.assertEqual(jobs.snapshot()["done"], 2)
        with self.assertRaises(Conflict):
            jobs.cancel(first["id"])

    def test_job_cancellation_preserves_sources_and_database(self):
        jobs = ImportJobs(self.workspace)
        originals = {path: file_sha256(path) for path in self.audio.iterdir()}
        before = self.workspace.state()["items"]
        entered, release = threading.Event(), threading.Event()
        original = self.workspace.scan
        def scan(*args, **kwargs):
            entered.set()
            release.wait(5)
            return original(*args, **kwargs)
        with patch.object(self.workspace, "scan", side_effect=scan):
            job = jobs.start("directory", str(self.audio))
            self.assertTrue(entered.wait(3))
            jobs.cancel(job["id"])
            release.set()
            jobs.thread.join(5)
        self.assertEqual(jobs.snapshot()["state"], "cancelled")
        self.assertEqual(before, self.workspace.state()["items"])
        self.assertEqual(originals, {path: file_sha256(path) for path in self.audio.iterdir()})

    def test_reading_failed_job_is_reported_without_catalog_replacement(self):
        empty = self.root / "empty"
        empty.mkdir()
        jobs = ImportJobs(self.workspace)
        before = self.workspace.state()["items"]
        jobs.start("directory", str(empty))
        jobs.thread.join(5)
        self.assertEqual(jobs.snapshot()["state"], "failed")
        self.assertEqual(before, self.workspace.state()["items"])


if __name__ == "__main__":
    unittest.main()
