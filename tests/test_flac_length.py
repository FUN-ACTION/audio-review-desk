"""Native FLAC exact-length checks, using only generated temporary audio."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.audio import AudioError, Decoder, analyze, file_sha256, flac_streaminfo, write_preview
from audio_review_desk.demo import write_wav


def streaminfo(total=32000, rate=16000, channels=1):
    packed = (rate << 44) | ((channels - 1) << 41) | (15 << 36) | total
    return b'fLaC\x80\x00\x00\x22' + b'\x04\x80\x04\x80' + bytes(6) + packed.to_bytes(8, 'big') + bytes(16)


class StreaminfoTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'input.bin'

    def test_exact_36_bit_total_and_channels(self):
        self.path.write_bytes(streaminfo((1 << 35) + 123, 192000, 8))
        self.assertEqual(flac_streaminfo(self.path), (192000, 8, (1 << 35) + 123))

    def test_unknown_total(self):
        self.path.write_bytes(streaminfo(0))
        self.assertEqual(flac_streaminfo(self.path), (16000, 1, None))

    def test_other_containers_not_inferred_from_extension(self):
        self.path = self.path.with_suffix('.flac')
        for content in (b'OggS' + streaminfo(), b'ID3' + streaminfo(), b'RIFF', b''):
            self.path.write_bytes(content)
            self.assertIsNone(flac_streaminfo(self.path))

    def test_malformed_or_truncated_streaminfo(self):
        good = streaminfo()
        cases = [good[:n] for n in range(4, 42)]
        cases += [good[:4] + b'\x81' + good[5:], good[:7] + b'\x21' + good[8:], streaminfo(rate=0)]
        for content in cases:
            with self.subTest(length=len(content), header=content[:8]):
                self.path.write_bytes(content)
                with self.assertRaises(AudioError):
                    flac_streaminfo(self.path)

    def test_probe_format_must_match_streaminfo(self):
        self.path.write_bytes(streaminfo())
        for rate, channels in ((8000, 1), (16000, 2)):
            result = subprocess.CompletedProcess([], 0, json.dumps({'streams': [{'sample_rate': rate, 'channels': channels}]}).encode())
            with patch.object(Decoder, 'tools', return_value=('ffmpeg', 'ffprobe')), patch('audio_review_desk.audio.subprocess.run', return_value=result):
                with self.assertRaises(AudioError):
                    Decoder().info(self.path)

    def test_missing_tools_do_not_fall_back_to_header(self):
        self.path.write_bytes(streaminfo())
        with patch('audio_review_desk.audio.shutil.which', return_value=None), patch('audio_review_desk.audio.subprocess.run') as run:
            with self.assertRaisesRegex(AudioError, 'FFmpeg'):
                analyze(self.path)
            run.assert_not_called()


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'optional FFmpeg not installed')
class RealFlacLengthTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.wav, self.path = self.root / 'source.wav', self.root / 'source.flac'
        write_wav(self.wav, seconds=2, rate=16000, channels=2)
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(self.wav), str(self.path)], check=True, timeout=15)
        self.original = self.path.read_bytes()
        self.target = self.root / 'preview.wav'

    def boundary_truncate(self):
        packets = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_packets', '-show_entries', 'packet=pos,size', '-of', 'json', str(self.path)], timeout=15))['packets']
        self.assertGreater(len(packets), 1)
        end = int(packets[0]['pos']) + int(packets[0]['size'])
        self.path.write_bytes(self.original[:end])
        # Demonstrate why exit status alone is insufficient: complete first frame.
        decoded = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(self.path), '-f', 's32le', 'pipe:1'], capture_output=True, check=True, timeout=15)
        self.assertGreater(len(decoded.stdout), 0)
        self.assertLess(len(decoded.stdout) // 8, 32000)
        return len(decoded.stdout) // 8

    def test_valid_flac_analysis_and_preview_match_pcm_wav(self):
        result = analyze(self.path)
        self.assertEqual(result['frames'], 32000)
        self.assertEqual(result['pcm_sha256'], analyze(self.wav)['pcm_sha256'])
        self.assertEqual(Decoder().info(self.path)['expected_frames'], 32000)
        write_preview(self.path, self.target, result['sha256'], 1, Decoder())
        self.assertEqual(analyze(self.target)['frames'], 32000)
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_complete_packet_truncation_rejected_by_analysis_and_preview(self):
        self.boundary_truncate()
        source_bytes = self.path.read_bytes()
        self.target.write_bytes(b'existing preview')
        with self.assertRaisesRegex(AudioError, 'frame count'):
            analyze(self.path)
        with self.assertRaisesRegex(AudioError, 'frame count'):
            write_preview(self.path, self.target, file_sha256(self.path), 1, Decoder())
        self.assertEqual(self.target.read_bytes(), b'existing preview')
        self.assertEqual(list(self.root.glob('.*.tmp')), [])
        self.assertEqual(self.path.read_bytes(), source_bytes)

    def test_zero_total_remains_unknown_for_valid_and_boundary_cut_stream(self):
        partial_frames = self.boundary_truncate()
        partial = self.path.read_bytes()
        for content, frames in ((self.original, 32000), (partial, partial_frames)):
            data = bytearray(content)
            packed = int.from_bytes(data[18:26], 'big') & ~((1 << 36) - 1)
            data[18:26] = packed.to_bytes(8, 'big')
            self.path.write_bytes(data)
            self.assertIsNone(Decoder().info(self.path)['expected_frames'])
            self.assertEqual(analyze(self.path)['frames'], frames)
            write_preview(self.path, self.target, file_sha256(self.path), 1, Decoder())
            self.assertEqual(analyze(self.target)['frames'], frames)

    def test_truncated_metadata_never_publishes_preview(self):
        # Encoder emits STREAMINFO followed by additional metadata. Test both
        # a partial STREAMINFO and a partial later block, before any audio.
        self.assertFalse(self.original[4] & 0x80)
        for end in (10, 41, 43, 46):
            self.path.write_bytes(self.original[:end])
            with self.assertRaises(AudioError):
                analyze(self.path)
            with self.assertRaises(AudioError):
                write_preview(self.path, self.target, file_sha256(self.path), 1, Decoder())
            self.assertFalse(self.target.exists())
            self.assertEqual(list(self.root.glob('.*.tmp')), [])

    def test_replacement_during_probe_is_not_accepted(self):
        original_info = Decoder.info
        before = self.path.stat()
        def replace(decoder, path):
            info = original_info(decoder, path)
            changed = bytearray(self.original)
            changed[26] ^= 1  # MD5 metadata: same dimensions, size, mtime, and PCM.
            path.write_bytes(changed)
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
            return info
        with patch.object(Decoder, 'info', replace):
            with self.assertRaisesRegex(AudioError, 'Source changed'):
                analyze(self.path)
        self.path.write_bytes(self.original)
        with patch.object(Decoder, 'info', replace):
            with self.assertRaisesRegex(AudioError, 'Source changed'):
                write_preview(self.path, self.target, file_sha256(self.path), 1, Decoder())
        self.assertFalse(self.target.exists())

    def test_cancel_after_probe_prevents_decode(self):
        class Cancelled(Exception):
            pass
        probed = False
        original_info = Decoder.info
        def info(decoder, path):
            nonlocal probed
            result = original_info(decoder, path)
            probed = True
            return result
        def checkpoint():
            if probed:
                raise Cancelled()
        with patch.object(Decoder, 'info', info), patch.object(Decoder, 'blocks') as blocks:
            with self.assertRaises(Cancelled):
                analyze(self.path, checkpoint=checkpoint)
            blocks.assert_not_called()
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_non_flac_duration_estimates_remain_nonbinding(self):
        for codec, suffix in (('libmp3lame', '.mp3'), ('flac', '.ogg')):
            target = self.path.with_suffix(suffix)
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(self.wav), '-c:a', codec, str(target)], check=True, timeout=15)
            self.assertIsNone(Decoder().info(target)['expected_frames'])
            self.assertTrue(analyze(target)['decoded'])
            write_preview(target, self.target, file_sha256(target), 1, Decoder())
