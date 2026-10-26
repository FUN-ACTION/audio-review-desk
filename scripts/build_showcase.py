"""Build a static walkthrough. No workspace, database or recordings are read."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def build(destination: Path) -> Path:
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Choose a new or empty output directory")
    source = Path(__file__).resolve().parents[1] / "src/audio_review_desk/static"
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / "tour", destination / "tour")
    for name in ("studio-latin.woff2", "studio-cjk.woff2", "inter-OFL.txt", "notosanssc-OFL.txt", "motion-vendor.js", "motion-LICENSE.txt"):
        shutil.copy2(source / name, destination / name)
    (destination / ".nojekyll").touch()
    (destination / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<meta http-equiv="refresh" content="0;url=./tour/"><title>Audio Review Desk</title>'
        '<a href="./tour/">Audio Review Desk — In action</a></html>', encoding="utf-8")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(build(parser.parse_args().output))
