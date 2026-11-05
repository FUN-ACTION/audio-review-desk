"""Deterministic cooperative cancellation and read-only audio regressions."""
import hashlib
import io
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from audio_review_desk.audio import Decoder, analyze, file_sha256
from audio_review_desk.demo import write_wav


class Cancelled(RuntimeError):
    pass


class AudioCancellationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "source.wav"
        write_wav(self.path, seconds=.1)
        self.original = self.path.read_bytes()
        self.cancelled = Cancelled("stop now")

    def tearDown(self):
        # Every successful and interrupted path must leave the source untouched.
        self.assertEqual(self.path.read_bytes(), self.original)

    def cancel(self):
        raise self.cancelled

    def test_pre_cancelled_analysis_does_no_io(self):
        decoder = Mock()
        with patch("audio_review_desk.audio.fingerprint") as stat, \
                patch.object(Path, "open") as opening:
            with self.assertRaises(Cancelled) as raised:
                analyze(self.path, decoder, checkpoint=self.cancel)
        self.assertIs(raised.exception, self.cancelled)
        stat.assert_not_called()
        opening.assert_not_called()
        decoder.info.assert_not_called()
        decoder.blocks.assert_not_called()

    def test_pre_cancelled_hash_does_not_open_source(self):
        with patch.object(Path, "open") as opening:
            with self.assertRaises(Cancelled) as raised:
                file_sha256(self.path, checkpoint=self.cancel)
        self.assertIs(raised.exception, self.cancelled)
        opening.assert_not_called()

    def test_hash_stops_after_one_bounded_read_and_closes(self):
        class TrackedStream(io.BytesIO):
            def read(self, size=-1):
                reads.append(size)
                return super().read(size)

        reads = []
        stream = TrackedStream(b"x" * (3 * 1024 * 1024))

        def checkpoint():
            if reads:
                self.cancel()

        with patch.object(Path, "open", return_value=stream) as opening:
            with self.assertRaises(Cancelled) as raised:
                file_sha256(self.path, checkpoint=checkpoint)
        self.assertIs(raised.exception, self.cancelled)
        opening.assert_called_once_with("rb")
        self.assertEqual(reads, [1024 * 1024])
        self.assertTrue(stream.closed)

    def test_hash_equivalence_including_empty_and_multiblock_files(self):
        for size in (0, 7, 1024 * 1024, 2 * 1024 * 1024 + 17):
            with self.subTest(size=size):
                path = self.path.with_name("hash-source.bin")
                data = (b"0123456789abcdef" * ((size + 15) // 16))[:size]
                path.write_bytes(data)
                checks = Mock()
                expected = hashlib.sha256(data).hexdigest()
                self.assertEqual(file_sha256(path), expected)
                self.assertEqual(file_sha256(path, checkpoint=checks), expected)
                self.assertGreaterEqual(checks.call_count, 4)
                self.assertEqual(path.read_bytes(), data)

    def test_checkpoint_before_probe(self):
        decoder = Mock()
        hashed = False

        def hash_file(path, *, checkpoint):
            nonlocal hashed
            hashed = True
            return "hash"

        def checkpoint():
            if hashed:
                self.cancel()

        with patch("audio_review_desk.audio.file_sha256", side_effect=hash_file):
            with self.assertRaises(Cancelled) as raised:
                analyze(self.path, decoder, checkpoint=checkpoint)
        self.assertIs(raised.exception, self.cancelled)
        decoder.info.assert_not_called()
        decoder.blocks.assert_not_called()

    def test_checkpoint_after_probe_prevents_decoding(self):
        decoder = Mock()
        info = Decoder().info(self.path)
        decoder.info.return_value = info

        def checkpoint():
            if decoder.info.called:
                self.cancel()

        with self.assertRaises(Cancelled) as raised:
            analyze(self.path, decoder, checkpoint=checkpoint)
        self.assertIs(raised.exception, self.cancelled)
        decoder.info.assert_called_once_with(self.path)
        decoder.blocks.assert_not_called()

    def test_pcm_interruption_closes_retained_generator_before_next_read(self):
        for when in ("before_processing", "after_processing"):
            with self.subTest(when=when):
                yielded, closed, processed = [], [], []

                def blocks():
                    try:
                        for index in range(10):
                            yielded.append(index)
                            yield b"\0" * 16
                    finally:
                        closed.append(True)

                # Retain an external reference: cleanup cannot rely on refcounts.
                generator = blocks()
                decoder = Mock()
                decoder.info.return_value = {"sample_rate": 8000, "channels": 1,
                                             "expected_frames": None, "backend": "test"}
                decoder.blocks.return_value = generator

                def checkpoint():
                    if yielded and (when == "before_processing" or processed):
                        self.cancel()

                from audio_review_desk.audio import integers

                def process(raw):
                    processed.append(True)
                    return integers(raw)

                with patch("audio_review_desk.audio.integers", side_effect=process):
                    with self.assertRaises(Cancelled) as raised:
                        analyze(self.path, decoder, checkpoint=checkpoint)
                self.assertIs(raised.exception, self.cancelled)
                self.assertEqual(yielded, [0])
                self.assertEqual(closed, [True])
                self.assertEqual(len(processed), int(when == "after_processing"))
                self.assertIsNone(generator.gi_frame)

    def test_cleanup_error_does_not_replace_checkpoint_exception(self):
        yielded = []

        class Blocks:
            def __iter__(self):
                return self

            def __next__(self):
                yielded.append(True)
                return b"\0" * 4

            def close(self):
                raise OSError("cleanup failed")

        decoder = Mock()
        decoder.info.return_value = Decoder().info(self.path)
        decoder.blocks.return_value = Blocks()

        def checkpoint():
            if yielded:
                self.cancel()

        with self.assertRaises(Cancelled) as raised:
            analyze(self.path, decoder, checkpoint=checkpoint)
        self.assertIs(raised.exception, self.cancelled)

    def test_iterator_without_close_is_supported(self):
        decoder = Mock()
        decoder.info.return_value = {"sample_rate": 8000, "channels": 1,
                                     "expected_frames": 1, "backend": "test"}
        decoder.blocks.side_effect = lambda *args: iter([b"\0" * 4])
        self.assertEqual(analyze(self.path, decoder),
                         analyze(self.path, decoder, checkpoint=lambda: None))

    def test_normal_analysis_is_exactly_equivalent(self):
        for kwargs in ({"amplitude": 0}, {"amplitude": 1, "square": True, "channels": 3},
                       {"amplitude": .5, "rate": 8000, "seconds": 2.1}):
            with self.subTest(kwargs=kwargs):
                source = self.path.with_name("equivalence.wav")
                write_wav(source, **kwargs)
                before = source.read_bytes()
                checkpoints = Mock()
                expected = analyze(source)
                self.assertEqual(analyze(source, checkpoint=checkpoints), expected)
                self.assertGreater(checkpoints.call_count, 10)
                self.assertEqual(source.read_bytes(), before)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                         "optional FFmpeg not installed")
    def test_flac_checkpoint_results_are_exactly_equivalent(self):
        target = self.path.with_suffix(".flac")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(self.path), str(target)],
                       check=True)
        before = target.read_bytes()
        expected = analyze(target)
        checkpoints = Mock()
        self.assertEqual(analyze(target, checkpoint=checkpoints), expected)
        self.assertGreater(checkpoints.call_count, 10)
        self.assertEqual(target.read_bytes(), before)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                         "optional FFmpeg not installed")
    def test_ffmpeg_cancellation_closes_native_generator_and_process(self):
        target = self.path.with_suffix(".flac")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(self.path), str(target)],
                       check=True)
        before = target.read_bytes()
        generators, processes = [], []
        native_blocks, native_popen = Decoder.blocks, subprocess.Popen

        def blocks(decoder, path, info):
            generator = native_blocks(decoder, path, info)
            generators.append(generator)
            return generator

        def cleanup(process):
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdout:
                process.stdout.close()

        def popen(command, *args, **kwargs):
            process = native_popen(command, *args, **kwargs)
            if "pcm_s32le" in command:
                processes.append(process)
                self.addCleanup(cleanup, process)
            return process

        def checkpoint():
            # The retained native generator is suspended only after yielding PCM.
            # No wall-clock assertion or artificial process timeout is needed.
            if generators and generators[0].gi_suspended:
                self.cancel()

        with patch.object(Decoder, "blocks", blocks), \
                patch("audio_review_desk.audio.subprocess.Popen", side_effect=popen):
            with self.assertRaises(Cancelled) as raised:
                analyze(target, checkpoint=checkpoint)
        self.assertIs(raised.exception, self.cancelled)
        self.assertEqual(len(generators), 1)
        self.assertIsNone(generators[0].gi_frame)
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())
        self.assertTrue(processes[0].stdout.closed)
        self.assertEqual(target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
