"""CLI restore and in-memory HTTP JSON reject ambiguity before mutations."""
import contextlib
import copy
import io
import json
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.cli import main
from audio_review_desk.demo import write_wav
from audio_review_desk.server import make_server
from audio_review_desk.workspace import Workspace
from scripts.check_server_in_memory import MemoryTransport


class JsonReviewInputTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        audio = self.root / 'audio'
        write_wav(audio / 'a.wav', seconds=.5)
        write_wav(audio / 'b.wav', seconds=.5, amplitude=.3)
        self.workspace = Workspace(self.root / 'workspace')
        items = self.workspace.scan(audio)['items']
        self.keys = [item['key'] for item in items]
        for key in self.keys:
            self.workspace.save_review(key, dict(status='fix', expected_version=0,
                note='保存', markers=[{'time': .1, 'text': 'Listen'}]))
        self.document = self.workspace.export()
        self.before = self.snapshot()
        self.input = self.root / 'reviews.json'
        self.transport = MemoryTransport()
        with patch('audio_review_desk.server.ThreadingHTTPServer', self.transport.make_server), \
             patch('audio_review_desk.server.secrets.token_urlsafe', return_value='test-token'):
            self.server = make_server(self.workspace, 0)
        self.addCleanup(self.server.server_close)
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def snapshot(self):
        with self.workspace.connect() as connection:
            database = list(connection.iterdump())
        return (self.workspace.state(), self.workspace.import_source(), database,
                [self.workspace.history(key) for key in self.keys])

    def cli_restore(self, data):
        self.input.write_bytes(data)
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = main(['restore', str(self.input), '--workspace', str(self.workspace.root)])
        return status, stdout.getvalue(), stderr.getvalue()

    def request(self, path, data, headers=None):
        headers = dict({'Content-Type': 'application/json', 'Origin': self.origin,
                        'X-Review-Token': 'test-token'}, **(headers or {}))
        request = urllib.request.Request(self.origin + path, data=data, headers=headers)
        try:
            response = self.transport.open(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    @staticmethod
    def numeric_payload(field, value):
        return ({'markers': [{'time': value, 'text': 'Position'}]}
                if field == 'marker.time' else {field: value})

    def test_invalid_review_numbers_reject_without_mutation_http_and_cli(self):
        errors = {
            'score': 'Score must be null or a finite number from 0 to 10',
            'trim_start': 'Trim bounds must be finite seconds within this clip',
            'trim_end': 'Trim bounds must be finite seconds within this clip',
            'marker.time': 'Time notes need a position within the clip and text of 1 to 240 characters',
        }
        for field, message in errors.items():
            maximum = 10 if field == 'score' else .5
            for value in (10**400, -(10**400), float('nan'), float('inf'),
                          -float('inf'), True, False, -0.01, maximum + .01, '0'):
                with self.subTest(field=field, value=value):
                    change = self.numeric_payload(field, value)
                    payload = dict(key=self.keys[0], status='pass', expected_version=1, **change)
                    status, body = self.request('/api/review', json.dumps(payload).encode())
                    self.assertEqual(status, 422)
                    self.assertEqual(body['code'], {'score': 'score_range', 'trim_start': 'trim_invalid',
                                                   'trim_end': 'trim_invalid', 'marker.time': 'marker_invalid'}[field])
                    self.assertEqual(body['error'], message)
                    self.assertEqual(self.snapshot(), self.before)
                    document = copy.deepcopy(self.document)
                    # Stage a valid changed row before the invalid later row.
                    document['items'][0]['review']['note'] = 'Must not be committed'
                    document['items'][1]['review'].update(change)
                    status, stdout, stderr = self.cli_restore(json.dumps(document).encode())
                    self.assertEqual(status, 2)
                    self.assertEqual(stdout, '')
                    self.assertIn(message, stderr)
                    self.assertNotIn('Traceback', stderr)
                    self.assertEqual(self.snapshot(), self.before)

    def test_valid_review_numbers_round_trip_http_and_cli(self):
        cases = [
            dict(score=0, trim_start=0, trim_end=.5,
                 markers=[{'time': 0, 'text': 'Start'}, {'time': .5, 'text': 'End'}]),
            dict(score=10, trim_start=0.0, trim_end=.5, markers=[]),
            dict(score=4.25, trim_start=.125, trim_end=.375,
                 markers=[{'time': .25, 'text': 'Middle'}]),
            dict(score=None, trim_start=None, trim_end=None, markers=[]),
        ]
        version = 1
        for change in cases:
            with self.subTest(change=change):
                payload = dict(key=self.keys[0], status='pass', expected_version=version, **change)
                status, body = self.request('/api/review', json.dumps(payload).encode())
                self.assertEqual(status, 200)
                version += 1
                self.assertEqual(body['review']['version'], version)
                for field, value in change.items():
                    self.assertEqual(body['review'][field], value)
                document = copy.deepcopy(self.document)
                for item in document['items']:
                    item['review'].update(change)
                status, stdout, stderr = self.cli_restore(json.dumps(document).encode())
                self.assertEqual(status, 0, stderr)
                self.assertIn('Restored 2', stdout)
                version += 1
                for item in self.workspace.state()['items']:
                    for field, value in change.items():
                        self.assertEqual(item['review'][field], value)
                self.assertEqual(len(self.workspace.history(self.keys[0])), version)

    def test_empty_and_reversed_trim_boundaries_still_reject(self):
        for start, end in ((0, 0), (.5, .5), (.5, None), (None, 0), (.375, .125)):
            with self.subTest(start=start, end=end):
                status, body = self.request('/api/review', json.dumps(dict(
                    key=self.keys[0], status='fix', expected_version=1,
                    trim_start=start, trim_end=end)).encode())
                self.assertEqual(status, 422)
                self.assertEqual(body['error'], 'Trim start must be before trim end')
                self.assertEqual(self.snapshot(), self.before)

    def test_cli_duplicate_properties_at_late_and_nested_positions_preserve_database(self):
        original = json.dumps(self.document, ensure_ascii=False)
        second = self.document['items'][1]
        # A valid earlier item precedes duplicate review fields in the second item.
        row = json.dumps(second, ensure_ascii=False)
        bad_rows = [
            row.replace('"status": "fix"', '"status": "pass", "status": "fix"'),
            row.replace('"key": ', '"key": "wrong", "key": ', 1),
            row.replace('"review": ', '"review": {}, "review": ', 1),
            row.replace('"time": 0.1', '"time": 0.2, "time": 0.1'),
            row.replace('"text": "Listen"', '"text": "Other", "text": "Listen"'),
        ]
        payloads = [original.replace(row, bad) for bad in bad_rows]
        payloads.append(original.replace('"items": ', '"items": [], "items": ', 1))
        for payload in payloads:
            with self.subTest(payload=payload):
                status, stdout, stderr = self.cli_restore(payload.encode('utf-8-sig'))
                self.assertEqual(status, 2)
                self.assertEqual(stdout, '')
                self.assertIn('Review restore JSON contains duplicate property', stderr)
                self.assertEqual(self.snapshot(), self.before)

    def test_http_review_and_batch_duplicates_are_422_without_mutation(self):
        key = json.dumps(self.keys[0])
        review = '{"key":' + key + ',"status":"pass","expected_version":1'
        cases = [
            ('/api/review', review + ',"status":"fix"}'),
            ('/api/review', review + ',"key":' + key + '}'),
            ('/api/review', review + ',"markers":[{"time":0.1,"time":0.2,"text":"x"}]}'),
            ('/api/review', review + ',"extra":{"review":1,"review":2}}'),
            ('/api/batch', '{"status":"fix","status":"exclude","changes":[{"key":' + key + ',"expected_version":1}]}'),
            ('/api/batch', '{"status":"exclude","changes":[{"key":' + key + ',"key":' + key + ',"expected_version":1}]}'),
            ('/api/batch', '{"status":"exclude","changes":[],"changes":[{"key":' + key + ',"expected_version":1}]}'),
        ]
        for path, payload in cases:
            with self.subTest(path=path, payload=payload):
                status, body = self.request(path, payload.encode())
                self.assertEqual(status, 422)
                self.assertEqual(body['code'], 'review_invalid')
                self.assertIn('Request JSON contains duplicate property', body['error'])
                self.assertEqual(self.snapshot(), self.before)

    def test_valid_legacy_restore_accepts_bom_unicode_and_omitted_markers(self):
        document = copy.deepcopy(self.document)
        for item in document['items']:
            item['review'].pop('markers')
            item['review']['note'] = '旧版本备注'
        document['extra'] = {'key': 'unique extra'}
        status, stdout, stderr = self.cli_restore(json.dumps(document, ensure_ascii=False).encode('utf-8-sig'))
        self.assertEqual(status, 0, stderr)
        self.assertIn('Restored 2', stdout)
        for item in self.workspace.state()['items']:
            self.assertEqual(item['review']['markers'], [])
            self.assertEqual(item['review']['note'], '旧版本备注')
            self.assertEqual(item['review']['version'], 2)

    def test_normal_http_review_then_batch_succeeds(self):
        status, body = self.request('/api/review', json.dumps(dict(key=self.keys[0], status='pass',
            expected_version=1, note='正常', extra={'status': 'unrelated'}), ensure_ascii=False).encode('utf-8-sig'))
        self.assertEqual(status, 200)
        self.assertEqual(body['review']['markers'], [{'time': .1, 'text': 'Listen'}])
        status, _ = self.request('/api/batch', json.dumps(dict(status='exclude', changes=[
            dict(key=self.keys[0], expected_version=2), dict(key=self.keys[1], expected_version=1)])).encode())
        self.assertEqual(status, 200)
        self.assertTrue(all(item['review']['status'] == 'exclude' for item in self.workspace.state()['items']))

    def test_malformed_syntax_encoding_and_nonobject_contracts_preserve_database(self):
        for data in (b'{"key":', b'{"key":"\xff"}', b'[]', b'\xff\xfe{'):
            with self.subTest(data=data):
                status, stdout, _ = self.cli_restore(data)
                self.assertEqual(status, 2)
                self.assertEqual(stdout, '')
                status, _ = self.request('/api/review', data)
                self.assertEqual(status, 422)
                self.assertEqual(self.snapshot(), self.before)

    def test_http_body_limits_and_preparse_gates_are_unchanged(self):
        cases = [(b'', {}, 413), (b' ' * 131073, {}, 413),
                 (b'{}', {'Content-Type': 'text/plain'}, 415),
                 (b'{}', {'X-Review-Token': 'wrong'}, 403)]
        for data, headers, expected in cases:
            with self.subTest(expected=expected):
                status, _ = self.request('/api/review', data, headers)
                self.assertEqual(status, expected)
                self.assertEqual(self.snapshot(), self.before)


if __name__ == '__main__':
    unittest.main()
