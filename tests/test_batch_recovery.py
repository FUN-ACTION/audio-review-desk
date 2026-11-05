"""Committed batch responses use one transaction without breaking integer callers."""
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Conflict, Workspace


class BatchRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.audio = self.root / "audio"
        self.workspace = Workspace(self.root / "workspace")
        for name in ("a", "b"):
            write_wav(self.audio / f"{name}.wav", seconds=.25)
        self.workspace.scan(self.audio)

    def tearDown(self):
        self.temp.cleanup()

    def changes(self):
        return [{"key": item["key"], "expected_version": item["review"]["version"]}
                for item in self.workspace.state()["items"]]

    def snapshot(self):
        state = self.workspace.state()
        return state, {item["key"]: self.workspace.history(item["key"]) for item in state["items"]}

    def test_result_contains_exact_committed_reviews_and_preserved_fields(self):
        key = self.changes()[0]["key"]
        previous = self.workspace.save_review(key, dict(
            status="pass", score=0, note="Keep the note", issues=["noise", "other"], expected_version=0,
            trim_start=0, trim_end=.123456, markers=[{"time": .012345, "text": "Keep the marker"}]))
        changes = self.changes()
        result = self.workspace.batch_review_result(changes, "exclude")
        self.assertIs(type(result["saved"]), int)
        self.assertEqual(result["saved"], 2)
        self.assertEqual([row["key"] for row in result["reviews"]], [row["key"] for row in changes])
        state = {item["key"]: item["review"] for item in self.workspace.state()["items"]}
        for row in result["reviews"]:
            self.assertEqual(row["review"], state[row["key"]])
            self.assertEqual(row["review"], self.workspace.history(row["key"])[-1])
            self.assertEqual(row["review"]["status"], "exclude")
            self.assertEqual(row["review"]["origin"], "batch_ui")
            self.assertTrue(row["review"]["updated_utc"])
        for field in ("score", "note", "issues", "trim_start", "trim_end", "markers"):
            self.assertEqual(state[key][field], previous[field])
        self.assertEqual(state[key]["version"], 2)
        other = next(value for other_key, value in state.items() if other_key != key)
        self.assertIsNone(other["score"])
        self.assertIsNone(other["trim_start"])
        self.assertIsNone(other["trim_end"])
        self.assertEqual(other["markers"], [])

    def test_legacy_integer_wrapper_executes_exactly_one_batch(self):
        changes = self.changes()
        with patch.object(self.workspace, "batch_review_result", wraps=self.workspace.batch_review_result) as rich:
            saved = self.workspace.batch_review(changes, "fix")
        self.assertIs(type(saved), int)
        self.assertEqual(saved, 2)
        rich.assert_called_once_with(changes, "fix")
        for change in changes:
            history = self.workspace.history(change["key"])
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["version"], 1)

    def test_later_stale_row_rolls_back_without_a_result_or_new_history(self):
        changes = self.changes()
        self.workspace.save_review(changes[1]["key"], dict(status="fix", score=0, note="Other page", issues=[], expected_version=0))
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.workspace.batch_review_result(changes, "exclude")
        self.assertEqual(self.snapshot(), before)

    def test_changed_source_does_not_commit_other_batch_members(self):
        changes = self.changes()
        write_wav(self.audio / "b.wav", seconds=.25, amplitude=.8)
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.workspace.batch_review_result(changes, "exclude")
        self.assertEqual(self.snapshot(), before)

    def test_invalid_batch_inputs_never_change_reviews_or_history(self):
        changes = self.changes()
        before = self.snapshot()
        for payload, status in [(changes, "pass"), ([], "fix"), ([changes[0], changes[0]], "fix"),
                                ([{"key": "missing", "expected_version": 0}], "fix"),
                                ([dict(changes[0], expected_version=True)], "fix")]:
            with self.subTest(payload=payload, status=status), self.assertRaises(ValueError):
                self.workspace.batch_review_result(payload, status)
            self.assertEqual(self.snapshot(), before)

    def test_second_write_failure_rolls_back_review_and_history(self):
        changes, before = self.changes(), self.snapshot()
        original, calls = self.workspace.write_review, []

        def fail_second(connection, key, clean, version, origin):
            calls.append(key)
            if len(calls) == 2:
                raise sqlite3.OperationalError("injected second write failure")
            return original(connection, key, clean, version, origin)

        with patch.object(self.workspace, "write_review", side_effect=fail_second):
            with self.assertRaises(sqlite3.OperationalError):
                self.workspace.batch_review_result(changes, "exclude")
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.snapshot(), before)

    def test_transaction_exit_failure_cannot_return_a_success_result(self):
        changes, before = self.changes(), self.snapshot()
        connect = self.workspace.connect

        @contextmanager
        def fail_exit():
            with connect() as connection:
                yield connection
                raise sqlite3.OperationalError("injected failure before transaction commit")

        with patch.object(self.workspace, "connect", side_effect=fail_exit):
            with self.assertRaises(sqlite3.OperationalError):
                self.workspace.batch_review_result(changes, "exclude")
        self.assertEqual(self.snapshot(), before)

    def test_result_retains_its_own_commit_when_another_writer_immediately_follows(self):
        changes = self.changes()
        connect, key = self.workspace.connect, changes[0]["key"]

        @contextmanager
        def later_writer():
            with connect() as connection:
                yield connection
            # The first transaction really committed. Simulate another page
            # writing before the result is handed back to the HTTP handler.
            with connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                current = self.workspace.review(connection, key)
                self.workspace.write_review(connection, key, dict(current, status="pending", note="Newer page"),
                                            current["version"] + 1, "human_ui")

        with patch.object(self.workspace, "connect", side_effect=later_writer), \
                patch.object(self.workspace, "state", side_effect=AssertionError("No post-commit catalog read")):
            result = self.workspace.batch_review_result(changes, "exclude")
        returned = next(row["review"] for row in result["reviews"] if row["key"] == key)
        self.assertEqual((returned["status"], returned["version"], returned["note"]), ("exclude", 1, ""))
        current = next(item["review"] for item in self.workspace.state()["items"] if item["key"] == key)
        self.assertEqual((current["status"], current["version"], current["note"]), ("pending", 2, "Newer page"))
        self.assertEqual(returned, self.workspace.history(key)[-2])
