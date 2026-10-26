import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from audio_review_desk import picker


class PickerTests(unittest.TestCase):
    def test_unicode_path_and_cancel_are_returned_without_importing(self):
        for value in ('D:/音频/片段.csv', None):
            result = SimpleNamespace(returncode=0, stdout=json.dumps(value))
            with patch.object(picker.subprocess, 'run', return_value=result) as run:
                self.assertEqual(picker.choose('manifest'), value)
                self.assertTrue(run.call_args.args[0][1].endswith('picker.py'))
                self.assertFalse(run.call_args.kwargs.get('shell', False))

    def test_unavailable_chooser_releases_lock_and_has_manual_fallback(self):
        failures = [OSError('missing'), subprocess.TimeoutExpired('picker', 300)]
        for error in failures:
            with patch.object(picker.subprocess, 'run', side_effect=error):
                with self.assertRaisesRegex(ValueError, 'Enter a path'):
                    picker.choose('directory')
            self.assertFalse(picker._lock.locked())
        for stdout, code in [('bad JSON', 0), ('{}', 0), ('""', 0), ('null', 1)]:
            with patch.object(picker.subprocess, 'run', return_value=SimpleNamespace(stdout=stdout, returncode=code)):
                with self.assertRaises(ValueError):
                    picker.choose('manifest')
            self.assertFalse(picker._lock.locked())

    def test_invalid_types_and_concurrent_requests_do_not_open_windows(self):
        with patch.object(picker.subprocess, 'run') as run:
            for kind in (None, [], {}, 'audio', 1):
                with self.assertRaises(ValueError):
                    picker.choose(kind)
            picker._lock.acquire()
            try:
                with self.assertRaisesRegex(ValueError, 'already open'):
                    picker.choose('directory')
            finally:
                picker._lock.release()
            run.assert_not_called()

    def test_multiple_files_and_localized_title_are_passed_to_helper(self):
        paths=['D:/音频/a.wav','D:/音频/b.wav']
        result=SimpleNamespace(returncode=0,stdout=json.dumps(paths))
        with patch.object(picker.subprocess,'run',return_value=result) as run:
            self.assertEqual(picker.choose('files','zh'),paths)
            self.assertEqual(run.call_args.args[0][-2:],['files','zh'])
