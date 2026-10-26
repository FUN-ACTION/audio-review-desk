import tempfile
import unittest
from pathlib import Path

from scripts.build_showcase import build
from scripts.create_showcase import create


class ShowcaseTests(unittest.TestCase):
    def test_static_build_has_recordings_fonts_and_no_workspace_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination=build(Path(temporary)/'site')
            self.assertEqual(len(list((destination/'tour/media').glob('*.mp4'))),6)
            self.assertEqual((destination/'studio-latin.woff2').read_bytes()[:4],b'wOF2')
            self.assertEqual(list(destination.rglob('*.sqlite')),[])
            self.assertEqual(list(destination.rglob('*.wav')),[])
            with self.assertRaisesRegex(ValueError,'new or empty'):build(destination)

    def test_recording_fixture_never_overwrites_a_populated_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination=Path(temporary)/'recording'
            create(destination)
            original=(destination/'signals/phrase_01.wav').read_bytes()
            with self.assertRaisesRegex(ValueError,'new or empty'):create(destination)
            self.assertEqual((destination/'signals/phrase_01.wav').read_bytes(),original)
