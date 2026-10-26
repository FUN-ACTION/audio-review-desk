import tempfile
import unittest
from pathlib import Path

from scripts.build_release import check_release_notes


class ReleaseNotesTests(unittest.TestCase):
    def test_all_published_versions_have_changes_and_upgrade_steps(self):
        repo = Path(__file__).resolve().parents[1]
        for version in ('0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0'):
            self.assertTrue(check_release_notes(repo, version).is_file())

    def test_missing_or_incomplete_release_cannot_be_built(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            with self.assertRaisesRegex(ValueError, 'Missing release'):
                check_release_notes(repo, '1.0.0')
            folder = repo / 'docs' / 'releases'
            folder.mkdir(parents=True)
            (folder/'1.0.0.md').write_text('# Audio Review Desk 1.0.0\nChanges only', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Incomplete release'):
                check_release_notes(repo, '1.0.0')
