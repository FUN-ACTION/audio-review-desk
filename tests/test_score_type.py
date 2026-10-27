"""Verify the shipped type assets without requiring font tooling in CI."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_fonts import ui_characters
from scripts.build_score_type import (
    COMMIT,
    LICENSE_SHA256,
    SANS_SHA256,
    SOURCE_NAME,
    SOURCE_SHA256,
    checked_source,
)


class ScoreTypeTests(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[1]
        self.static = self.repo / "src/audio_review_desk/static"
        self.record = json.loads((self.repo / "scripts/fonts/score.json").read_text(encoding="utf-8"))

    def test_shipped_fonts_and_complete_licenses_match_the_build_record(self):
        fonts = {item["file"]: item for item in self.record["fonts"]}
        self.assertEqual(set(fonts), {"tour/score-serif.woff2", "tour/score-sans.woff2", "studio-cjk.woff2"})
        for item in fonts.values():
            with self.subTest(font=item["file"]):
                data = (self.static / item["file"]).read_bytes()
                self.assertEqual(data[:4], b"wOF2")
                self.assertEqual(len(data), item["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])
                license_data = (self.static / item["license_file"]).read_bytes()
                self.assertEqual(hashlib.sha256(license_data).hexdigest(), item["license_sha256"])
                self.assertIn(b"SIL OPEN FONT LICENSE Version 1.1", license_data)
        serif = fonts["tour/score-serif.woff2"]
        self.assertEqual(serif["source_commit"], COMMIT)
        self.assertEqual(serif["source_sha256"], SOURCE_SHA256)
        self.assertEqual(serif["license_sha256"], LICENSE_SHA256)
        self.assertEqual(fonts["studio-cjk.woff2"]["sha256"], SANS_SHA256)
        self.assertEqual(fonts["tour/score-sans.woff2"]["input_sha256"], SANS_SHA256)

    def test_recorded_character_coverage_includes_current_interface_copy(self):
        # The maintainer builder checks the actual font cmaps before recording
        # this list. Hashes above bind that checked coverage to the shipped files.
        required = ui_characters(self.static)
        self.assertTrue(required <= set(self.record["ui_cjk_unicodes"]),
                        "Interface text changed: rebuild with scripts/build_score_type.py")

    def test_rebuild_refuses_missing_or_changed_pinned_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / SOURCE_NAME
            with self.assertRaisesRegex(ValueError, "Missing"):
                checked_source(source, SOURCE_NAME, SOURCE_SHA256, download=False)
            source.write_bytes(b"unverified font replacement")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                checked_source(source, SOURCE_NAME, SOURCE_SHA256, download=False)
            self.assertEqual(source.read_bytes(), b"unverified font replacement")
