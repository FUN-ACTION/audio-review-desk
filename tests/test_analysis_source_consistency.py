"""Real temporary sources, deterministic mutation boundaries, no racing threads."""
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from audio_review_desk.audio import AudioError, Decoder, analyze, file_sha256, fingerprint
from audio_review_desk.demo import write_wav


class AnalysisSourceConsistencyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "source.wav"
        self.replacement = self.path.with_name("replacement.wav")
        write_wav(self.path, seconds=.1, amplitude=0)
        write_wav(self.replacement, seconds=.1, amplitude=.8)
        self.original = self.path.read_bytes()
        self.changed = self.replacement.read_bytes()
        self.assertEqual(len(self.original), len(self.changed))
        self.assertNotEqual(self.original, self.changed)
        self.stat = self.path.stat()

    def replace_preserving_metadata(self):
        os.utime(self.replacement, ns=(self.stat.st_atime_ns, self.stat.st_mtime_ns))
        self.replacement.replace(self.path)
        self.assertEqual(fingerprint(self.path), (len(self.original), self.stat.st_mtime_ns))
        self.assertEqual(self.path.read_bytes(), self.changed)

    def test_same_size_timestamp_preserved_replacement_before_decode_is_rejected(self):
        for checkpoint in (None, lambda: None):
            with self.subTest(cancellable=checkpoint is not None):
                self.path.write_bytes(self.original)
                os.utime(self.path, ns=(self.stat.st_atime_ns, self.stat.st_mtime_ns))
                self.replacement.write_bytes(self.changed)
                decoded = []
                native = Decoder()

                def info(path):
                    self.replace_preserving_metadata()
                    return native.info(path)

                def blocks(path, info):
                    for raw in native.blocks(path, info):
                        decoded.append(raw)
                        yield raw

                decoder = Mock(info=info, blocks=blocks)
                with self.assertRaisesRegex(AudioError, "Source changed during analysis"):
                    analyze(self.path, decoder, checkpoint=checkpoint)
                # Actual replacement audio was decoded, rather than a fabricated metric.
                self.assertTrue(any(any(raw) for raw in decoded))
                self.assertEqual(self.path.read_bytes(), self.changed)

    def test_timestamp_preserved_replacement_after_decode_is_rejected(self):
        native = Decoder()

        def blocks(path, info):
            yield from native.blocks(path, info)
            self.replace_preserving_metadata()

        with self.assertRaisesRegex(AudioError, "Source changed during analysis"):
            analyze(self.path, Mock(info=native.info, blocks=blocks))

    def test_unchanged_source_is_hashed_twice_with_identical_results(self):
        expected = analyze(self.path)
        for checkpoint in (None, Mock()):
            with self.subTest(cancellable=checkpoint is not None):
                with patch("audio_review_desk.audio.file_sha256", wraps=file_sha256) as hashing:
                    actual = analyze(self.path, checkpoint=checkpoint)
                self.assertEqual(actual, expected)
                self.assertEqual(actual["sha256"], hashlib.sha256(self.original).hexdigest())
                self.assertEqual(hashing.call_count, 2)
                for call in hashing.call_args_list:
                    self.assertEqual(call.kwargs, {} if checkpoint is None else {"checkpoint": checkpoint})
                self.assertEqual(self.path.read_bytes(), self.original)

    def test_cancellation_during_final_hash_closes_stream_and_returns_no_result(self):
        # More than one hash block. Only synthetic temporary audio is involved.
        write_wav(self.path, seconds=34)
        original = self.path.read_bytes()
        self.assertGreater(len(original), 1024 * 1024)
        native_open = Path.open
        streams, final_reads = [], []
        calls = 0
        cancelled = RuntimeError("cancel final hash")

        class ReadTracker:
            def __init__(self, stream):
                self.stream = stream

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stream.close()

            def read(self, size):
                result = self.stream.read(size)
                final_reads.append(size)
                return result

        def opening(path, *args, **kwargs):
            nonlocal calls
            stream = native_open(path, *args, **kwargs)
            calls += 1
            if calls == 6:  # Initial hash, Ogg/MP3/MP4 extent/sample sniffs, final hash; wave uses builtins.open.
                self.assertIs(sys._getframe(1).f_code, file_sha256.__code__)
                streams.append(stream)
                return ReadTracker(stream)
            return stream

        def checkpoint():
            if final_reads:
                raise cancelled

        with patch.object(Path, "open", opening):
            with self.assertRaises(RuntimeError) as raised:
                analyze(self.path, checkpoint=checkpoint)
        self.assertIs(raised.exception, cancelled)
        self.assertEqual(final_reads, [1024 * 1024])
        self.assertEqual(len(streams), 1)
        self.assertTrue(streams[0].closed)
        self.assertEqual(self.path.read_bytes(), original)

    def test_final_hash_read_error_propagates_without_a_result(self):
        failure = PermissionError("source became unreadable")
        with patch("audio_review_desk.audio.file_sha256",
                   side_effect=[hashlib.sha256(self.original).hexdigest(), failure]):
            with self.assertRaises(PermissionError) as raised:
                analyze(self.path)
        self.assertIs(raised.exception, failure)
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_metadata_change_during_final_hash_is_rejected(self):
        calls = 0

        def hashing(path):
            nonlocal calls
            calls += 1
            result = file_sha256(path)
            if calls == 2:
                os.utime(path, ns=(self.stat.st_atime_ns, self.stat.st_mtime_ns + 1_000_000_000))
            return result

        with patch("audio_review_desk.audio.file_sha256", side_effect=hashing):
            with self.assertRaisesRegex(AudioError, "Source changed during analysis"):
                analyze(self.path)
        self.assertEqual(self.path.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()
