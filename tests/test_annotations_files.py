import csv
import io
import json
import math
import tempfile
import time
import unittest
from pathlib import Path

from audio_review_desk.demo import write_wav
from audio_review_desk.jobs import ImportJobs
from audio_review_desk.workspace import Conflict, Workspace


class AnnotationsAndFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.sources=[self.root/'take-a'/'片段.wav',self.root/'take-b'/'片段.wav']
        for n,path in enumerate(self.sources):write_wav(path,seconds=.5,amplitude=.2+n*.1)
        self.workspace=Workspace(self.root/'workspace')
        self.workspace.import_files([str(p) for p in self.sources])
        self.item=self.workspace.state()['items'][0]

    def tearDown(self):self.temp.cleanup()

    def save(self,**changes):
        payload=dict(self.workspace.state()['items'][0]['review'],status='pass')
        payload['expected_version']=payload.pop('version')
        payload.update(changes)
        return self.workspace.save_review(self.item['key'],payload)

    def test_individual_files_keep_distinct_ids_and_rescan_preserves_reviews(self):
        self.save(markers=[{'time':0,'text':'Start'}])
        before=self.workspace.state()
        self.assertEqual(len({r['id'] for r in before['items']}),2)
        source=self.workspace.import_source()
        self.assertEqual(source['kind'],'files')
        self.assertIsInstance(source['path'],list)
        jobs=ImportJobs(self.workspace)
        jobs.start('files',list(reversed(source['path'])))
        jobs.thread.join(timeout=5)
        self.assertEqual(jobs.snapshot()['state'],'succeeded')
        self.assertEqual(self.workspace.state()['items'],before['items'])

    def test_invalid_file_selection_never_replaces_catalog(self):
        before=self.workspace.state()['items']
        for paths in ([],None,[''],[str(self.root)],[str(self.root/'missing.wav')],[str(self.root/'x.txt')],['x']*501):
            with self.assertRaises((ValueError,OSError)):self.workspace.import_files(paths)
            self.assertEqual(self.workspace.state()['items'],before)

    def test_time_notes_round_trip_csv_json_restore_and_undo(self):
        notes=[{'time':.4,'text':'Tail'},{'time':0,'text':'=Start'}]
        saved=self.save(markers=notes)
        self.assertEqual(saved['markers'][0]['time'],0)
        rows=list(csv.DictReader(io.StringIO(self.workspace.export_csv())))
        self.assertEqual(json.loads(rows[0]['markers']),saved['markers'])
        exported=self.workspace.export()
        fresh=Workspace(self.root/'fresh')
        fresh.import_files([str(p) for p in self.sources])
        self.assertEqual(fresh.import_reviews(exported),1)
        self.assertEqual(fresh.state()['items'][0]['review']['markers'],saved['markers'])
        cleared=self.save(markers=[])
        restored=self.workspace.undo_review(self.item['key'],cleared['version'])
        self.assertEqual(restored['markers'],saved['markers'])
        self.assertEqual(len(self.workspace.history(self.item['key'])),3)

    def test_older_clients_do_not_erase_time_notes(self):
        saved=self.save(markers=[{'time':0,'text':'Start'}])
        payload=dict(saved,status='fix',expected_version=saved['version'])
        payload.pop('markers')
        newer=self.workspace.save_review(self.item['key'],payload)
        self.assertEqual(newer['markers'],saved['markers'])

    def test_invalid_notes_are_atomic_and_stale_edits_are_rejected(self):
        for notes in (None,{},[{'time':True,'text':'x'}],[{'time':math.nan,'text':'x'}],
                      [{'time':.6,'text':'x'}],[{'time':0,'text':' '}],[{'time':0,'text':'x'*241}],
                      [{'time':0,'text':'x'}]*101):
            with self.assertRaises(ValueError):self.save(markers=notes)
            self.assertEqual(self.workspace.state()['items'][0]['review']['version'],0)
        saved=self.save(markers=[{'time':0,'text':'x'}])
        with self.assertRaises(Conflict):self.save(expected_version=0,markers=[])
        self.assertEqual(self.workspace.state()['items'][0]['review'],saved)

    def test_legacy_payloads_remain_readable_without_rewriting_database(self):
        review=self.save(markers=[])
        review.pop('markers')
        with self.workspace.connect() as conn:
            conn.execute('UPDATE reviews SET payload=? WHERE key=?',(json.dumps(review),self.item['key']))
            conn.execute('UPDATE history SET payload=? WHERE key=?',(json.dumps(review),self.item['key']))
        self.assertEqual(self.workspace.state()['items'][0]['review']['markers'],[])
        marked=self.save(markers=[{'time':.2,'text':'Middle'}])
        old=self.workspace.undo_review(self.item['key'],marked['version'])
        self.assertEqual(old['markers'],[])
