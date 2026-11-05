"""Restoring a snapshot must not borrow annotations from later local reviews."""
import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from audio_review_desk.cli import main
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Workspace


class LegacyRestoreMarkersTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.audio = self.root / 'audio' / 'take.wav'
        write_wav(self.audio, seconds=.5)
        self.workspace = Workspace(self.root / 'workspace')
        self.workspace.import_files([str(self.audio)])
        self.key = self.workspace.state()['items'][0]['key']
        self.save(note='Backup decision', status='fix', markers=[])
        self.backup = self.workspace.export()
        self.backup['items'][0]['review'].pop('markers')
        self.later = self.save(note='Later decision', status='pass',
                               markers=[{'time': .123456, 'text': 'Later annotation 😀'}])

    def current(self):
        return next(row['review'] for row in self.workspace.state()['items'] if row['key'] == self.key)

    def save(self, **changes):
        current = self.current()
        return self.workspace.save_review(self.key, dict(current, expected_version=current['version'], **changes))

    def test_legacy_restore_matches_fresh_workspace_instead_of_mixing_later_notes(self):
        original = copy.deepcopy(self.backup)
        fresh = Workspace(self.root / 'fresh')
        fresh.import_files([str(self.audio)])
        self.assertEqual(fresh.import_reviews(self.backup), 1)
        self.assertEqual(self.workspace.import_reviews(self.backup), 1)
        expected = fresh.state()['items'][0]['review']
        actual = self.current()
        for field in ('status', 'score', 'issues', 'note', 'trim_start', 'trim_end', 'markers'):
            self.assertEqual(actual[field], expected[field], field)
        self.assertEqual(actual['markers'], [])
        self.assertEqual(actual['version'], 3)
        self.assertEqual(actual['origin'], 'imported_review')
        self.assertEqual(self.backup, original, 'Caller-owned export must remain unchanged')

    def test_cli_legacy_restore_and_reexport_do_not_retain_later_markers(self):
        source = self.root / 'legacy.json'
        source.write_text(json.dumps(self.backup), encoding='utf-8')
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(['restore', '--workspace', str(self.workspace.root), str(source)]), 0)
        exported = self.workspace.export()['items'][0]['review']
        self.assertEqual(exported['note'], 'Backup decision')
        self.assertEqual(exported['markers'], [])
        self.assertEqual(json.loads(source.read_text()), self.backup)

    def test_undo_after_legacy_restore_recovers_exact_later_annotations(self):
        self.workspace.import_reviews(self.backup)
        self.assertEqual(self.current()['markers'], [])
        restored = self.workspace.undo_review(self.key, 3)
        for field in ('status', 'note', 'markers', 'trim_start', 'trim_end'):
            self.assertEqual(restored[field], self.later[field])
        self.assertEqual(restored['version'], 4)
        self.assertEqual(len(self.workspace.history(self.key)), 4)

    def test_explicit_empty_and_nonempty_snapshot_markers_remain_authoritative(self):
        for markers in ([], [{'time': .234567, 'text': 'Backup annotation 🦜'}]):
            document = copy.deepcopy(self.backup)
            document['items'][0]['review']['markers'] = markers
            self.workspace.import_reviews(document)
            self.assertEqual(self.current()['markers'], markers)

    def test_invalid_explicit_markers_are_not_coerced_to_empty(self):
        for markers in (None, {}, [{'time': .7, 'text': 'Outside'}]):
            document = copy.deepcopy(self.backup)
            document['items'][0]['review']['markers'] = markers
            before = self.current(), self.workspace.history(self.key)
            with self.assertRaises(ValueError):
                self.workspace.import_reviews(document)
            self.assertEqual((self.current(), self.workspace.history(self.key)), before)

    def mixed_export(self):
        second_audio = self.root / 'audio' / 'second.wav'
        write_wav(second_audio, seconds=.5, amplitude=.3)
        self.workspace.import_files([str(second_audio)], append=True)
        second = next(row for row in self.workspace.state()['items'] if row['key'] != self.key)
        self.workspace.save_review(second['key'], dict(status='fix', note='Second backup',
            markers=[{'time': .3, 'text': 'Explicit backup marker'}], expected_version=0))
        document = self.workspace.export()
        document['items'].sort(key=lambda row: row['key'] != self.key)
        document['items'][0]['review'] = copy.deepcopy(self.backup['items'][0]['review'])
        return document, second['key']

    def snapshot(self):
        return (self.workspace.state()['items'],
                {row['key']: self.workspace.history(row['key']) for row in self.workspace.state()['items']})

    def test_later_invalid_row_rolls_back_mixed_legacy_and_explicit_markers(self):
        document, second_key = self.mixed_export()
        document['items'][1]['review']['markers'] = [{'time': .8, 'text': 'Invalid second row'}]
        before = self.snapshot()
        with self.assertRaises(ValueError):
            self.workspace.import_reviews(document)
        self.assertEqual(self.snapshot(), before)
        document['items'][1]['review']['markers'] = [{'time': .3, 'text': 'Explicit backup marker'}]
        self.assertEqual(self.workspace.import_reviews(document), 2)
        reviews = {row['key']: row['review'] for row in self.workspace.state()['items']}
        self.assertEqual(reviews[self.key]['markers'], [])
        self.assertEqual(reviews[second_key]['markers'], document['items'][1]['review']['markers'])

    def test_concurrent_edit_after_validation_rolls_back_earlier_restored_row(self):
        from audio_review_desk.workspace import Conflict
        document, second_key = self.mixed_export()
        original_save = Workspace.save_review
        expected_after_edit = []

        def save_then_edit(workspace, key, payload, origin='human_ui'):
            result = original_save(workspace, key, payload, origin)
            if workspace.root != self.workspace.root and key == second_key:
                original_save(self.workspace, second_key, dict(status='pass', note='Concurrent edit',
                    markers=[{'time': .4, 'text': 'Keep concurrent marker'}], expected_version=1))
                expected_after_edit.append(self.snapshot())
            return result

        with patch.object(Workspace, 'save_review', save_then_edit):
            with self.assertRaises(Conflict):
                self.workspace.import_reviews(document)
        self.assertEqual(len(expected_after_edit), 1)
        self.assertEqual(self.snapshot(), expected_after_edit[0])
        self.assertEqual(self.current()['markers'], self.later['markers'])

    def test_ordinary_older_client_save_still_preserves_existing_markers(self):
        payload = dict(self.later, expected_version=2, note='Older client edit')
        payload.pop('markers')
        saved = self.workspace.save_review(self.key, payload)
        self.assertEqual(saved['markers'], self.later['markers'])


if __name__ == '__main__':
    unittest.main()
