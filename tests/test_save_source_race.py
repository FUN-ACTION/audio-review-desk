"""Review validation must use the source and catalog after a real SQLite wait."""
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Conflict, Workspace


class SaveSourceRaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.a = self.root / "audio/a.wav"
        self.b = self.root / "audio/b.wav"
        write_wav(self.a, seconds=.25)
        write_wav(self.b, seconds=.25, amplitude=.3)
        self.workspace = Workspace(self.root / "workspace")
        self.key = self.workspace.ingest(
            [{"id": "a", "path": str(self.a), "reference_path": str(self.b)}],
            self.root, kind="manifest")["items"][0]["key"]
        self.payload = dict(status="pass", score=0, note="heard", issues=[], expected_version=0)

    def snapshot(self):
        with self.workspace.connect() as connection:
            return (self.workspace.review(connection, self.key), self.workspace.history(self.key))

    def save_while_writer(self, change, payload=None):
        """Signal at SQLite's real BEGIN, mutate while its writer lock is held."""
        beginning = threading.Event()
        original_connect = self.workspace.connect

        @contextmanager
        def traced_connect():
            with original_connect() as connection:
                connection.set_trace_callback(
                    lambda sql: beginning.set() if sql == "BEGIN IMMEDIATE" else None)
                yield connection

        with ThreadPoolExecutor(max_workers=1) as pool:
            with original_connect() as blocker:
                blocker.execute("BEGIN IMMEDIATE")
                with patch.object(self.workspace, "connect", traced_connect):
                    future = pool.submit(self.workspace.save_review, self.key,
                                         self.payload if payload is None else payload)
                    try:
                        self.assertTrue(beginning.wait(5), "Save did not attempt its write transaction")
                        self.assertFalse(future.done(), "Save bypassed the held writer lock")
                        change(blocker)
                    finally:
                        blocker.commit()
                    return future.result(timeout=5)

    def assert_lock_released(self):
        with sqlite3.connect(self.workspace.db, timeout=0) as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.rollback()

    def test_changed_a_during_wait_rejects_without_writes(self):
        before = self.snapshot()
        with self.assertRaisesRegex(Conflict, "Source changed"):
            self.save_while_writer(lambda _: write_wav(self.a, seconds=.25, amplitude=.8))
        self.assertEqual(self.snapshot(), before)
        self.assert_lock_released()

    def test_changed_b_during_wait_rejects_without_writes(self):
        before = self.snapshot()
        with self.assertRaisesRegex(Conflict, "Source changed"):
            self.save_while_writer(lambda _: write_wav(self.b, seconds=.25, amplitude=.8))
        self.assertEqual(self.snapshot(), before)
        self.assert_lock_released()

    def test_unchanged_wait_saves_once_and_preserves_legacy_markers(self):
        previous = self.workspace.save_review(self.key, dict(
            self.payload, markers=[{"time": .1, "text": "Keep me"}]))
        saved = self.save_while_writer(lambda _: None, dict(self.payload, expected_version=1))
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["markers"], previous["markers"])
        self.assertEqual(saved["score"], 0)
        self.assertEqual(saved["origin"], "human_ui")
        self.assertEqual(self.workspace.history(self.key), [previous, saved])
        self.assertEqual(self.snapshot()[0], saved)
        self.assert_lock_released()

    def test_stale_revision_during_wait_does_not_overwrite_other_writer(self):
        other = []

        def update(connection):
            clean = self.workspace.validate_review(self.workspace.asset(self.key),
                                                   dict(self.payload, status="fix", note="Other page"))
            other.append(self.workspace.write_review(connection, self.key, clean, 1, "other_ui"))

        with self.assertRaisesRegex(Conflict, "Another page"):
            self.save_while_writer(update)
        self.assertEqual(self.snapshot(), (other[0], other))
        self.assert_lock_released()

    def test_inactive_during_wait_rejects_without_writes(self):
        before = self.snapshot()
        with self.assertRaisesRegex(Conflict, "Audio version changed"):
            self.save_while_writer(lambda connection: connection.execute(
                "UPDATE assets SET active=0 WHERE key=?", (self.key,)))
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.workspace.state()["items"], [])
        self.assert_lock_released()

    def test_current_metadata_is_revalidated_after_wait(self):
        before = self.snapshot()

        def update(connection):
            asset = self.workspace.asset(self.key)
            asset["quality"]["duration"] = .05
            connection.execute("UPDATE assets SET metadata=? WHERE key=?", (json.dumps(asset), self.key))

        with self.assertRaisesRegex(ValueError, "Trim bounds"):
            self.save_while_writer(update, dict(self.payload, trim_end=.2))
        self.assertEqual(self.snapshot(), before)
        self.assert_lock_released()

    def test_current_source_path_is_verified_after_wait(self):
        before = self.snapshot()
        replacement = self.root / "audio/replacement.wav"
        write_wav(replacement, seconds=.25, amplitude=.8)

        def update(connection):
            asset = self.workspace.asset(self.key)
            asset["path"] = str(replacement)
            connection.execute("UPDATE assets SET metadata=? WHERE key=?", (json.dumps(asset), self.key))

        with self.assertRaisesRegex(Conflict, "Source changed"):
            self.save_while_writer(update)
        self.assertEqual(self.snapshot(), before)
        self.assert_lock_released()

    def test_hash_read_error_after_wait_rolls_back_and_releases_lock(self):
        previous = self.workspace.save_review(self.key, self.payload)
        original = self.b.read_bytes()
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.save_while_writer(lambda _: self.b.unlink(), dict(self.payload, expected_version=1))
        self.assertEqual(self.snapshot(), before)
        self.assert_lock_released()
        self.b.write_bytes(original)
        saved = self.workspace.save_review(self.key, dict(self.payload, expected_version=1))
        self.assertEqual(self.workspace.history(self.key), [previous, saved])
        self.assertEqual(saved["version"], 2)


if __name__ == "__main__":
    unittest.main()
