"""Create original test signals for filming the listening workflow."""
from __future__ import annotations

import argparse
import json
import math
import random
import struct
import wave
from pathlib import Path

from audio_review_desk.workspace import SCHEMA, Workspace


def write_take(path: Path, seconds: float, *, seed: int, channels: int = 1,
               reference: bool = False) -> None:
    """Original procedural signals with varied phrasing; no speech or recordings."""
    rate, phase = 16000, 0.0
    randomizer = random.Random(seed)
    phrases = []
    position = .24
    while position < seconds - .3:
        length = randomizer.uniform(.14, .43)
        phrases.append((position, length, randomizer.uniform(.25, .8), randomizer.uniform(130, 240)))
        position += length + randomizer.uniform(.04, .2)
        if len(phrases) % 5 == 0:
            position += randomizer.uniform(.25, .5)
    data, phrase = bytearray(), 0
    for index in range(round(seconds * rate)):
        now = index / rate
        while phrase + 1 < len(phrases) and now >= phrases[phrase + 1][0]:
            phrase += 1
        start, length, level, pitch = phrases[phrase]
        relative = (now - start) / length
        envelope = math.sin(math.pi * relative) ** 1.5 if 0 < relative < 1 else 0
        phase += 2 * math.pi * pitch * (1 + .035 * math.sin(now * 9)) / rate
        harmonics = math.sin(phase) + .34 * math.sin(phase * 2 + .2) + (.12 if reference else .2) * math.sin(phase * 5)
        air = randomizer.uniform(-1, 1) * .025
        value = int(21000 * envelope * level * (harmonics * .7 + air))
        data.extend(struct.pack('<h', value) * channels)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as output:
        output.setparams((channels, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(data)


def create(root: Path) -> None:
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("Choose a new or empty destination")
    source = root / "signals"
    write_take(source / "take_01.wav", 12, seed=11)
    write_take(source / "reference.wav", 12, seed=11, reference=True)
    write_take(source / "take_02.wav", 9, seed=24)
    write_take(source / "take_03.wav", 7, seed=37, channels=2)
    write_take(source / "take_04.wav", 8, seed=48)
    items = [dict(id=f"take-{n:02}", path=f"take_{n:02}.wav", label=f"take_{n:02}.wav")
             for n in range(1, 5)]
    items[0]["reference_path"] = "reference.wav"
    manifest = source / "manifest.json"
    manifest.write_text(json.dumps(dict(schema=SCHEMA, items=items), indent=2), encoding="utf-8")
    Workspace(root / "workspace").import_manifest(manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    create(parser.parse_args().destination)
