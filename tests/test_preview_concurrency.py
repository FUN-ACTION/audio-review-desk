"""Preview publication races, using synthetic audio and test-owned directories."""
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.audio import AudioError, Decoder, analyze, file_sha256, write_preview
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Workspace


class PreviewPublicationTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.source = self.root / 'audio' / 'source.wav'
        self.source.parent.mkdir()
        write_wav(self.source, seconds=.1)
        self.sha = file_sha256(self.source)
        self.target = self.root / 'previews' / 'preview.wav'

    def write(self, decoder=None):
        write_preview(self.source, self.target, self.sha, 1, decoder or Decoder())

    def stages(self):
        return list(self.target.parent.glob('*.tmp'))

    def test_two_workspaces_generate_same_preview_concurrently(self):
        self.concurrent_workspaces(fail_one=False)

    def test_failing_writer_cannot_remove_other_writer_stage_or_output(self):
        self.concurrent_workspaces(fail_one=True)

    def concurrent_workspaces(self, fail_one):
        first = Workspace(self.root / 'workspace')
        key = first.scan(self.source.parent)['items'][0]['key']
        second = Workspace(first.root)
        self.target = first.root / 'previews' / f'{key}-a.wav'
        barrier = threading.Barrier(2)
        failed = threading.Event()
        owner = self

        class CoordinatedDecoder(Decoder):
            def blocks(self, path, info):
                # Both requests have passed the final-path existence check and
                # created their stages. Old shared staging deterministically fails.
                barrier.wait(timeout=10)
                owner.assertEqual(len(owner.stages()), 2)
                barrier.wait(timeout=10)
                if fail_one and threading.current_thread().name.endswith('_0'):
                    raise AudioError('injected decode failure')
                if fail_one:
                    if not failed.wait(timeout=10):
                        raise AssertionError('failed writer did not finish')
                    owner.assertEqual(len(owner.stages()), 1)
                yield from super().blocks(path, info)

        first.decoder = second.decoder = CoordinatedDecoder()

        def run(workspace):
            try:
                return workspace.preview(key, 'a')
            finally:
                if fail_one and workspace is first:
                    failed.set()

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix='preview') as pool:
            a = pool.submit(run, first)
            b = pool.submit(run, second)
            if fail_one:
                with self.assertRaisesRegex(AudioError, 'injected'):
                    a.result(timeout=15)
            else:
                self.assertEqual(a.result(timeout=15), self.target)
            self.assertEqual(b.result(timeout=15), self.target)
        self.assertEqual(analyze(self.target)['frames'], 1600)
        self.assertEqual(file_sha256(self.source), self.sha)
        self.assertEqual(self.stages(), [])

    def test_identical_winner_can_be_reused_after_replace_denial(self):
        self.write()
        expected = self.target.read_bytes()
        with patch.object(Path, 'replace', side_effect=PermissionError('destination open')):
            self.write()
        self.assertEqual(self.target.read_bytes(), expected)
        self.assertEqual(self.stages(), [])

    def test_nonidentical_or_missing_winner_preserves_original_error(self):
        for contents in (None, b'', b'RIFFpartial', b'different complete bytes'):
            with self.subTest(contents=contents):
                self.target.parent.mkdir(exist_ok=True)
                self.target.unlink(missing_ok=True)
                if contents is not None:
                    self.target.write_bytes(contents)
                error = PermissionError('destination open')
                with patch.object(Path, 'replace', side_effect=error):
                    with self.assertRaises(PermissionError) as caught:
                        self.write()
                self.assertIs(caught.exception, error)
                if contents is not None:
                    self.assertEqual(self.target.read_bytes(), contents)
                self.assertEqual(self.stages(), [])

    def test_different_valid_wav_is_not_reused(self):
        self.target.parent.mkdir()
        write_wav(self.target, seconds=.1, amplitude=.05)
        before = self.target.read_bytes()
        with patch.object(Path, 'replace', side_effect=PermissionError('blocked')):
            with self.assertRaisesRegex(PermissionError, 'blocked'):
                self.write()
        self.assertEqual(self.target.read_bytes(), before)

    def test_unreadable_winner_preserves_publication_error(self):
        self.write()
        original_open = Path.open
        error = PermissionError('replace denied')

        def open_path(path, *args, **kwargs):
            if path == self.target:
                raise OSError('cannot read winner')
            return original_open(path, *args, **kwargs)

        with patch.object(Path, 'replace', side_effect=error), patch.object(Path, 'open', open_path):
            with self.assertRaises(PermissionError) as caught:
                self.write()
        self.assertIs(caught.exception, error)

    def test_ambiguous_replace_that_consumed_stage_preserves_error_and_final(self):
        replace = Path.replace
        error = OSError('ambiguous outcome')

        def ambiguous(path, target):
            replace(path, target)
            raise error

        with patch.object(Path, 'replace', ambiguous):
            with self.assertRaises(OSError) as caught:
                self.write()
        self.assertIs(caught.exception, error)
        self.assertEqual(analyze(self.target)['frames'], 1600)
        self.assertEqual(self.stages(), [])

    def test_cleanup_error_does_not_negate_success_or_mask_primary_error(self):
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.target.unlink(missing_ok=True)
                with self.assertLogs('audio_review_desk.audio', level='WARNING') as logs, \
                     patch.object(Path, 'unlink', side_effect=PermissionError('cleanup denied')):
                    if fail:
                        error = OSError('publish denied')
                        with patch.object(Path, 'replace', side_effect=error):
                            with self.assertRaises(OSError) as caught:
                                self.write()
                        self.assertIs(caught.exception, error)
                    else:
                        self.write()
                        self.assertTrue(self.target.exists())
                self.assertIn('may need manual cleanup', logs.output[0])
                self.assertIsNone(logs.records[0].exc_info, 'cleanup warning must not include chained source errors')
                for stage in self.stages():
                    stage.unlink()

    def test_decode_error_and_foreign_stage_survive_cleanup_failure(self):
        self.target.parent.mkdir()
        foreign = self.target.parent / '.other-writer.tmp'
        foreign.write_bytes(b'another writer owns this')
        error = AudioError('decoder failed')

        class FailedDecoder(Decoder):
            def blocks(self, path, info):
                raise error
                yield  # Keep the decoder's iterator contract.

        with self.assertLogs('audio_review_desk.audio', level='WARNING'), \
             patch.object(Path, 'unlink', side_effect=PermissionError('cleanup denied')):
            with self.assertRaises(AudioError) as caught:
                self.write(FailedDecoder())
        self.assertIs(caught.exception, error)
        self.assertEqual(foreign.read_bytes(), b'another writer owns this')
        self.assertFalse(self.target.exists())

    def test_broken_warning_handler_cannot_negate_success(self):
        with patch.object(Path, 'unlink', side_effect=PermissionError('cleanup denied')), \
             patch('audio_review_desk.audio.logging.Logger.warning', side_effect=RuntimeError('logger failed')):
            self.write()
        self.assertEqual(analyze(self.target)['frames'], 1600)

    def test_changed_source_during_decode_does_not_publish(self):
        source = self.source

        class ChangingDecoder(Decoder):
            def blocks(self, path, info):
                yield from super().blocks(path, info)
                source.write_bytes(source.read_bytes() + b'changed')

        with self.assertRaisesRegex(AudioError, 'Source changed'):
            self.write(ChangingDecoder())
        self.assertFalse(self.target.exists())
        self.assertEqual(self.stages(), [])

    def test_changed_source_during_failed_replace_cannot_reuse_winner(self):
        self.write()
        error = PermissionError('blocked')

        def change_and_fail(path, target):
            self.source.write_bytes(self.source.read_bytes() + b'changed')
            raise error

        with patch.object(Path, 'replace', change_and_fail):
            with self.assertRaises(PermissionError) as caught:
                self.write()
        self.assertIs(caught.exception, error)

    def test_truncated_decode_does_not_publish_or_reuse_existing_winner(self):
        self.write()
        before = self.target.read_bytes()

        class TruncatedDecoder(Decoder):
            def blocks(self, path, info):
                yield next(super().blocks(path, info))[:-4]

        with self.assertRaisesRegex(AudioError, 'frame count'):
            self.write(TruncatedDecoder())
        self.assertEqual(self.target.read_bytes(), before)
        self.assertEqual(self.stages(), [])


if __name__ == '__main__':
    unittest.main()
