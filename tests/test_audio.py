import array
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

from audio_review_desk.audio import AudioError, Decoder, analyze, file_sha256, s32_bytes, write_preview
from audio_review_desk.demo import write_wav


class AudioTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_pcm_sample_widths_have_equal_comparison_bytes(self):
        expected = s32_bytes(bytes([0, 64, 128, 192, 255]), 1)
        integers = [-128, -64, 0, 64, 127]
        for width in (2, 3, 4):
            raw = b"".join((sample << (8 * (width - 1))).to_bytes(width, "little", signed=True) for sample in integers)
            self.assertEqual(expected, s32_bytes(raw, width))

    def test_hash_ignores_container_metadata_and_preserves_sources(self):
        a, b = self.root / "a.wav", self.root / "b.wav"
        write_wav(a)
        data = bytearray(a.read_bytes())
        data += b"JUNK\x04\x00\x00\x00test"
        data[4:8] = (len(data) - 8).to_bytes(4, "little")
        b.write_bytes(data)
        before = {path: file_sha256(path) for path in (a, b)}
        qa, qb = analyze(a), analyze(b)
        self.assertNotEqual(qa["sha256"], qb["sha256"])
        self.assertEqual(qa["pcm_sha256"], qb["pcm_sha256"])
        self.assertEqual(before, {path: file_sha256(path) for path in (a, b)})

    def test_rate_and_channels_are_part_of_pcm_identity(self):
        a, b = self.root / "a.wav", self.root / "b.wav"
        write_wav(a, amplitude=0, rate=8000)
        write_wav(b, amplitude=0, rate=16000)
        self.assertNotEqual(analyze(a)["pcm_sha256"], analyze(b)["pcm_sha256"])
        write_wav(b, amplitude=0, rate=8000, channels=2)
        self.assertNotEqual(analyze(a)["pcm_sha256"], analyze(b)["pcm_sha256"])

    def test_silence_full_scale_and_multichannel_flags(self):
        path = self.root / "sample.wav"
        write_wav(path, amplitude=0)
        quiet = analyze(path)
        self.assertIn("silence_or_very_quiet", quiet["flags"])
        self.assertEqual(quiet["leading_quiet_seconds"], 2)
        write_wav(path, amplitude=1, square=True, channels=3)
        loud = analyze(path)
        self.assertIn("near_full_scale", loud["flags"])
        self.assertIn("multichannel", loud["flags"])
        self.assertEqual(loud["frames"], 32000)

    def test_truncated_and_empty_wav_are_not_accepted(self):
        path = self.root / "sample.wav"
        write_wav(path)
        path.write_bytes(path.read_bytes()[:-200])
        with self.assertRaises(AudioError):
            analyze(path)
        write_wav(path, seconds=0)
        with self.assertRaises(AudioError):
            analyze(path)

    def test_native_pcm24_decodes_negative_extremes(self):
        path = self.root / "24bit.wav"
        values = [-8388608, -1, 0, 1, 8388607]
        with wave.open(str(path), "wb") as out:
            out.setparams((1, 3, 8000, 0, "NONE", "not compressed"))
            out.writeframes(b"".join(value.to_bytes(3, "little", signed=True) for value in values))
        result = analyze(path)
        self.assertEqual(result["frames"], 5)
        self.assertEqual(result["peak"], 1.0)

    def test_preview_is_separate_and_source_is_unchanged(self):
        source, preview = self.root / "source.wav", self.root / "cache" / "preview.wav"
        write_wav(source)
        quality = analyze(source)
        write_preview(source, preview, quality["sha256"], .5, Decoder())
        self.assertEqual(file_sha256(source), quality["sha256"])
        self.assertAlmostEqual(analyze(preview)["rms"], quality["rms"] * .5, places=4)
        with self.assertRaises(AudioError):
            write_preview(source, source, quality["sha256"], 1, Decoder())

    def test_missing_optional_decoder_has_clear_error(self):
        from unittest.mock import patch
        path = self.root / "file.flac"
        path.write_bytes(b"not audio")
        with patch("audio_review_desk.audio.shutil.which", return_value=None):
            with self.assertRaisesRegex(AudioError, "FFmpeg"):
                analyze(path)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "optional FFmpeg not installed")
    def test_flac_matches_wav_pcm_and_mp3_decodes(self):
        source = self.root / "source.wav"
        write_wav(source, seconds=.5)
        original = analyze(source)
        for suffix in ("flac", "mp3"):
            target = self.root / f"encoded.{suffix}"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(source), str(target)], check=True)
            result = analyze(target)
            self.assertTrue(result["decoded"])
            self.assertEqual(result["sample_rate"], original["sample_rate"])
            if suffix == "flac":
                self.assertEqual(result["pcm_sha256"], original["pcm_sha256"])


if __name__ == "__main__":
    unittest.main()
