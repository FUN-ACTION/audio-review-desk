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

    def test_note_unicode_codepoint_limit_and_exact_json_roundtrip(self):
        key = self.manifest([self.row()])["items"][0]["key"]
        version = 0
        cases = ["声" * 4000, "🎧" * 4000, "a声🎧" * 1333 + "z",
                 "e\u0301" * 2000, "👩‍👩‍👧‍👦" * 571 + "abc"]
        for note in cases:
            self.assertEqual(len(note), 4000)
            payload = dict(status="fix", expected_version=version, issues=[], note=note)
            saved = self.workspace.save_review(key, json.loads(json.dumps(payload)))
            version = saved["version"]
            self.assertEqual(saved["note"], note)
            self.assertEqual(self.workspace.export()["items"][0]["review"]["note"], note)
            with self.assertRaises(ValueError):
                self.workspace.save_review(key, dict(payload, expected_version=version, note=note + "x"))
            self.assertEqual(self.workspace.state()["items"][0]["review"], saved)
        # These are decoded-string counts, not grapheme counts or a claim that
        # a lone surrogate can pass later SQLite/UTF-8 persistence boundaries.
        self.assertEqual(len(json.loads('"\\ud83c\\udfa7"')), 1)
        self.assertEqual(len(json.loads('"\\ud800"')), 1)

    def test_marker_whitespace_contract_matches_supported_python_strip(self):
        expected = [9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760,
                    8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
                    8202, 8232, 8233, 8239, 8287, 12288]
        # Deliberately fail if a future Python Unicode update changes strip.
        self.assertEqual([p for p in range(0x110000) if chr(p).isspace()], expected)
        asset = {"quality": {"decoded": True, "duration": 2}}
        def validate(text):
            return Workspace.validate_review(asset, dict(status="fix", expected_version=0,
                markers=[{"time": 1, "text": text}]))["markers"][0]["text"]
        for point in expected:
            c = chr(point)
            with self.assertRaises(ValueError):
                validate(c)
            self.assertEqual(validate(c + "🎧" * 240 + c), "🎧" * 240)
            self.assertEqual(validate("a" + c + "b"), "a" + c + "b")
            with self.assertRaises(ValueError):
                validate(c + "a" * 241 + c)
        for c in ["\ufeff", "\u200b", "\u180e"]:
            self.assertEqual(validate(c), c)
            self.assertEqual(validate(c + "text" + c), c + "text" + c)

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

    def test_exact_audio_version_reactivation_restores_review_without_new_history(self):
        audio = self.audio / "a.wav"
        original = audio.read_bytes()
        rows = [self.row(source_id="stable-recording")]
        first = self.manifest(rows)["items"][0]
        key_a = first["key"]
        saved_a = self.workspace.save_review(key_a, dict(
            status="pass", score=0, issues=["other"], note="Original decision 🎧",
            trim_start=.125, trim_end=1.875,
            markers=[{"time": .5, "text": "Original annotation"}], expected_version=0))
        history_a = self.workspace.history(key_a)

        write_wav(audio, seconds=2, amplitude=.45)
        changed = audio.read_bytes()
        self.assertNotEqual(changed, original)
        second = self.manifest(rows)["items"][0]
        key_b = second["key"]
        self.assertNotEqual(key_b, key_a)
        self.assertEqual(second["review"]["version"], 0)
        self.assertEqual(second["review"]["status"], "pending")
        self.assertEqual(self.workspace.history(key_a), history_a)
        self.workspace.save_review(key_b, dict(
            status="exclude", note="Different bytes, different decision",
            markers=[{"time": 1, "text": "B annotation"}], expected_version=0))
        history_b = self.workspace.history(key_b)
        self.assertEqual(audio.read_bytes(), changed)

        audio.write_bytes(original)
        restored = self.manifest(rows)["items"][0]
        self.assertEqual(restored["key"], key_a)
        self.assertEqual(restored["review"], saved_a)
        self.assertEqual(self.workspace.history(key_a), history_a)
        self.assertEqual(self.workspace.history(key_b), history_b)
        with self.workspace.connect() as connection:
            active = {row["key"]: row["active"] for row in connection.execute(
                "SELECT key, active FROM assets WHERE key IN (?, ?)", (key_a, key_b))}
        self.assertEqual(active, {key_a: 1, key_b: 0})

        # A no-change reimport must not manufacture a save or history revision.
        self.assertEqual(self.manifest(rows)["items"][0]["review"], saved_a)
        reopened = Workspace(self.workspace.root)
        self.assertEqual(reopened.state()["items"][0]["key"], key_a)
        self.assertEqual(reopened.history(key_a), history_a)
        self.assertEqual(reopened.history(key_b), history_b)
        exported = reopened.export()["items"]
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["key"], key_a)
        self.assertEqual(exported[0]["review"], saved_a)
        self.assertEqual(audio.read_bytes(), original)

    def test_relocated_identical_ab_sources_preserve_review_and_rebuild_previews(self):
        source_hashes = {name: file_sha256(self.audio / name) for name in ("a.wav", "b.wav")}
        rows = [self.row(source_id="stable-recording", reference_path="audio/b.wav")]
        item = self.manifest(rows)["items"][0]
        key = item["key"]
        saved = self.workspace.save_review(key, dict(
            status="pass", score=0, note="Keep this A/B decision", issues=["other"],
            trim_start=.125, trim_end=1.875,
            markers=[{"time": .5, "text": "Keep this annotation"}], expected_version=0))
        history = self.workspace.history(key)
        previews = {variant: self.workspace.preview(key, variant) for variant in ("a", "b")}
        preview_hashes = {variant: file_sha256(path) for variant, path in previews.items()}
        exported = self.workspace.export()
        with self.workspace.connect() as connection:
            before = tuple(connection.iterdump())

        relocated = self.root / "relocated-audio"
        self.audio.rename(relocated)
        # Existing previews must not bypass unavailable external A/B sources.
        for operation in (lambda: self.workspace.preview(key, "a"),
                          lambda: self.workspace.preview(key, "b"),
                          self.workspace.export,
                          lambda: self.workspace.import_reviews(exported)):
            with self.assertRaises(Conflict):
                operation()
            with self.workspace.connect() as connection:
                self.assertEqual(tuple(connection.iterdump()), before)
        self.assertTrue(all(path.is_file() for path in previews.values()))

        rebound = self.manifest([dict(rows[0], path="relocated-audio/a.wav",
                                    reference_path="relocated-audio/b.wav")])["items"][0]
        self.assertEqual(rebound["key"], key)
        self.assertEqual(rebound["review"], saved)
        self.assertEqual(self.workspace.history(key), history)
        asset = self.workspace.asset(key)
        self.assertEqual(asset["path"], str(relocated / "a.wav"))
        self.assertEqual(asset["reference_path"], str(relocated / "b.wav"))
        for variant, path in previews.items():
            # These are exclusively this test's TemporaryDirectory outputs.
            self.assertEqual(path.parent, self.workspace.root / "previews")
            path.unlink()
            regenerated = self.workspace.preview(key, variant)
            self.assertEqual(regenerated, path)
            self.assertEqual(file_sha256(regenerated), preview_hashes[variant])
        self.assertEqual(self.workspace.export()["items"][0]["review"], saved)
        self.assertEqual(self.workspace.history(key), history)
        self.assertEqual({name: file_sha256(relocated / name) for name in source_hashes}, source_hashes)

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

    def test_restore_rejects_duplicate_review_keys_without_database_or_history_changes(self):
        for item in self.workspace.scan(self.audio)["items"]:
            self.review(item["key"])
        document = self.workspace.export()
        keys = [item["key"] for item in document["items"]]
        self.assertEqual(len(keys), 2)
        document["items"][0]["review"]["note"] = "Must not be restored"
        document["items"].append(copy.deepcopy(document["items"][0]))
        with self.workspace.connect() as connection:
            before = list(connection.iterdump())
        history = {key: self.workspace.history(key) for key in keys}
        with self.assertRaisesRegex(ValueError, "Duplicate review keys"):
            self.workspace.import_reviews(document)
        with self.workspace.connect() as connection:
            self.assertEqual(list(connection.iterdump()), before)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual({key: self.workspace.history(key) for key in keys}, history)

    def test_restore_exact_marker_endpoints_and_later_nextafter_rejection_are_atomic(self):
        for item in self.workspace.scan(self.audio)["items"]:
            self.review(item["key"])
        document = self.workspace.export()
        self.assertEqual(len(document["items"]), 2)
        for item in document["items"]:
            item["review"]["markers"] = [
                {"time": 0, "text": "Start"},
                {"time": item["quality"]["duration"], "text": "Exact end"},
            ]
        self.assertEqual(self.workspace.import_reviews(document), 2)
        restored = self.workspace.export()
        expected = {item["key"]: item["review"]["markers"] for item in document["items"]}
        for item in restored["items"]:
            self.assertEqual(item["review"]["markers"], expected[item["key"]])
            self.assertEqual(self.workspace.history(item["key"])[-1]["markers"], expected[item["key"]])
        invalid = copy.deepcopy(restored)
        invalid["items"][0]["review"]["note"] = "Earlier valid row must not commit"
        last = invalid["items"][-1]
        end = last["quality"]["duration"]
        outside = math.nextafter(end, math.inf)
        self.assertGreater(outside, end)
        last["review"]["markers"][-1]["time"] = outside
        with self.workspace.connect() as connection:
            before = list(connection.iterdump())
        history = {key: self.workspace.history(key) for key in expected}
        with self.assertRaisesRegex(ValueError, "Time notes need a position within the clip"):
            self.workspace.import_reviews(invalid)
        with self.workspace.connect() as connection:
            self.assertEqual(list(connection.iterdump()), before)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual({key: self.workspace.history(key) for key in expected}, history)

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

    def test_unicode_markers_round_trip_with_exact_times_and_atomic_overflow_rejection(self):
        key = self.workspace.scan(self.audio)["items"][0]["key"]
        markers = [{"time": .123456789, "text": "😀" * 150},
                   {"time": 1.123456789, "text": "🎧" * 240},
                   {"time": 1.5, "text": "a声🎵" * 80}]
        self.review(key, markers=markers)
        reopened = Workspace(self.workspace.root)
        saved = next(item for item in reopened.state()["items"] if item["key"] == key)
        self.assertEqual(saved["review"]["markers"], markers)
        exported = json.loads(json.dumps(reopened.export(), ensure_ascii=False))
        fresh = Workspace(self.root / "unicode-restored")
        fresh.scan(self.audio)
        self.assertEqual(fresh.import_reviews(exported), 1)
        restored = next(item for item in fresh.state()["items"] if item["key"] == key)
        self.assertEqual(restored["review"]["markers"], markers)
        self.assertEqual(fresh.history(key)[0]["markers"], markers)
        before = fresh.export()["items"]
        history = fresh.history(key)
        for text in ("声" * 241, "😀" * 241, "a声🎵" * 80 + "z"):
            with self.subTest(text_kind=text[:2]):
                invalid = copy.deepcopy(exported)
                row = next(item for item in invalid["items"] if item["key"] == key)
                row["review"]["markers"][0]["text"] = text
                with self.assertRaises(ValueError):
                    fresh.import_reviews(invalid)
                self.assertEqual(fresh.export()["items"], before)
                self.assertEqual(fresh.history(key), history)

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
