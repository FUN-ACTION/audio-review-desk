"""Encode browser captures, retaining capture timing and the actual pointer trace."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path


def ass_time(seconds: float) -> str:
    ticks = max(0, round(seconds * 100))
    return f"{ticks // 360000}:{ticks // 6000 % 60:02}:{ticks // 100 % 60:02}.{ticks % 100:02}"


def validate_region(region):
    if region is None:
        return None
    if len(region) != 4 or any(type(value) is not int for value in region):
        raise ValueError("Region needs four integer values: x y width height")
    x, y, width, height = region
    if x < 0 or y < 0 or x % 2 or y % 2 or width < 32 or height < 32 or width % 2 or height % 2 or x + width > 1280 or y + height > 720:
        raise ValueError("Region must fit the 1280 x 720 recording and have even dimensions")
    return x, y, width, height


def encode(capture: Path, output: Path, name: str, crop: bool = False, *, region=None, poster_at=None) -> dict:
    region = validate_region(region if region is not None else (280, 70, 710, 610) if crop else None)
    data = json.loads(capture.read_text(encoding="utf-8"))
    rows = data["frames"]
    assert len(rows) > 10 and all(b["timestamp"] >= a["timestamp"] for a, b in zip(rows, rows[1:]))
    start, end = rows[0]["timestamp"], max(data["ended"], rows[-1]["timestamp"] + .1)
    duration = end - start
    output.mkdir(parents=True, exist_ok=True)
    target = (output / f"{name}.mp4").resolve()
    with tempfile.TemporaryDirectory(prefix="ard-video-") as temporary:
        work = Path(temporary)
        lines = []
        for index, row in enumerate(rows):
            filename = Path(row["file"]).as_posix().replace("'", "'\\''")
            until = rows[index + 1]["timestamp"] if index + 1 < len(rows) else end
            lines += [f"file '{filename}'", f"duration {max(.001, until-row['timestamp']):.6f}"]
        lines.append(f"file '{Path(rows[-1]['file']).as_posix()}'")
        (work / "frames.txt").write_text("\n".join(lines), encoding="utf-8")
        header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cursor,Arial,20,&H0020252B,&H0020252B,&H00FFFFFF,&H50000000,0,0,0,0,100,100,0,0,1,1.3,1.2,7,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        trace = data["pointer"]
        events = []
        for index, point in enumerate(trace):
            following = trace[index + 1] if index + 1 < len(trace) else dict(point, time=end)
            left, right = max(0, point["time"]-start), min(duration, following["time"]-start)
            if right <= left:
                continue
            command = f"{{\\move({point['x']:.1f},{point['y']:.1f},{following['x']:.1f},{following['y']:.1f})\\p1}}"
            shape = "m 0 0 l 0 20 5 15 9 24 13 22 9 14 18 14 0 0"
            events.append(f"Dialogue: 0,{ass_time(left)},{ass_time(right)},Cursor,,0,0,0,,{command}{shape}")
        (work / "pointer.ass").write_text(header + "\n".join(events), encoding="utf-8")
        # Resample timestamps in the filter graph. Output-only -r can discard
        # the last still-image hold. Keep that hold through the capture end.
        filters = f"fps=30,ass=pointer.ass,scale=in_range=full:out_range=limited,format=yuv420p,tpad=stop_mode=clone:stop_duration={duration:.6f}"
        if region:
            x, y, width, height = region
            filters += f",crop={width}:{height}:{x}:{y}"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "frames.txt",
                        "-vf", filters, "-fps_mode", "passthrough", "-t", f"{duration:.3f}", "-c:v", "libx264",
                        "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-color_range", "tv", "-an", "-movflags", "+faststart", str(target)], cwd=work, check=True)
    poster = target.with_suffix(".webp")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(max(0, min(duration-.1, poster_at if poster_at is not None else 7 if region else 1))),
                    "-i", str(target), "-frames:v", "1", "-c:v", "libwebp", "-quality", "90", str(poster)], check=True)
    return dict(name=name, seconds=round(duration, 3), captured_frames=len(rows), encoded_fps=30, crop=region,
                bytes=target.stat().st_size, sha256=hashlib.sha256(target.read_bytes()).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--name", required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--crop", action="store_true", help="Legacy 710 x 610 close-up")
    group.add_argument("--region", nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument("--poster-at", type=float)
    args = parser.parse_args()
    print(json.dumps(encode(args.capture, args.output, args.name, args.crop, region=args.region, poster_at=args.poster_at)))
