"""Reject malformed CSV before ingesting any row or changing saved work."""
import contextlib
import csv
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.cli import main
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import Workspace


class CsvManifestValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.audio = self.root / "音频 files"
        write_wav(self.audio / "声音.wav", seconds=.1)
        self.workspace = Workspace(self.root / "workspace")
        self.key = self.workspace.scan(self.audio)["items"][0]["key"]
        self.workspace.save_review(self.key, dict(status="pass", score=8,
            issues=[], note="Keep this review", expected_version=0))
        self.before = self.workspace.state()
        self.source_before = self.workspace.import_source()
        self.history_before = self.workspace.history(self.key)
        with self.workspace.connect() as connection:
            self.database_before = list(connection.iterdump())
        self.manifest = self.root / "clips.csv"

    def assert_preserved(self):
        self.assertEqual(self.workspace.state(), self.before)
        self.assertEqual(self.workspace.import_source(), self.source_before)
        self.assertEqual(self.workspace.history(self.key), self.history_before)
        with self.workspace.connect() as connection:
            self.assertEqual(list(connection.iterdump()), self.database_before)

    def test_late_malformed_rows_never_reach_ingest(self):
        valid_prefix = 'id,path,label\nfirst,音频 files/声音.wav,"Valid\nmultiline"\n'
        for append in (False, True):
            for suffix, line in (('bad,音频 files/声音.wav,"unterminated\nstill open', 5),
                                 ('bad,音频 files/声音.wav,"closed"junk\n', 4)):
                with self.subTest(append=append, suffix=suffix):
                    self.manifest.write_text(valid_prefix + suffix, encoding="utf-8-sig")
                    with patch.object(self.workspace, "ingest") as ingest:
                        with self.assertRaisesRegex(ValueError, f"Malformed CSV manifest at line {line}:") as error:
                            self.workspace.import_manifest(self.manifest, append=append)
                        self.assertIsInstance(error.exception.__cause__, csv.Error)
                        ingest.assert_not_called()
                    self.assert_preserved()

    def test_malformed_header_reports_its_physical_line(self):
        self.manifest.write_text('id,path,"label', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Malformed CSV manifest at line 1:"):
            self.workspace.import_manifest(self.manifest)
        self.assert_preserved()

    def test_cli_reports_error_without_success_or_database_changes(self):
        self.manifest.write_text('id,path,label\nfirst,音频 files/声音.wav,Valid\n'
                                 'bad,音频 files/声音.wav,"unterminated', encoding="utf-8")
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = main(["import", str(self.manifest), "--workspace", str(self.workspace.root)])
        self.assertEqual(status, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("Malformed CSV manifest at line 3: unexpected end of data", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())
        self.assert_preserved()

    def test_duplicate_nonempty_headers_are_rejected_before_ingest(self):
        for header, line, duplicate in (
            ('id,path,path,label', 1, 'path'),
            ('id,path,label,label', 1, 'label'),
            ('id,path,extra,extra', 1, 'extra'),
            ('id,path,"extra\nname","extra\nname"', 3, 'extra'),
        ):
            with self.subTest(header=header):
                self.manifest.write_text(header + '\nclip,音频 files/声音.wav,ignored,last\n',
                                         encoding="utf-8-sig")
                with patch.object(self.workspace, "ingest") as ingest:
                    with self.assertRaisesRegex(ValueError,
                            f"Malformed CSV manifest at line {line}: duplicate header") as error:
                        self.workspace.import_manifest(self.manifest)
                    self.assertIn(duplicate, str(error.exception))
                    ingest.assert_not_called()
                self.assert_preserved()

    def test_late_surplus_cells_preserve_everything(self):
        prefix = 'id,path,label\nfirst,音频 files/声音.wav,"Valid\nmultiline"\n'
        for append in (False, True):
            for extra in (',discarded', ',', ',,'):
                with self.subTest(append=append, extra=extra):
                    self.manifest.write_text(prefix + 'last,音频 files/声音.wav,Label' + extra + '\n',
                                             encoding="utf-8-sig")
                    with patch.object(self.workspace, "ingest") as ingest:
                        with self.assertRaisesRegex(ValueError,
                                "Malformed CSV manifest at line 4: row has more cells than the header"):
                            self.workspace.import_manifest(self.manifest, append=append)
                        ingest.assert_not_called()
                    self.assert_preserved()

    def test_cli_rejects_ambiguous_csv_without_mutation(self):
        for content, line in (
            ('id,path,path\nclip,wrong.wav,音频 files/声音.wav\n', 1),
            ('id,path,label\nfirst,音频 files/声音.wav,Valid\nlast,音频 files/声音.wav,Label,\n', 3),
        ):
            with self.subTest(content=content):
                self.manifest.write_text(content, encoding="utf-8")
                stdout, stderr = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    status = main(["import", str(self.manifest), "--workspace", str(self.workspace.root)])
                self.assertEqual(status, 2)
                self.assertEqual(stdout.getvalue(), "")
                self.assertIn(f"Malformed CSV manifest at line {line}:", stderr.getvalue())
                self.assert_preserved()

    def test_named_extras_and_missing_optional_trailing_fields_remain_valid(self):
        self.manifest.write_text(
            'id,path,label,extra,source_id,source_start,source_end,reference_path,eligible\n'
            'first,音频 files/声音.wav,"A, B","Say ""hello"""\n'
            'second,音频 files/声音.wav\n', encoding="utf-8-sig")
        items = {item["id"]: item for item in self.workspace.import_manifest(self.manifest)["items"]}
        self.assertEqual(items["first"]["label"], "A, B")
        self.assertEqual(items["second"]["label"], "second")
        self.assertEqual(items["first"]["source_start"], 0)
        self.assertEqual(items["second"]["source_start"], 0)
        self.assertTrue(items["first"]["eligible"])
        self.assertTrue(items["second"]["eligible"])

    def test_explicit_empty_eligible_cell_is_not_an_omission(self):
        self.manifest.write_text('id,path,eligible\nclip,音频 files/声音.wav,\n', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "eligible must be true or false"):
            self.workspace.import_manifest(self.manifest)
        self.assert_preserved()

    def test_valid_unicode_bom_commas_quotes_and_multiline_labels(self):
        special = self.audio / "声音,🎧.wav"
        write_wav(special, seconds=.1, amplitude=.3)
        original = special.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        for encoding in ("utf-8", "utf-8-sig"):
            for newline in ("\n", "\r\n"):
                with self.subTest(encoding=encoding, newline=repr(newline)):
                    labels = ['中文标题', 'A, B', 'Say "hello"', f'First{newline}第二行']
                    with self.manifest.open("w", encoding=encoding, newline="") as stream:
                        writer = csv.writer(stream, lineterminator=newline)
                        writer.writerow(["id", "path", "label", "eligible"])
                        for index, label in enumerate(labels):
                            writer.writerow([str(index), "音频 files/声音.wav", label, "true"])
                        writer.writerow(["special-path", special.relative_to(self.root).as_posix(), "Comma and emoji filename", "true"])
                    state = self.workspace.import_manifest(self.manifest)
                    self.assertEqual({item["id"]: item["label"] for item in state["items"]},
                                     {**{str(index): label for index, label in enumerate(labels)},
                                      "special-path": "Comma and emoji filename"})
                    item = next(item for item in state["items"] if item["id"] == "special-path")
                    self.assertEqual(self.workspace.asset(item["key"])["path"], str(special.resolve()))
                    self.assertTrue(item["quality"]["decoded"])
                    self.assertEqual(item["quality"]["sha256"], digest)
                    self.assertEqual(special.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
