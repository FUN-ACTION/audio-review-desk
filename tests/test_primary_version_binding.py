"""Unknown primary bytes must never inherit or certify historical decisions."""
import hashlib
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.audio import AudioError, analyze, file_sha256
from audio_review_desk.demo import write_wav
from audio_review_desk.errors import error_code
from audio_review_desk.workspace import Conflict, ImportCancelled, Workspace, encode


class PrimaryVersionBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.a = self.root / 'audio/a.wav'
        self.b = self.root / 'audio/b.wav'
        write_wav(self.b, seconds=.1)
        self.workspace = Workspace(self.root / 'workspace')
        self.rows = [dict(id='a', path=str(self.a))]

    def ingest(self, **kwargs):
        return self.workspace.ingest(self.rows, self.root, kind='manifest', **kwargs)['items'][0]

    def save(self, key, version=0):
        return self.workspace.save_review(key, dict(status='exclude', score=None,
            note='Original assessment', expected_version=version))

    def seed_legacy_review(self, key):
        with self.workspace.connect() as connection:
            self.workspace.write_review(connection, key, dict(status='exclude', score=None,
                note='Historical evidence', issues=[], trim_start=None, trim_end=None, markers=[]), 1, 'human_ui')

    def snapshot(self):
        with self.workspace.connect() as connection:
            return {table: [tuple(row) for row in connection.execute('SELECT * FROM ' + table)]
                    for table in ('assets', 'reviews', 'history', 'settings')}

    def assert_blocked(self, key, exported):
        before = self.snapshot()
        for operation in (lambda: self.save(key, 1), self.workspace.export,
                          self.workspace.export_csv,
                          lambda: self.workspace.export_csv(status='pass'),
                          lambda: self.workspace.batch_review([dict(key=key, expected_version=1)], 'exclude'),
                          lambda: self.workspace.import_reviews(exported),
                          lambda: self.workspace.undo_review(key, 1)):
            with self.subTest(operation=operation):
                with self.assertRaisesRegex(Conflict, 'Primary version is unverified'):
                    operation()
                self.assertEqual(self.snapshot(), before)

    def test_missing_then_appearing_does_not_certify_old_record(self):
        item = self.ingest()
        with self.assertRaisesRegex(Conflict, 'Primary version is unverified'):
            self.save(item['key'])
        self.seed_legacy_review(item['key'])
        old = self.workspace.state()
        self.assert_blocked(item['key'], old)
        self.assertEqual(self.ingest()['key'], item['key'])
        write_wav(self.a, seconds=.1)
        self.assert_blocked(item['key'], old)
        history = self.workspace.history(item['key'])
        new = self.ingest()
        self.assertNotEqual(new['key'], item['key'])
        self.assertEqual(new['review']['version'], 0)
        self.assertEqual(self.workspace.history(item['key']), history)
        with self.assertRaises(Conflict):
            self.workspace.import_reviews(old)
        self.save(new['key'])
        self.workspace.export()

    def test_active_and_inactive_unknown_path_collision_is_atomic(self):
        item = self.ingest()
        self.seed_legacy_review(item['key'])
        self.rows[0]['path'] = str(self.root / 'audio/other.wav')
        for inactive in (False, True):
            if inactive:
                self.workspace.ingest([dict(id='healthy', path=str(self.b))], self.root, kind='files')
            for append in (False, True):
                before = self.snapshot()
                with self.assertRaisesRegex(Conflict, 'Primary version collision'):
                    self.ingest(append=append)
                self.assertEqual(self.snapshot(), before)
        # Explicit separate identity is safe; no historical decision is moved.
        self.rows[0]['id'] = 'separate'
        new = self.ingest()
        self.assertEqual(new['review']['version'], 0)
        self.assertEqual(len(self.workspace.history(item['key'])), 1)

    def test_healthy_and_bound_corrupt_legacy_keys_and_exact_byte_restore(self):
        for broken in (False, True):
            with self.subTest(broken=broken):
                write_wav(self.a, seconds=.1)
                if broken:
                    self.a.write_bytes(b'bound corrupt primary')
                original = self.a.read_bytes()
                item = self.ingest()
                asset = self.workspace.asset(item['key'])
                signature = {name: asset[name] for name in ('id', 'source_id', 'source_start', 'source_end', 'eligible')}
                signature.update(sha256=asset['quality']['sha256'], reference_sha256=None)
                self.assertEqual(item['key'], hashlib.sha256(encode(signature).encode()).hexdigest())
                self.save(item['key'])
                exported = self.workspace.export()
                self.assertEqual(self.ingest()['review']['version'], 1)
                self.a.write_bytes(b'changed primary')
                with self.assertRaises(Conflict):
                    self.workspace.import_reviews(exported)
                self.a.write_bytes(original)
                self.assertEqual(self.workspace.import_reviews(exported), 1)
                self.assertEqual(len(self.workspace.history(item['key'])), 2)
                # Same bytes at another path can retain an already-bound key.
                other = self.root / 'audio/bound-copy.wav'
                other.write_bytes(original)
                self.rows[0]['path'] = str(other)
                self.assertEqual(self.ingest()['key'], item['key'])
                self.rows[0]['path'] = str(self.a)

    def test_analyzed_a_identity_survives_b_failure_and_unreadable_fallback(self):
        write_wav(self.a, seconds=.1)
        digest = file_sha256(self.a)
        original = self.a.read_bytes()
        self.rows[0]['reference_path'] = str(self.b)
        real_analyze = analyze
        real_hash = file_sha256
        for changed in (False, True):
            with self.subTest(changed=changed):
                self.a.write_bytes(original)
                failed_b, attempted_a_fallback = [], []
                def fail_b(path, *args, **kwargs):
                    if path == self.b:
                        failed_b.append(path)
                        if changed:
                            self.a.write_bytes(b'different bytes after A analysis')
                        raise AudioError('Synthetic B failure')
                    return real_analyze(path, *args, **kwargs)
                def unreadable_a(path, **kwargs):
                    if path == self.a:
                        attempted_a_fallback.append(path)
                        raise PermissionError('Synthetic fallback failure')
                    return real_hash(path, **kwargs)
                with patch('audio_review_desk.workspace.analyze', side_effect=fail_b), \
                     patch('audio_review_desk.workspace.file_sha256', side_effect=unreadable_a):
                    item = self.ingest()
                self.assertEqual(failed_b, [self.b])
                self.assertEqual(attempted_a_fallback, [])
                self.assertEqual(item['quality']['sha256'], digest)
                if changed:
                    with self.assertRaisesRegex(Conflict, 'Source changed'):
                        self.save(item['key'], item['review']['version'])
                else:
                    self.save(item['key'])
                self.a.write_bytes(original)
                self.workspace.export()

    def test_missing_a_with_b_transitions_never_reuses_decisions(self):
        self.rows[0]['reference_path'] = str(self.b)
        previous_keys = set()
        for reference in ('healthy', 'corrupt', 'missing', 'none'):
            if reference == 'corrupt':
                self.b.write_bytes(b'broken B')
            elif reference == 'missing':
                self.b.unlink()
            elif reference == 'none':
                self.rows[0].pop('reference_path')
            item = self.ingest()
            self.assertNotIn(item['key'], previous_keys)
            previous_keys.add(item['key'])
            self.assertEqual(item['review']['version'], 0)
            with self.assertRaisesRegex(Conflict, 'Primary version is unverified'):
                self.save(item['key'])

    def test_mixed_batch_and_restore_are_atomic(self):
        bad = self.ingest()
        self.seed_legacy_review(bad['key'])
        self.workspace.ingest([dict(id='0-healthy', path=str(self.b))], self.root, kind='files', append=True)
        items = self.workspace.state()['items']
        self.save(items[0]['key'])
        old = self.workspace.state()
        before = self.snapshot()
        operations = (self.workspace.export, self.workspace.export_csv,
                      lambda: self.workspace.export_csv(status='pass'),
                      lambda: self.workspace.batch_review([dict(key=i['key'], expected_version=1) for i in items], 'fix'),
                      lambda: self.workspace.import_reviews(old))
        for operation in operations:
            with self.assertRaises(Conflict):
                operation()
            self.assertEqual(self.snapshot(), before)
        # Check real transaction rollback if A disappears after disposable validation.
        write_wav(self.a, seconds=.1)
        self.rows = [dict(id='0-healthy', path=str(self.b)), dict(id='a', path=str(self.a))]
        self.ingest()
        items = self.workspace.state()['items']
        for item in items:
            self.save(item['key'], item['review']['version'])
        exported = self.workspace.export()
        before = self.snapshot()
        verify = self.workspace.verify_current
        def fail_late(asset):
            if asset['id'] == 'a':
                raise Conflict('Source unavailable; synthetic transaction-time failure')
            verify(asset)
        with patch.object(self.workspace, 'verify_current', side_effect=fail_late):
            with self.assertRaises(Conflict):
                self.workspace.import_reviews(exported)
        self.assertEqual(self.snapshot(), before)

    def test_cancellation_during_fallback_keeps_catalog_and_history(self):
        self.rows[0]['path'] = str(self.b)
        item = self.ingest()
        self.save(item['key'])
        before = self.snapshot()
        self.rows[0]['path'] = str(self.a)
        event = threading.Event()
        def cancel(path, **kwargs):
            event.set()
            kwargs['checkpoint']()
        with patch('audio_review_desk.workspace.file_sha256', side_effect=cancel):
            with self.assertRaises(ImportCancelled):
                self.ingest(cancelled=event)
        self.assertEqual(self.snapshot(), before)

    def test_primary_error_mapping(self):
        self.assertEqual(error_code('Primary version is unverified; make A readable'), 'primary_unverified')
        self.assertEqual(error_code('Primary version collision; back up the workspace'), 'primary_version_collision')


if __name__ == '__main__':
    unittest.main()
