"""Copy-only coverage updates verify bytes and cmap before changing the manifest."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.build_studio_fonts import refresh_coverage


class CoverageRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.static = self.repo / 'src/audio_review_desk/static'
        self.static.mkdir(parents=True)
        self.manifest = self.repo / 'scripts/fonts/studio.json'
        self.manifest.parent.mkdir(parents=True)
        self.font = self.static / 'MiSans-Regular.woff2'
        self.font.write_bytes(b'pinned font test fixture')
        digest = hashlib.sha256(self.font.read_bytes()).hexdigest()
        self.record = dict(build={'python': 'original build'}, fonts=[dict(
            file=self.font.name, bytes=self.font.stat().st_size, sha256=digest,
            source_sha256=digest, unchanged=True)], ui_cjk_unicodes=[])
        self.manifest.write_text(json.dumps(self.record), encoding='utf-8')
        (self.static / 'copy.js').write_text("const copy = '听审';", encoding='utf-8')

    def checked(self, characters='听审'):
        class Font:
            def __init__(self, path): self.path = path
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def getBestCmap(self): return {ord(char): char for char in characters}
        with patch.dict(sys.modules, {'fontTools.ttLib': SimpleNamespace(TTFont=Font)}), \
             patch('scripts.build_studio_fonts.importlib.metadata.version', return_value='test'):
            return refresh_coverage(self.repo)

    def test_checked_copy_updates_coverage_without_rewriting_font_or_build_provenance(self):
        original = self.font.read_bytes()
        report = self.checked()
        self.assertEqual(report['ui_cjk_unicodes'], sorted(map(ord, '听审')))
        self.assertEqual(report['build'], self.record['build'])
        self.assertEqual(report['fonts'], self.record['fonts'])
        self.assertEqual(self.font.read_bytes(), original)
        self.assertEqual(json.loads(self.manifest.read_text())['coverage_check']['characters'], 2)

    def test_changed_shipped_font_fails_without_changing_manifest(self):
        original = self.manifest.read_bytes()
        self.font.write_bytes(b'modified bytes')
        with self.assertRaisesRegex(ValueError, 'differs from its build record'):
            self.checked()
        self.assertEqual(self.manifest.read_bytes(), original)

    def test_missing_glyph_fails_without_claiming_coverage(self):
        original = self.manifest.read_bytes()
        with self.assertRaisesRegex(ValueError, 'does not cover the interface'):
            self.checked('听')
        self.assertEqual(self.manifest.read_bytes(), original)

    def test_unchanged_font_must_match_the_pinned_source(self):
        self.record['fonts'][0]['source_sha256'] = 'different source'
        self.manifest.write_text(json.dumps(self.record), encoding='utf-8')
        original = self.manifest.read_bytes()
        with self.assertRaisesRegex(ValueError, 'differs from its pinned source'):
            self.checked()
        self.assertEqual(self.manifest.read_bytes(), original)
