import hashlib
import json
import unittest
from pathlib import Path

from scripts.build_fonts import ui_characters


class FontBundleTests(unittest.TestCase):
    def test_bundle_hashes_and_interface_character_coverage(self):
        repo = Path(__file__).resolve().parents[1]
        static = repo / 'src/audio_review_desk/static'
        record = json.loads((repo / 'scripts/fonts/bundle.json').read_text(encoding='utf-8'))
        self.assertEqual(len(record['fonts']), 4)
        for font in record['fonts']:
            data = (static / font['file']).read_bytes()
            self.assertEqual(data[:4], b'wOF2')
            self.assertEqual(hashlib.sha256(data).hexdigest(), font['sha256'])
            self.assertEqual(len(data), font['bytes'])
        self.assertTrue(ui_characters(static) <= set(record['ui_cjk_unicodes']),
                        'Interface copy changed: rebuild fonts with scripts/build_fonts.py')
        ui = next(font for font in record['fonts'] if font['file'] == 'desk-cjk-ui.woff2')
        common = next(font for font in record['fonts'] if font['file'] == 'studio-cjk.woff2')
        self.assertLess(ui['bytes'], common['bytes'] / 4)
