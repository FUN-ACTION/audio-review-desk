"""Restore reports the transaction outcome independently of validation-copy cleanup."""
import contextlib
import copy
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from audio_review_desk.cli import main
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Workspace, Conflict


class RestoreCleanupOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.audio = self.root / 'audio' / 'private-source.wav'
        write_wav(self.audio, seconds=.01)
        self.original_audio = self.audio.read_bytes()
        self.workspace = Workspace(self.root / 'workspace')
        self.workspace.import_files([str(self.audio)])
        self.key = self.workspace.state()['items'][0]['key']
        self.workspace.save_review(self.key, {'expected_version': 0, 'status': 'fix',
                                             'note': 'private review content'})
        self.document = self.workspace.export()
        self.input = self.root / 'restore.json'
        self.temp_root = self.root / 'private-temp-parent'
        self.temp_root.mkdir()
        self.other = self.temp_root / 'ard-review-validate-other-operation'
        self.other.mkdir()
        (self.other / 'keep').write_bytes(b'not owned')
        self.created = []
        self.cleanup_calls = []
        self.real_mkdtemp = tempfile.mkdtemp
        self.real_rmtree = shutil.rmtree

    def make_temp(self, **kwargs):
        name = self.real_mkdtemp(dir=self.temp_root, **kwargs)
        self.created.append(Path(name))
        return name

    def fail_cleanup(self, path):
        self.cleanup_calls.append(Path(path))
        raise PermissionError(f'private review content {self.audio} {self.temp_root}')

    @contextlib.contextmanager
    def controlled_cleanup(self, fail=True):
        with patch('audio_review_desk.workspace.tempfile.mkdtemp', side_effect=self.make_temp):
            if fail:
                with patch('audio_review_desk.workspace.shutil.rmtree', side_effect=self.fail_cleanup):
                    yield
            else:
                yield

    def run_restore(self, document=None):
        self.input.write_text(json.dumps(self.document if document is None else document), encoding='utf-8')
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(['restore', '--workspace', str(self.workspace.root), str(self.input)])
        return code, out.getvalue(), err.getvalue()

    def assert_other_untouched(self):
        self.assertEqual((self.other / 'keep').read_bytes(), b'not owned')
        self.assertEqual(self.audio.read_bytes(), self.original_audio)
        self.assertNotIn(self.other, self.cleanup_calls)
        self.assertEqual(self.cleanup_calls, self.created)

    def test_committed_cleanup_failure_is_success_and_does_not_trigger_retry(self):
        with self.controlled_cleanup():
            result = self.run_restore()
            # Production exit status is the caller's retry signal.
            if result[0] != 0:
                self.run_restore()
        self.assertEqual(result[0], 0)
        self.assertIn('Restored 1 matching version-bound reviews', result[1])
        self.assertIn('Restore committed; do not retry it.', result[2])
        self.assertEqual(len(self.workspace.history(self.key)), 2)
        self.assertEqual(len(self.created), 1)
        self.assertTrue((self.created[0] / 'reviews.sqlite').exists())
        self.assertIn(self.created[0].name, result[2])
        for secret in (str(self.temp_root), str(self.audio), 'private review content'):
            self.assertNotIn(secret, result[2])
        self.assert_other_untouched()

    def test_validation_failure_retains_original_error_and_corrected_retry_commits_once(self):
        invalid = copy.deepcopy(self.document)
        invalid['items'][0]['review']['status'] = 'not-a-status'
        before = self.workspace.db.read_bytes()
        with self.controlled_cleanup():
            failed = self.run_restore(invalid)
        self.assertEqual(failed[0], 2)
        self.assertNotIn('Restored', failed[1])
        self.assertIn('Unknown review status', failed[2])
        self.assertNotIn('PermissionError', failed[2])
        self.assertIn('Restore was not confirmed', failed[2])
        self.assertEqual(self.workspace.db.read_bytes(), before)
        with self.controlled_cleanup():
            self.assertEqual(self.run_restore()[0], 0)
        self.assertEqual(len(self.workspace.history(self.key)), 2)
        self.assert_other_untouched()

    def test_precommit_failure_preserves_exception_identity_and_history(self):
        original = Workspace.verify_current
        failure = Conflict('precommit conflict')
        def verify(workspace, asset):
            if workspace.root == self.workspace.root:
                raise failure
            return original(workspace, asset)
        with self.controlled_cleanup(), patch.object(Workspace, 'verify_current', verify), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(Conflict) as caught:
                self.workspace.import_reviews(self.document)
        self.assertIs(caught.exception, failure)
        self.assertEqual(len(self.workspace.history(self.key)), 1)
        self.assert_other_untouched()

    def test_backup_failure_is_not_masked_by_cleanup(self):
        original = Workspace.connect
        failure = OSError('backup connection failed')
        @contextlib.contextmanager
        def connect(workspace):
            if workspace.root == self.workspace.root:
                raise failure
            with original(workspace) as connection:
                yield connection
        # Direct _restore starts at the disposable validation/backup stage.
        with self.controlled_cleanup(), patch.object(Workspace, 'connect', connect), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(OSError) as caught:
                self.workspace._restore(self.document['items'])
        self.assertIs(caught.exception, failure)
        self.assertEqual(len(self.workspace.history(self.key)), 1)
        self.assert_other_untouched()

    def test_ambiguous_commit_exit_is_not_reported_as_success(self):
        original = Workspace.connect
        failure = OSError('uncertain transaction exit')
        @contextlib.contextmanager
        def connect(workspace):
            with original(workspace) as connection:
                yield connection
                committing = connection.in_transaction
            if workspace.root == self.workspace.root and committing:
                raise failure
        with self.controlled_cleanup(), patch.object(Workspace, 'connect', connect):
            result = self.run_restore()
        self.assertEqual(result[0], 2)
        self.assertEqual(result[1], '')
        self.assertIn('uncertain transaction exit', result[2])
        self.assertIn('Restore was not confirmed', result[2])
        self.assertNotIn('Restore committed', result[2])
        # Deliberately committed before the injected error: never roll back or retry.
        self.assertEqual(len(self.workspace.history(self.key)), 2)
        self.assert_other_untouched()

    def test_ordinary_success_removes_only_owned_directory(self):
        with self.controlled_cleanup(fail=False):
            result = self.run_restore()
        self.assertEqual(result, (0, 'Restored 1 matching version-bound reviews\n', ''))
        self.assertFalse(self.created[0].exists())
        self.assertEqual(len(self.workspace.history(self.key)), 2)
        self.assertTrue((self.other / 'keep').exists())

    def test_zero_saved_reviews_reports_zero_despite_cleanup_failure(self):
        document = copy.deepcopy(self.document)
        document['items'][0]['review']['version'] = 0
        with self.controlled_cleanup():
            result = self.run_restore(document)
        self.assertEqual(result[0], 0)
        self.assertIn('Restored 0', result[1])
        self.assertEqual(len(self.workspace.history(self.key)), 1)
        self.assert_other_untouched()

    def test_validation_interrupt_survives_cleanup_failure(self):
        for interruption in (KeyboardInterrupt(), SystemExit(17)):
            with self.subTest(interruption=type(interruption).__name__), self.controlled_cleanup(), \
                 patch.object(Workspace, 'save_review', side_effect=interruption), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(type(interruption)) as caught:
                    self.workspace.import_reviews(self.document)
                self.assertIs(caught.exception, interruption)
        self.assertEqual(len(self.workspace.history(self.key)), 1)
        self.assert_other_untouched()

    def test_cleanup_interrupt_is_not_swallowed_or_reported_as_success(self):
        with self.controlled_cleanup(fail=False), \
             patch('audio_review_desk.workspace.shutil.rmtree', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_restore()
        self.assertEqual(len(self.workspace.history(self.key)), 2)

    def test_failed_warning_output_cannot_change_success_or_original_failure(self):
        class BrokenStderr:
            def write(self, value):
                raise OSError('diagnostic stream failed')
        with self.controlled_cleanup(), contextlib.redirect_stderr(BrokenStderr()):
            self.assertEqual(self.workspace.import_reviews(self.document), 1)
            failure = ValueError('original validation failure')
            with patch.object(Workspace, 'save_review', side_effect=failure):
                with self.assertRaises(ValueError) as caught:
                    self.workspace.import_reviews(self.document)
                self.assertIs(caught.exception, failure)
        self.assertEqual(len(self.workspace.history(self.key)), 2)
        self.assert_other_untouched()

    def test_missing_copy_cleanup_error_is_only_a_warning(self):
        def remove_then_missing(path):
            self.real_rmtree(path)
            raise FileNotFoundError()
        with self.controlled_cleanup(fail=False), patch('audio_review_desk.workspace.shutil.rmtree', side_effect=remove_then_missing):
            result = self.run_restore()
        self.assertEqual(result[0], 0)
        self.assertIn('Restore committed', result[2])
        self.assertFalse(self.created[0].exists())

    def test_temp_creation_failure_does_not_attempt_cleanup(self):
        with patch('audio_review_desk.workspace.tempfile.mkdtemp', side_effect=PermissionError('no temp access')), \
             patch('audio_review_desk.workspace.shutil.rmtree') as cleanup:
            result = self.run_restore()
        self.assertEqual(result[0], 2)
        self.assertIn('no temp access', result[2])
        cleanup.assert_not_called()
        self.assertEqual(len(self.workspace.history(self.key)), 1)


if __name__ == '__main__':
    unittest.main()
