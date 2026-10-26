import unittest
from audio_review_desk.errors import error_code

class ErrorCodeTests(unittest.TestCase):
    def test_decode_failures_do_not_report_a_missing_decoder(self):
        self.assertEqual(error_code('Install FFmpeg and ffprobe, add them to PATH'),'decoder_missing')
        self.assertEqual(error_code('FFmpeg could not completely decode this file'),'decode_failed')
        self.assertEqual(error_code(FileNotFoundError('private path')),'source_missing')
        self.assertEqual(error_code(PermissionError('private path')),'permission_denied')
