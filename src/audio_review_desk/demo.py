"""Generate original synthetic fixtures; no downloaded recordings or models."""
from __future__ import annotations

import array
import json
import math
import sys
import wave
from pathlib import Path

from .workspace import SCHEMA, Workspace


def write_wav(path: Path, seconds: float = 2, rate: int = 16000, amplitude: float = 0.2,
              channels: int = 1, offset: float = 0, square: bool = False, frequency: float = 220) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    values = array.array("h")
    for frame in range(round(seconds * rate)):
        time = frame / rate + offset
        signal = math.sin(2 * math.pi * frequency * time) * (0.7 + 0.3 * math.sin(2 * math.pi * 3 * time))
        if square:
            signal = 1 if signal >= 0 else -1
        value = max(-32768, min(32767, round(signal * amplitude * 32767)))
        values.extend([value] * channels)
    if sys.byteorder != "little":
        values.byteswap()
    with wave.open(str(path), "wb") as out:
        out.setparams((channels, 2, rate, 0, "NONE", "not compressed"))
        out.writeframes(values.tobytes())


def create_demo(root: Path) -> dict:
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("Demo destination must be new or empty; existing workspaces are never overwritten")
    samples = root / "demo-input"
    write_wav(samples / "01-clean.wav")
    write_wav(samples / "02-exact-duplicate.wav")
    # Same PCM, different container bytes: append a legal RIFF JUNK chunk.
    duplicate = samples / "02-exact-duplicate.wav"
    data = bytearray(duplicate.read_bytes())
    data += b"JUNK\x04\x00\x00\x00demo"
    data[4:8] = (len(data) - 8).to_bytes(4, "little")
    duplicate.write_bytes(data)
    write_wav(samples / "03-near-full-scale.wav", amplitude=1, square=True)
    write_wav(samples / "04-silence.wav", amplitude=0)
    write_wav(samples / "05-stereo.wav", channels=2)
    write_wav(samples / "06-overlap-a.wav", offset=0, frequency=311.37)
    write_wav(samples / "07-overlap-b.wav", offset=1, frequency=311.37)
    write_wav(samples / "reference.wav", amplitude=0.08)
    (samples / "08-broken.wav").write_bytes(b"RIFF\x00\x00\x00\x00WAVEbroken")
    names = [("01-clean", "Clean / A-B example"), ("02-exact-duplicate", "Same PCM, different file bytes"),
             ("03-near-full-scale", "Near full scale"), ("04-silence", "Silence"),
             ("05-stereo", "Stereo"), ("06-overlap-a", "Source overlap: 0-2 s"),
             ("07-overlap-b", "Source overlap: 1-3 s"), ("08-broken", "Unreadable file")]
    items = [{"id": name, "path": f"{name}.wav", "label": label} for name, label in names]
    items[0]["reference_path"] = "reference.wav"
    for index in (5, 6):
        items[index].update(source_id="demo-recording", source_start=index - 5)
    manifest = samples / "manifest.json"
    manifest.write_text(json.dumps({"schema": SCHEMA, "items": items}, indent=2), encoding="utf-8")
    return Workspace(root).import_manifest(manifest)
