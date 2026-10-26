"""Build release files from the committed tree, without local build leftovers."""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
import tomllib
import zipfile
from pathlib import Path


def check_release_notes(repo: Path, version: str) -> Path:
    notes = repo / "docs" / "releases" / f"{version}.md"
    if not notes.is_file():
        raise ValueError(f"Missing release notes: {notes.relative_to(repo)}")
    text = notes.read_text(encoding="utf-8")
    required = (f"# Audio Review Desk {version}", "## 本版变化", "## 安装与升级", "## 旧工作区", "## 验证",
                "备份", "整个工作区", "pip install --upgrade", "--workspace")
    missing = [part for part in required if part not in text]
    if missing:
        raise ValueError(f"Incomplete release notes: {', '.join(missing)}")
    return notes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New or empty release directory")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=repo)
    if dirty.strip():
        parser.error("Commit or set aside source changes before building a release")
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error("The output directory must be new or empty")
    version = tomllib.loads((repo / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    check_release_notes(repo, version)
    prefix = f"audio-review-desk-{version}"
    output.mkdir(parents=True, exist_ok=True)
    source = output / f"{prefix}-source.zip"
    with source.open("xb") as archive:
        subprocess.run(["git", "archive", "--format=zip", f"--prefix={prefix}/", "HEAD"],
                       cwd=repo, stdout=archive, check=True)
    with tempfile.TemporaryDirectory(prefix="ard-release-") as temporary:
        with zipfile.ZipFile(source) as archive:
            archive.extractall(temporary)
        clean_source = Path(temporary) / prefix
        subprocess.run([sys.executable, "-m", "pip", "wheel", "--no-deps", ".", "--wheel-dir", str(output)],
                       cwd=clean_source, check=True)
    wheel = output / f"audio_review_desk-{version}-py3-none-any.whl"
    if not wheel.is_file():
        raise RuntimeError("Expected wheel was not built")
    for path in (source, wheel):
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise RuntimeError(f"Invalid archive: {path.name}")
    checksums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in (source, wheel))
    (output / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8")
    print(f"Release files: {output}")


if __name__ == "__main__":
    main()
