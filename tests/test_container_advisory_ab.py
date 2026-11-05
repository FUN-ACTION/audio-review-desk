"""Real, optional-codec A/B advisories preserve playable version-bound reviews."""
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.audio import analyze
from audio_review_desk.demo import write_wav
from audio_review_desk.mp3 import COUNT_DIFFERS, frame_count_advisory
from audio_review_desk.mp4 import EXTENT_EXCEEDS_FILE, container_extent_advisory
from audio_review_desk.ogg import ENDING_UNCONFIRMED, ending_advisory
from audio_review_desk.workspace import Workspace


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),
                     'Optional FFmpeg/ffprobe tools are not installed')
class ContainerAdvisoryABTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = shutil.which('ffmpeg')
        cls.ffprobe = shutil.which('ffprobe')
        result = subprocess.run([cls.ffmpeg, '-hide_banner', '-encoders'],
                                capture_output=True, text=True, check=True, timeout=15)
        cls.encoders = {parts[1] for line in result.stdout.splitlines()
                        if len(parts := line.split()) >= 2
                        and len(parts[0]) == 6 and parts[0].startswith('A')}

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ard-container-ab-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.wav = self.root / 'seed/tone.wav'
        write_wav(self.wav, seconds=2, rate=48000)

    def fixture(self, codec, suffix):
        if codec not in self.encoders:
            self.skipTest(f'Optional FFmpeg encoder {codec} is not available')
        full = self.root / ('seed/full' + suffix)
        options = ['-b:a', '128k'] if codec == 'libmp3lame' else (['-movflags', '+faststart'] if suffix == '.m4a' else [])
        subprocess.run([self.ffmpeg, '-nostdin', '-v', 'error', '-i', str(self.wav),
                        '-c:a', codec, *options, str(full)], check=True,
                       capture_output=True, timeout=15)
        original = full.read_bytes()
        if suffix in ('.mp3', '.m4a'):
            result = subprocess.run([self.ffprobe, '-v', 'error', '-select_streams', 'a:0',
                                     '-show_packets', '-show_entries', 'packet=pos,size',
                                     '-of', 'json', str(full)], check=True,
                                    capture_output=True, timeout=15)
            packets = json.loads(result.stdout)['packets']
            self.assertGreater(len(packets), 1)
            last = packets[-1]
            end = int(last['pos'])
            self.assertEqual(end + int(last['size']), len(original))
            truncated = original[:end]  # Remove one complete final audio packet.
        else:
            offset, pages = 0, []
            while offset < len(original):
                self.assertEqual(original[offset:offset + 4], b'OggS')
                self.assertGreaterEqual(len(original) - offset, 27)
                count = original[offset + 26]
                lacing = original[offset + 27:offset + 27 + count]
                self.assertEqual(len(lacing), count)
                end = offset + 27 + count + sum(lacing)
                self.assertLessEqual(end, len(original))
                pages.append((offset, original[offset + 5]))
                offset = end
            self.assertGreater(len(pages), 1)
            self.assertTrue(pages[-1][1] & 4)
            truncated = original[:pages[-1][0]]  # Remove the complete EOS page.
        cut = self.root / ('seed/cut' + suffix)
        cut.write_bytes(truncated)
        duration = analyze(full)['duration']
        shortened = analyze(cut)['duration']
        self.assertGreater(duration - shortened, 0)
        self.assertLessEqual(duration - shortened, .05,
                             'Fixture must exercise advisories, not A/B alignment failure')
        return original, truncated, duration, shortened

    def check_pair(self, codec, suffix, side, flag, advisory, advisory_name):
        original, truncated, duration, shortened = self.fixture(codec, suffix)
        audio = self.root / 'audio'
        audio.mkdir()
        a, b = audio / ('a' + suffix), audio / ('b' + suffix)
        a.write_bytes(truncated if side == 'a' else original)
        b.write_bytes(truncated if side == 'b' else original)
        self.assertEqual(advisory(a if side == 'a' else b), flag)
        self.assertIsNone(advisory(b if side == 'a' else a))
        sources = {path: hashlib.sha256(path.read_bytes()).hexdigest()
                   for path in self.root.glob('**/*') if path.is_file()}
        workspace = Workspace(self.root / 'workspace')
        rows = [dict(id='pair', path=str(a), reference_path=str(b))]
        # Simulate pre-advisory analysis only. Hashing, decoding, alignment,
        # identity and all subsequent imports/previews use production behavior.
        with patch('audio_review_desk.audio.' + advisory_name, return_value=None):
            old = workspace.ingest(rows, self.root, kind='manifest')['items'][0]
        workspace.save_review(old['key'], dict(status='pass', score=8,
                              note='Previous human judgment', expected_version=0))
        history = workspace.history(old['key'])
        state = workspace.ingest(rows, self.root, kind='manifest')
        item = state['items'][0]
        self.assertEqual(item['key'], old['key'])
        self.assertEqual(item['review'], history[-1])
        self.assertEqual(workspace.history(item['key']), history)
        self.assertTrue(item['eligible'])
        self.assertTrue(item['quality']['decoded'])
        self.assertTrue(item['reference_quality']['decoded'])
        self.assertEqual(flag in item['quality']['flags'], side == 'a')
        self.assertEqual(flag in item['reference_quality']['flags'], side == 'b')
        self.assertEqual(state['stats']['warnings'], 1)
        self.assertAlmostEqual(state['stats']['human_approved_seconds'],
                               shortened if side == 'a' else duration)
        for variant in ('a', 'b'):
            preview = workspace.preview(item['key'], variant)
            self.assertAlmostEqual(analyze(preview)['duration'],
                                   shortened if variant == side else duration)
        exported = json.loads(json.dumps(workspace.export()))['items'][0]
        self.assertEqual(exported['quality']['flags'], item['quality']['flags'])
        self.assertEqual(exported['reference_quality']['flags'], item['reference_quality']['flags'])
        self.assertEqual(exported['review'], history[-1])
        for path, digest in sources.items():
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def test_real_m4a_truncated_a(self):
        self.check_pair('aac', '.m4a', 'a', EXTENT_EXCEEDS_FILE,
                        container_extent_advisory, 'container_extent_advisory')

    def test_real_m4a_truncated_b(self):
        self.check_pair('aac', '.m4a', 'b', EXTENT_EXCEEDS_FILE,
                        container_extent_advisory, 'container_extent_advisory')

    def test_real_mp3_truncated_a(self):
        self.check_pair('libmp3lame', '.mp3', 'a', COUNT_DIFFERS,
                        frame_count_advisory, 'frame_count_advisory')

    def test_real_mp3_truncated_b(self):
        self.check_pair('libmp3lame', '.mp3', 'b', COUNT_DIFFERS,
                        frame_count_advisory, 'frame_count_advisory')

    def test_real_opus_truncated_a(self):
        self.check_pair('libopus', '.opus', 'a', ENDING_UNCONFIRMED,
                        ending_advisory, 'ending_advisory')

    def test_real_opus_truncated_b(self):
        self.check_pair('libopus', '.opus', 'b', ENDING_UNCONFIRMED,
                        ending_advisory, 'ending_advisory')


if __name__ == '__main__':
    unittest.main()
