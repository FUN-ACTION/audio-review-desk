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
    license_digest,
)


class ScoreTypeTests(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[1]
        self.static = self.repo / "src/audio_review_desk/static"
        self.record = json.loads((self.repo / "scripts/fonts/score.json").read_text(encoding="utf-8"))

    def test_shipped_fonts_and_complete_licenses_match_the_build_record(self):
        fonts = {item["file"]: item for item in self.record["fonts"]}
        self.assertEqual(set(fonts), {"tour/score-serif.woff2", "tour/score-sans.woff2", "studio-cjk.woff2"})
        self.assertEqual(self.record["license_digest_format"], "UTF-8 with LF line endings")
        self.assertEqual(license_digest(b"license\ntext\n"), license_digest(b"license\r\ntext\r\n"))
        for item in fonts.values():
            with self.subTest(font=item["file"]):
                data = (self.static / item["file"]).read_bytes()
                self.assertEqual(data[:4], b"wOF2")
                self.assertEqual(len(data), item["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])
                license_data = (self.static / item["license_file"]).read_bytes()
                self.assertEqual(license_digest(license_data), item["license_sha256"])
                self.assertIn(b"SIL OPEN FONT LICENSE Version 1.1", license_data)
        serif = fonts["tour/score-serif.woff2"]
        self.assertEqual(serif["source_commit"], COMMIT)
        self.assertEqual(serif["source_sha256"], SOURCE_SHA256)
        self.assertEqual(serif["license_sha256"], LICENSE_SHA256)
        self.assertEqual(fonts["studio-cjk.woff2"]["sha256"], SANS_SHA256)
        self.assertEqual(fonts["tour/score-sans.woff2"]["input_sha256"], SANS_SHA256)

    def test_recorded_character_coverage_matches_active_type_choice(self):
        # The maintainer builder checks the actual font cmaps before recording
        # this list. Hashes above bind that checked coverage to the shipped files.
        required = ui_characters(self.static)
        styles = (self.static/'fonts.css').read_text(encoding='utf-8') + (self.static/'tour/tour.css').read_text(encoding='utf-8')
        if 'score-serif.woff2' in styles or 'score-sans.woff2' in styles:
            self.assertTrue(required <= set(self.record["ui_cjk_unicodes"]),
                            "Interface text changed: rebuild with scripts/build_score_type.py")
        else:
            # 0.11 restores MiSans. Keep checking the retained 0.10 font hashes
            # above, but bind new copy to the active MiSans builder's cmap check.
            active = json.loads((self.repo/'scripts/fonts/studio.json').read_text(encoding='utf-8'))
            self.assertIn('MiSans-Regular.woff2', styles)
            self.assertTrue(required <= set(active['ui_cjk_unicodes']))

    def test_rebuild_refuses_missing_or_changed_pinned_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / SOURCE_NAME
            with self.assertRaisesRegex(ValueError, "Missing"):
                checked_source(source, SOURCE_NAME, SOURCE_SHA256, download=False)
            source.write_bytes(b"unverified font replacement")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                checked_source(source, SOURCE_NAME, SOURCE_SHA256, download=False)
            self.assertEqual(source.read_bytes(), b"unverified font replacement")
