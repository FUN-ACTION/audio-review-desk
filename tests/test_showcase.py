import tempfile
import unittest
import json
import shutil
import subprocess
import struct
import zlib
import hashlib
from pathlib import Path

from scripts.build_showcase import build
from scripts.create_showcase import create
from scripts.encode_showcase import encode, validate_region


class ShowcaseTests(unittest.TestCase):
    def test_shipped_media_matches_the_recording_manifest(self):
        root = Path(__file__).resolve().parents[1]
        record = json.loads((root/'docs/showcase-media.json').read_text(encoding='utf-8'))
        from audio_review_desk import __version__
        self.assertEqual(record['version'], __version__)
        self.assertEqual(len(record['clips']),6)
        media = root/'src/audio_review_desk/static/tour/media'
        for clip in record['clips']:
            self.assertRegex(clip['file'], r'^(workflow|notes|range)-(zh|en)\.mp4$')
            for item in (clip,clip['poster']):
                data=(media/item['file']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(),item['sha256'])
                self.assertEqual(len(data),item['bytes'])
            self.assertLessEqual(abs(clip['seconds']-clip['capture_seconds']),1/30+.005)
            self.assertFalse(clip['audio_track'])

    def test_closeup_regions_reject_odd_or_out_of_bounds_geometry(self):
        self.assertEqual(validate_region((284,180,600,480)), (284,180,600,480))
        self.assertIsNone(validate_region(None))
        for region in ((285,180,600,480), (0,0,601,480), (-2,0,600,480), (1000,0,600,480), (0,500,600,480)):
            with self.assertRaises(ValueError):
                validate_region(region)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Optional encoding tools unavailable')
    def test_encoding_keeps_the_final_static_hold(self):
        encoders = subprocess.check_output(['ffmpeg','-hide_banner','-encoders'], stderr=subprocess.STDOUT)
        filters = subprocess.check_output(['ffmpeg','-hide_banner','-filters'], stderr=subprocess.STDOUT)
        if b'libx264' not in encoders or b'libwebp' not in encoders or b' ass ' not in filters:
            self.skipTest('Optional showcase encoding features unavailable')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def chunk(kind, content):
                return struct.pack('>I',len(content)) + kind + content + struct.pack('>I',zlib.crc32(kind+content))
            png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('>IIBBBBB',64,64,8,2,0,0,0))
            png += chunk(b'IDAT',zlib.compress((b'\0'+bytes([230,240,235])*64)*64)) + chunk(b'IEND',b'')
            frame = root/'frame.png'
            frame.write_bytes(png)
            capture = root/'capture.json'
            capture.write_text(json.dumps(dict(started=100,ended=102,
                frames=[dict(file=str(frame), timestamp=100+n*.02) for n in range(12)],
                pointer=[dict(x=10,y=10,time=100)])),encoding='utf-8')
            encode(capture,root/'output','timing-check')
            duration = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(root/'output/timing-check.mp4')]))
            self.assertAlmostEqual(duration,2,delta=1/30)
            self.assertEqual(frame.read_bytes(),png)
    def test_static_build_has_recordings_fonts_and_no_workspace_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination=build(Path(temporary)/'site')
            self.assertEqual(len(list((destination/'tour/media').glob('*.mp4'))),6)
            self.assertEqual((destination/'geist-latin.woff2').read_bytes()[:4],b'wOF2')
            self.assertEqual((destination/'MiSans-Regular.woff2').read_bytes(), (Path(__file__).resolve().parents[1]/'src/audio_review_desk/static/MiSans-Regular.woff2').read_bytes())
            self.assertTrue((destination/'tour/studio-signal.js').is_file())
            self.assertEqual(list(destination.rglob('*.sqlite')),[])
            self.assertEqual(list(destination.rglob('*.wav')),[])
            with self.assertRaisesRegex(ValueError,'new or empty'):build(destination)

    def test_recording_fixture_never_overwrites_a_populated_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination=Path(temporary)/'recording'
            create(destination)
            original=(destination/'signals/take_01.wav').read_bytes()
            with self.assertRaisesRegex(ValueError,'new or empty'):create(destination)
            self.assertEqual((destination/'signals/take_01.wav').read_bytes(),original)
