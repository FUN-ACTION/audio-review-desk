import copy
import json
import math
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from audio_review_desk.audio import file_sha256
from audio_review_desk.demo import create_demo, write_wav
from audio_review_desk.workspace import Conflict, SCHEMA, Workspace, merge_ranges


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.audio = self.root / "audio"
        self.audio.mkdir()
        write_wav(self.audio / "a.wav", seconds=2)
        write_wav(self.audio / "b.wav", seconds=2, amplitude=.3)
        self.workspace = Workspace(self.root / "workspace")

    def tearDown(self):
        self.temporary.cleanup()

    def manifest(self, rows):
        path = self.root / "manifest.json"
        path.write_text(json.dumps({"schema": SCHEMA, "items": rows}), encoding="utf-8")
        return self.workspace.import_manifest(path)

    def row(self, name="a", **extra):
        return dict(id=name, path=f"audio/{name}.wav", **extra)

    def review(self, key, status="pass", **extra):
        return self.workspace.save_review(key, dict(status=status, score=0, expected_version=0, issues=[], note="heard", **extra))

    def test_overlap_union_and_human_totals(self):
        state = self.manifest([self.row("a", source_id="recording", source_start=10, source_end=12),
                               self.row("b", source_id="recording", source_start=11, source_end=13)])
        self.assertEqual(state["stats"]["candidate_seconds"], 3)
        self.assertEqual(state["stats"]["human_approved_seconds"], 0)
        self.review(state["items"][0]["key"])
        self.assertEqual(self.workspace.state()["stats"]["human_approved_seconds"], 2)
        self.review(state["items"][1]["key"])
        self.assertEqual(self.workspace.state()["stats"]["human_approved_seconds"], 3)

    def test_eligible_false_cannot_add_approved_duration(self):
        state = self.manifest([self.row(eligible=False)])
        self.review(state["items"][0]["key"])
        self.assertEqual(self.workspace.state()["stats"]["human_approved_seconds"], 0)

    def test_default_source_ids_deduplicate_exact_copies(self):
        (self.audio / "b.wav").write_bytes((self.audio / "a.wav").read_bytes())
        state = self.workspace.scan(self.audio)
        self.assertEqual(state["stats"]["raw_seconds"], 4)
        self.assertEqual(state["stats"]["unique_pcm_seconds"], 2)
        self.assertEqual(state["stats"]["candidate_seconds"], 2)

    def test_zero_score_history_and_persistence(self):
        state = self.workspace.scan(self.audio)
        key = state["items"][0]["key"]
        self.review(key)
        again = Workspace(self.workspace.root).state()["items"][0]
        self.assertEqual(again["review"]["score"], 0)
        self.assertEqual(again["review"]["version"], 1)
        self.assertEqual(len(self.workspace.history(key)), 1)

    def test_audio_change_resets_decision_and_keeps_old_history(self):
        state = self.workspace.scan(self.audio)
        key = state["items"][0]["key"]
        self.review(key)
        write_wav(self.audio / "a.wav", amplitude=.45)
        updated = self.workspace.scan(self.audio)["items"][0]
        self.assertNotEqual(key, updated["key"])
        self.assertEqual(updated["review"]["version"], 0)
        self.assertEqual(len(self.workspace.history(key)), 1)

    def test_source_interval_and_eligibility_changes_reset_decision(self):
        for field in ("source_start", "eligible", "source_id"):
            state = self.manifest([self.row()])
            key = state["items"][0]["key"]
            with self.workspace.connect() as connection:
                revision = self.workspace.review(connection, key)["version"]
            self.workspace.save_review(key, dict(status="pass", score=4, issues=[], note="", expected_version=revision))
            changed = {"source_start": 10, "eligible": False, "source_id": "another"}[field]
            updated = self.manifest([self.row(**{field: changed})])["items"][0]
            self.assertNotEqual(key, updated["key"])
            self.assertEqual(updated["review"]["version"], 0)

    def test_reference_changes_reset_but_labels_do_not(self):
        state = self.manifest([self.row(reference_path="audio/b.wav")])
        key = state["items"][0]["key"]
        self.review(key)
        label_only = self.manifest([self.row(label="A new label", reference_path="audio/b.wav")])
        self.assertEqual(label_only["items"][0]["review"]["version"], 1)
        write_wav(self.audio / "b.wav", amplitude=.4)
        changed = self.manifest([self.row(reference_path="audio/b.wav")])
        self.assertNotEqual(changed["items"][0]["key"], key)
        self.assertEqual(changed["items"][0]["review"]["version"], 0)

    def test_stale_concurrent_save_cannot_overwrite(self):
        key = self.workspace.scan(self.audio)["items"][0]["key"]
        def save():
            try:
                self.review(key)
                return "saved"
            except Conflict:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: save(), range(2)))
        self.assertCountEqual(results, ["saved", "conflict"])
        self.assertEqual(len(self.workspace.history(key)), 1)

    def test_modified_source_is_rejected_before_save_and_cached_preview(self):
        key = self.workspace.scan(self.audio)["items"][0]["key"]
        self.workspace.preview(key, "a")
        write_wav(self.audio / "a.wav", amplitude=.7)
        with self.assertRaises(Conflict):
            self.review(key)
        with self.assertRaises(Conflict):
            self.workspace.preview(key, "a")

    def test_trim_changes_counts_without_editing_audio(self):
        key = self.manifest([self.row(source_start=10)])["items"][0]["key"]
        before = file_sha256(self.audio / "a.wav")
        self.review(key, trim_start=.5, trim_end=1.5)
        self.assertEqual(self.workspace.state()["stats"]["human_approved_seconds"], 1)
        self.assertEqual(before, file_sha256(self.audio / "a.wav"))

    def test_invalid_review_numbers_and_trims_are_rejected(self):
        key = self.workspace.scan(self.audio)["items"][0]["key"]
        values = [{"score": math.nan}, {"score": True}, {"score": 11}, {"trim_start": 1, "trim_end": .5},
                  {"trim_start": -1}, {"trim_end": math.inf}, {"issues": ["unknown"]}, {"expected_version": True}]
        for value in values:
            payload = dict(status="pass", score=5, expected_version=0, issues=[], note="")
            payload.update(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.workspace.save_review(key, payload)
        self.assertEqual(len(self.workspace.history(key)), 0)

    def test_broken_audio_remains_visible_but_cannot_pass(self):
        (self.audio / "a.wav").write_bytes(b"broken")
        state = self.manifest([self.row()])
        self.assertEqual(state["stats"]["errors"], 1)
        self.assertFalse(state["items"][0]["eligible"])
        with self.assertRaises(ValueError):
            self.review(state["items"][0]["key"])

    def test_invalid_manifest_does_not_replace_catalog(self):
        before = self.workspace.scan(self.audio)
        with self.assertRaises(ValueError):
            self.manifest([self.row(), self.row()])
        self.assertEqual(before["items"], self.workspace.state()["items"])
        with self.assertRaises(ValueError):
            self.manifest([self.row(eligible="maybe")])

    def test_workspace_inside_source_is_rejected_before_creation(self):
        workspace = Workspace(self.audio / "reviews")
        with self.assertRaises(ValueError):
            workspace.scan(self.audio)
        self.assertFalse(workspace.root.exists())

    def test_manifest_interval_mismatch_is_explicit_error(self):
        item = self.manifest([self.row(source_start=0, source_end=1)])["items"][0]
        self.assertIn("interval", item["error"])
        self.assertFalse(item["quality"]["decoded"])

    def test_export_restore_and_paths_opt_in(self):
        state = self.workspace.scan(self.audio)
        key = state["items"][0]["key"]
        self.review(key)
        exported = self.workspace.export()
        self.assertNotIn("path", exported["items"][0])
        self.assertNotIn(str(self.root), json.dumps(exported))
        self.assertIn("path", self.workspace.export(True)["items"][0])
        fresh = Workspace(self.root / "restored")
        fresh.scan(self.audio)
        self.assertEqual(fresh.import_reviews(exported), 1)
        self.assertEqual(fresh.state()["items"][0]["review"]["score"], 0)
        self.assertEqual(fresh.history(key)[0]["origin"], "imported_review")

    def test_restore_is_atomic_if_later_review_invalid(self):
        state = self.workspace.scan(self.audio)
        for item in state["items"]:
            self.review(item["key"])
        exported = self.workspace.export()
        exported["items"][1]["review"]["score"] = 100
        before = self.workspace.export()
        with self.assertRaises(ValueError):
            self.workspace.import_reviews(exported)
        self.assertEqual(before["items"], self.workspace.export()["items"])

    def test_restore_rejects_hash_mismatch(self):
        state = self.workspace.scan(self.audio)
        self.review(state["items"][0]["key"])
        exported = self.workspace.export()
        exported["items"][0]["quality"]["sha256"] = "wrong"
        with self.assertRaises(Conflict):
            self.workspace.import_reviews(exported)

    def test_export_refuses_stale_source_audio(self):
        state = self.workspace.scan(self.audio)
        self.review(state["items"][0]["key"])
        write_wav(self.audio / "a.wav", amplitude=.6)
        with self.assertRaises(Conflict):
            self.workspace.export()

    def test_reference_preview_rms_matching_and_read_only_inputs(self):
        state = self.manifest([self.row(reference_path="audio/b.wav")])
        key = state["items"][0]["key"]
        originals = {path: file_sha256(path) for path in self.audio.iterdir()}
        from audio_review_desk.audio import analyze
        a = analyze(self.workspace.preview(key, "a"))
        b = analyze(self.workspace.preview(key, "b"))
        self.assertAlmostEqual(a["rms"], b["rms"], places=4)
        self.assertEqual(originals, {path: file_sha256(path) for path in self.audio.iterdir()})

    def test_demo_cannot_overwrite_existing_workspace(self):
        root = self.root / "demo"
        state = create_demo(root)
        self.assertEqual(state["stats"]["files"], 8)
        self.assertEqual(state["stats"]["errors"], 1)
        self.assertGreater(len(state["stats"]["duplicate_groups"]), 0)
        with self.assertRaises(ValueError):
            create_demo(root)


if __name__ == "__main__":
    unittest.main()
