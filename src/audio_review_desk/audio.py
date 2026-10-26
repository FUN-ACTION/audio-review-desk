"""Streaming integer-PCM analysis. This module never writes input audio."""
from __future__ import annotations

import array
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

SUPPORTED = {".wav", ".flac", ".mp3", ".m4a", ".ogg", ".opus", ".aiff", ".aif"}
FULL_SCALE = 2**31
BLOCK = 16384


class AudioError(ValueError):
    """The file could not be completely and consistently decoded."""


def file_sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fingerprint(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def s32_bytes(raw: bytes, width: int) -> bytes:
    """Map unsigned PCM8 / signed little-endian PCM16/24/32 to signed PCM32."""
    if width not in (1, 2, 3, 4) or len(raw) % width:
        raise AudioError("Invalid integer PCM sample width or partial sample")
    if width == 4:
        return raw
    if width == 2:
        samples = array.array("h")
        samples.frombytes(raw)
        if sys.byteorder != "little":
            samples.byteswap()
        values = array.array("i", (sample << 16 for sample in samples))
    elif width == 1:
        values = array.array("i", ((sample - 128) << 24 for sample in raw))
    else:
        values = array.array("i", (int.from_bytes(raw[i:i + 3], "little", signed=True) << 8
                                   for i in range(0, len(raw), 3)))
    if values.itemsize != 4:
        raise AudioError("This platform does not provide 32-bit integer arrays")
    if sys.byteorder != "little":
        values.byteswap()
    return values.tobytes()


@dataclass(frozen=True)
class Decoder:
    ffmpeg: str | None = None
    ffprobe: str | None = None
    timeout: float = 120.0

    def tools(self) -> tuple[str, str]:
        ffmpeg = self.ffmpeg or shutil.which("ffmpeg")
        ffprobe = self.ffprobe or shutil.which("ffprobe")
        if not ffmpeg or not ffprobe:
            raise AudioError("Install FFmpeg and ffprobe, add them to PATH, or set --ffmpeg and --ffprobe")
        return ffmpeg, ffprobe

    def info(self, path: Path) -> dict:
        if path.suffix.lower() == ".wav":
            try:
                with wave.open(str(path), "rb") as stream:
                    if stream.getcomptype() != "NONE" or stream.getsampwidth() not in (1, 2, 3, 4):
                        raise wave.Error("Not integer PCM")
                    return {"sample_rate": stream.getframerate(), "channels": stream.getnchannels(),
                            "expected_frames": stream.getnframes(), "width": stream.getsampwidth(), "backend": "wave"}
            except (wave.Error, EOFError):
                pass
        _, ffprobe = self.tools()
        try:
            result = subprocess.run(
                [ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "a:0",
                 "-show_entries", "stream=sample_rate,channels", "-of", "json", str(path)],
                capture_output=True, timeout=min(self.timeout, 30), check=True)
            stream = json.loads(result.stdout)["streams"][0]
            return {"sample_rate": int(stream["sample_rate"]), "channels": int(stream["channels"]),
                    "expected_frames": None, "width": 4, "backend": "ffmpeg"}
        except (OSError, subprocess.SubprocessError, KeyError, IndexError, ValueError) as exc:
            raise AudioError("Cannot probe audio (missing, unsupported, corrupt, or timed out)") from exc

    def blocks(self, path: Path, info: dict) -> Iterator[bytes]:
        channels = info["channels"]
        if info["backend"] == "wave":
            with wave.open(str(path), "rb") as stream:
                while raw := stream.readframes(BLOCK):
                    if len(raw) % (info["width"] * channels):
                        raise AudioError("Truncated PCM frame")
                    yield s32_bytes(raw, info["width"])
            return
        ffmpeg, _ = self.tools()
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(
                [ffmpeg, "-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe",
                 "-i", str(path), "-map", "0:a:0", "-vn", "-sn", "-dn", "-acodec", "pcm_s32le",
                 "-f", "s32le", "pipe:1"], stdout=subprocess.PIPE, stderr=errors)
            timed_out = threading.Event()

            def terminate() -> None:
                timed_out.set()
                process.kill()

            timer = threading.Timer(self.timeout, terminate)
            timer.daemon = True
            timer.start()
            try:
                assert process.stdout is not None
                while raw := process.stdout.read(BLOCK * channels * 4):
                    if len(raw) % (channels * 4):
                        raise AudioError("Truncated decoded PCM frame")
                    yield raw
                code = process.wait()
                if timed_out.is_set():
                    raise AudioError("Audio decode exceeded the configured timeout")
                if code:
                    raise AudioError("FFmpeg could not completely decode this file")
            finally:
                timer.cancel()
                if process.poll() is None:
                    process.kill()
                process.wait()
                if process.stdout:
                    process.stdout.close()


def integers(raw: bytes) -> array.array:
    values = array.array("i")
    values.frombytes(raw)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def analyze(path: Path, decoder: Decoder | None = None) -> dict:
    decoder = decoder or Decoder()
    before = fingerprint(path)
    digest = file_sha256(path)
    info = decoder.info(path)
    rate, channels = info["sample_rate"], info["channels"]
    if not 1 <= rate <= 768000 or not 1 <= channels <= 64:
        raise AudioError("Unsupported sample rate or channel count")
    pcm = hashlib.sha256(f"pcm-s32le-v1\n{rate}\n{channels}\n".encode())
    frames = count = near_clip = leading = trailing = 0
    square_sum = peak = 0.0
    leading_open = True
    peaks: list[float] = []
    wave_hop, wave_count, wave_peak = max(1, rate // 100), 0, 0
    # Equal-width bins are compacted in pairs, keeping streaming memory bounded.
    for raw in decoder.blocks(path, info):
        pcm.update(raw)
        values = integers(raw)
        if len(values) % channels:
            raise AudioError("Truncated channel frame")
        local_peak = 0
        for offset in range(0, len(values), channels):
            frame_peak = 0
            for channel in range(channels):
                value = values[offset + channel]
                absolute = abs(value)
                frame_peak = max(frame_peak, absolute)
                local_peak = max(local_peak, absolute)
                square_sum += (value / FULL_SCALE) ** 2
                near_clip += absolute >= FULL_SCALE * 0.999
                count += 1
            quiet = frame_peak < FULL_SCALE * 0.001
            wave_peak = max(wave_peak, frame_peak)
            wave_count += 1
            if wave_count == wave_hop:
                peaks.append(wave_peak / FULL_SCALE)
                wave_count, wave_peak = 0, 0
                if len(peaks) == 1024:
                    peaks = [max(peaks[i:i + 2]) for i in range(0, len(peaks), 2)]
                    wave_hop *= 2
            if quiet:
                trailing += 1
                if leading_open:
                    leading += 1
            else:
                leading_open = False
                trailing = 0
            frames += 1
        peak = max(peak, local_peak / FULL_SCALE)
    if wave_count:
        peaks.append(wave_peak / FULL_SCALE)
    if not frames or (info["expected_frames"] is not None and frames != info["expected_frames"]):
        raise AudioError("Empty audio or decoded frame count differs from the WAV header")
    if fingerprint(path) != before:
        raise AudioError("Source changed during analysis; rescan after the file is stable")
    rms = math.sqrt(square_sum / count)
    rms_db = max(-120.0, 20 * math.log10(max(rms, 1e-6)))
    flags = []
    if rms_db <= -60:
        flags.append("silence_or_very_quiet")
    if near_clip:
        flags.append("near_full_scale")
    if channels > 2:
        flags.append("multichannel")
    hop = max(1, math.ceil(len(peaks) / 512))
    waveform = [round(max(peaks[i:i + hop]), 6) for i in range(0, len(peaks), hop)]
    return {"decoded": True, "sha256": digest, "pcm_sha256": pcm.hexdigest(),
            "sample_rate": rate, "channels": channels, "frames": frames,
            "duration": frames / rate, "peak": peak, "rms": rms, "rms_dbfs": rms_db,
            "near_clip_ratio": near_clip / count, "leading_quiet_seconds": leading / rate,
            "trailing_quiet_seconds": trailing / rate, "flags": flags, "waveform": waveform,
            "decoder": info["backend"], "pcm_format": "signed-32-bit-little-endian-v1"}


def write_preview(source: Path, target: Path, expected_sha: str, gain: float, decoder: Decoder) -> None:
    """Write a listening copy; source bytes are read-only and checked before/after."""
    if source.resolve() == target.resolve():
        raise AudioError("Preview output must differ from its source")
    if file_sha256(source) != expected_sha:
        raise AudioError("Source changed since scanning; rescan before listening or scoring")
    info = decoder.info(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    try:
        with wave.open(str(temporary), "wb") as out:
            out.setparams((info["channels"], 2, info["sample_rate"], 0, "NONE", "not compressed"))
            for raw in decoder.blocks(source, info):
                values = array.array("h", (max(-32768, min(32767, round(sample / 65536 * gain)))
                                          for sample in integers(raw)))
                if sys.byteorder != "little":
                    values.byteswap()
                out.writeframesraw(values.tobytes())
        if file_sha256(source) != expected_sha:
            raise AudioError("Source changed while preparing preview")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
