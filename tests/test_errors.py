import unittest
from audio_review_desk.errors import error_code

class ErrorCodeTests(unittest.TestCase):
    def test_decode_failures_do_not_report_a_missing_decoder(self):
        self.assertEqual(error_code('Install FFmpeg and ffprobe, add them to PATH'),'decoder_missing')
        self.assertEqual(error_code('FFmpeg could not completely decode this file'),'decode_failed')
        self.assertEqual(error_code(FileNotFoundError('private path')),'source_missing')
        self.assertEqual(error_code(PermissionError('private path')),'permission_denied')

    def test_reference_binding_conflicts_have_actionable_codes(self):
        self.assertEqual(error_code('Legacy reference version collision; back up the workspace'), 'reference_legacy_collision')
        self.assertEqual(error_code('Reference version is unverified; make the reference readable'), 'reference_unverified')
        self.assertEqual(error_code('Source unavailable; restore the scanned file'), 'source_unavailable')
        self.assertEqual(error_code('Reference changed during import; reimport stable source files'), 'source_changed')
