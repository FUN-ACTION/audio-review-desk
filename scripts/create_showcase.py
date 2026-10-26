"""Create original test signals for filming the listening workflow."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import SCHEMA, Workspace


def create(root: Path) -> None:
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("Choose a new or empty destination")
    source = root / "signals"
    write_wav(source / "phrase_01.wav", seconds=12, frequency=233.08)
    write_wav(source / "reference.wav", seconds=12, frequency=233.08, amplitude=.12)
    write_wav(source / "phrase_02.wav", seconds=9, frequency=311.13)
    write_wav(source / "phrase_03.wav", seconds=7, frequency=349.23, channels=2)
    write_wav(source / "phrase_04.wav", seconds=8, frequency=196, amplitude=.9)
    items = [dict(id=f"phrase-{n:02}", path=f"phrase_{n:02}.wav", label=f"phrase_{n:02}.wav")
             for n in range(1, 5)]
    items[0]["reference_path"] = "reference.wav"
    manifest = source / "manifest.json"
    manifest.write_text(json.dumps(dict(schema=SCHEMA, items=items), indent=2), encoding="utf-8")
    Workspace(root / "workspace").import_manifest(manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    create(parser.parse_args().destination)
