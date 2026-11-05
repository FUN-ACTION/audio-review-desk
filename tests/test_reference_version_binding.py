"""Failed B decoding must not detach human reviews from reference bytes."""
import copy
import hashlib
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.audio import file_sha256
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Conflict, ImportCancelled, Workspace, encode


class ReferenceVersionBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.a = self.root / 'audio/a.wav'
        self.b = self.root / 'audio/b.wav'
        write_wav(self.a, seconds=.1)
        write_wav(self.b, seconds=.1, amplitude=.3)
        self.workspace = Workspace(self.root / 'workspace')
        self.rows = [dict(id='a', path=str(self.a), reference_path=str(self.b))]

    def ingest(self, **kwargs):
        return self.workspace.ingest(self.rows, self.root, kind='manifest', **kwargs)['items'][0]

    def save(self, key, version=0):
        return self.workspace.save_review(key, dict(status='fix', score=None,
            note='Original assessment', expected_version=version))

    def assert_blocked(self, key, export):
        before = self.workspace.state()
        history = self.workspace.history(key)
        operations = [lambda: self.save(key, 1), self.workspace.export,
                      self.workspace.export_csv,
                      lambda: self.workspace.batch_review([dict(key=key, expected_version=1)], 'exclude'),
                      lambda: self.workspace.import_reviews(export),
                      lambda: self.workspace.undo_review(key, 1)]
        for operation in operations:
            with self.subTest(operation=operation):
                with self.assertRaises(Conflict):
                    operation()
                self.assertEqual(self.workspace.state(), before)
                self.assertEqual(self.workspace.history(key), history)

    def test_changed_and_unchanged_failed_references(self):
        for failure in ('mismatch', 'corrupt'):
            with self.subTest(failure=failure):
                if failure == 'mismatch':
                    write_wav(self.b, seconds=.4)
                else:
                    self.b.write_bytes(b'broken reference one')
                item = self.ingest()
                key = item['key']
                self.assertNotIn('reference_quality', item)
                self.assertEqual(item['reference_sha256'], file_sha256(self.b))
                self.save(key)
                export = self.workspace.export()
                self.assertEqual(self.ingest()['key'], key)
                self.assertEqual(self.ingest()['review']['version'], 1)
                with self.assertRaises(ValueError):
                    self.workspace.preview(key, 'b')
                old_history = self.workspace.history(key)
                if failure == 'mismatch':
                    write_wav(self.b, seconds=.4, amplitude=.35)
                else:
                    self.b.write_bytes(b'broken reference two')
                self.assert_blocked(key, export)
                new = self.ingest()
                self.assertNotEqual(new['key'], key)
                self.assertEqual(new['review']['version'], 0)
                self.assertEqual(self.workspace.history(key), old_history)
                with self.assertRaises(Conflict):
                    self.workspace.import_reviews(export)

    def test_a_failure_still_binds_b(self):
        self.a.write_bytes(b'broken A')
        item = self.ingest()
        self.assertEqual(item['reference_sha256'], file_sha256(self.b))
        self.assertNotIn('reference_quality', item)
        self.save(item['key'])
        write_wav(self.b, seconds=.1, amplitude=.2)
        with self.assertRaises(Conflict):
            self.save(item['key'], 1)
        self.assertNotEqual(self.ingest()['key'], item['key'])

    def test_missing_appearing_and_unreadable_reference(self):
        self.b.unlink()
        item = self.ingest()
        self.assertIsNone(item['reference_sha256'])
        self.assertEqual(self.ingest()['key'], item['key'])
        for operation in (lambda: self.save(item['key']), self.workspace.export, self.workspace.export_csv):
            with self.assertRaises(Conflict):
                operation()
        write_wav(self.b, seconds=.1)
        # Appearing bytes cannot retroactively establish the unavailable version.
        with self.assertRaises(Conflict):
            self.save(item['key'])
        new = self.ingest()
        self.assertNotEqual(new['key'], item['key'])
        self.save(new['key'])
        export = self.workspace.export()
        real_hash = file_sha256
        def inaccessible(path, **kwargs):
            if path == self.b:
                raise PermissionError('synthetic unreadable reference')
            return real_hash(path, **kwargs)
        with patch('audio_review_desk.workspace.file_sha256', side_effect=inaccessible):
            self.assert_blocked(new['key'], export)
            unavailable = self.ingest()
            self.assertIsNone(unavailable['reference_sha256'])
            with self.assertRaises(Conflict):
                self.save(unavailable['key'])

    def legacy(self, item):
        """Emulate the old signature and persisted metadata, not today's bytes."""
        asset = self.workspace.asset(item['key'])
        asset.pop('reference_sha256', None)
        signature = {name: asset[name] for name in ('id', 'source_id', 'source_start', 'source_end', 'eligible')}
        signature.update(sha256=asset['quality'].get('sha256'),
                         reference_sha256=asset.get('reference_quality', {}).get('sha256'))
        key = hashlib.sha256(encode(signature).encode()).hexdigest()
        asset['key'] = key
        with self.workspace.connect() as connection:
            connection.execute('UPDATE assets SET active=0')
            connection.execute('INSERT OR REPLACE INTO assets VALUES(?,?,?,1)', (key, asset['id'], encode(asset)))
        return key

    def test_healthy_legacy_keys_exports_and_histories_work(self):
        item = self.ingest()
        key = self.legacy(item)
        self.assertEqual(key, item['key'])
        self.save(key)
        old_export = self.workspace.export()
        self.assertNotIn('reference_sha256', old_export['items'][0])
        self.assertEqual(self.ingest()['key'], key)
        self.assertEqual(self.workspace.import_reviews(old_export), 1)
        self.assertEqual(len(self.workspace.history(key)), 2)

    def test_legacy_failed_reference_blocks_whole_exports_without_migration(self):
        self.b.write_bytes(b'broken reference')
        key = self.legacy(self.ingest())
        # Seed a historical review as written by the old application.
        with self.workspace.connect() as connection:
            self.workspace.write_review(connection, key, dict(status='fix', score=None,
                note='Keep historical note', issues=[], trim_start=None, trim_end=None, markers=[]), 1, 'human_ui')
        old = self.workspace.state()
        old_export = copy.deepcopy(old)
        # A healthy second row must not make whole-catalog export bypass the bad row.
        self.workspace.ingest([dict(id='healthy', path=str(self.a))], self.root,
                              kind='files', append=True)
        self.assert_blocked(key, old_export)
        history = self.workspace.history(key)
        new = self.ingest()
        self.assertNotEqual(new['key'], key)
        self.assertEqual(new['review']['version'], 0)
        self.assertEqual(self.workspace.history(key), history)
        with self.workspace.connect() as connection:
            stored = json.loads(connection.execute('SELECT metadata FROM assets WHERE key=?', (key,)).fetchone()[0])
        self.assertNotIn('reference_sha256', stored)
        with self.assertRaises(Conflict):
            self.workspace.import_reviews(old_export)

    def test_legacy_broken_a_collision_cannot_overwrite_history(self):
        self.a.write_bytes(b'broken A')
        self.b.write_bytes(b'broken B')
        key = self.legacy(self.ingest())
        with self.workspace.connect() as connection:
            self.workspace.write_review(connection, key, dict(status='fix', score=None,
                note='Old A/B evidence', issues=[], trim_start=None, trim_end=None, markers=[]), 1, 'human_ui')
        before = self.workspace.state()
        history = self.workspace.history(key)
        source = self.workspace.import_source()
        self.rows[0].pop('reference_path')
        for append in (False, True):
            with self.assertRaisesRegex(Conflict, 'Legacy reference version collision'):
                self.ingest(append=append)
            self.assertEqual(self.workspace.state(), before)
            self.assertEqual(self.workspace.import_source(), source)
            self.assertEqual(self.workspace.history(key), history)
        # A deliberately chosen new ID starts pending, without moving history.
        self.rows[0]['id'] = 'new-assessment'
        new = self.ingest()
        self.assertNotEqual(new['key'], key)
        self.assertEqual(new['review']['version'], 0)
        self.assertEqual(self.workspace.history(key), history)
        # Inactive legacy rows must be protected too.
        current = self.workspace.state()
        self.rows[0]['id'] = 'a'
        with self.assertRaisesRegex(Conflict, 'Legacy reference version collision'):
            self.ingest()
        self.assertEqual(self.workspace.state(), current)
        self.assertEqual(self.workspace.history(key), history)

    def test_ordinary_a_only_keys_remain_legacy_compatible(self):
        self.rows[0].pop('reference_path')
        for broken in (False, True):
            if broken:
                self.a.write_bytes(b'broken A')
            item = self.ingest()
            self.assertEqual(self.legacy(item), item['key'])
            self.save(item['key'])
            again = self.ingest()
            self.assertEqual(again['key'], item['key'])
            self.assertEqual(again['review']['version'], 1)

    def test_batch_and_restore_are_atomic_with_later_changed_b(self):
        self.b.write_bytes(b'broken B')
        self.rows = [dict(id='first', path=str(self.a)),
                     dict(id='second', path=str(self.a), reference_path=str(self.b))]
        self.ingest()
        items = self.workspace.state()['items']
        for item in items:
            self.save(item['key'])
        export = self.workspace.export()
        before = self.workspace.state()
        histories = {item['key']: self.workspace.history(item['key']) for item in items}
        self.b.write_bytes(b'changed broken B')
        changes = [dict(key=item['key'], expected_version=1) for item in items]
        for operation in (lambda: self.workspace.batch_review(changes, 'exclude'),
                          lambda: self.workspace.import_reviews(export)):
            with self.assertRaises(Conflict):
                operation()
            self.assertEqual(self.workspace.state(), before)
            for key, history in histories.items():
                self.assertEqual(self.workspace.history(key), history)

    def test_cancellation_during_reference_hash_preserves_catalog(self):
        item = self.ingest()
        self.save(item['key'])
        before = self.workspace.state()
        event = threading.Event()
        real_hash = file_sha256
        def cancel_b(path, **kwargs):
            if path == self.b:
                event.set()
                kwargs['checkpoint']()
            return real_hash(path, **kwargs)
        with patch('audio_review_desk.workspace.file_sha256', side_effect=cancel_b):
            with self.assertRaises(ImportCancelled):
                self.ingest(cancelled=event)
        self.assertEqual(self.workspace.state(), before)
        self.assertEqual(len(self.workspace.history(item['key'])), 1)


if __name__ == '__main__':
    unittest.main()
