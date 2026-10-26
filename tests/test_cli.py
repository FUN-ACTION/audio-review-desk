import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from audio_review_desk.cli import main
from audio_review_desk.demo import write_wav


class CliTests(unittest.TestCase):
    def test_empty_workspace_initialization_and_csv_export(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            root=Path(temporary)
            self.assertEqual(main(['init','--workspace',str(root/'workspace')]),0)
            self.assertTrue((root/'workspace'/'reviews.sqlite').exists())
            target=root/'empty.csv'
            self.assertEqual(main(['export','--workspace',str(root/'workspace'),'--format','csv','--output',str(target)]),0)
            self.assertIn('source_id',target.read_text(encoding='utf-8-sig'))
    def test_demo_export_restore_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            root = Path(temporary)
            workspace = root / "demo"
            output = root / "reviews.json"
            self.assertEqual(main(["demo", "--workspace", str(workspace)]), 0)
            self.assertEqual(main(["export", "--workspace", str(workspace), "--output", str(output)]), 0)
            before = output.read_bytes()
            self.assertEqual(main(["export", "--workspace", str(workspace), "--output", str(output)]), 2)
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(main(["restore", str(output), "--workspace", str(workspace)]), 0)

    def test_missing_workspace_is_clear_error(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stderr(io.StringIO()) as error:
            self.assertEqual(main(["serve", "--workspace", str(Path(temporary) / "missing")]), 2)
            self.assertIn("Workspace not found", error.getvalue())

    def test_csv_import_with_unicode_and_spaces(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            root = Path(temporary)
            write_wav(root / "音频 files" / "声音.wav", seconds=.1)
            manifest = root / "clips.csv"
            manifest.write_text('id,path,label,eligible\nclip,音频 files/声音.wav,中文标题,true\n', encoding="utf-8")
            self.assertEqual(main(["import", str(manifest), "--workspace", str(root / "work")]), 0)


if __name__ == "__main__":
    unittest.main()
