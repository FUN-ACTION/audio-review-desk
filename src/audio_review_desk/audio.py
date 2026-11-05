"""Streaming integer-PCM analysis. This module never writes input audio."""
from __future__ import annotations

import array
import hashlib
import json
import logging
import math
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

from .ogg import ending_advisory
from .mp3 import frame_count_advisory
from .mp4 import container_extent_advisory
from .mp4_samples import indexed_audio_bytes_advisory

SUPPORTED = {".wav", ".flac", ".mp3", ".m4a", ".ogg", ".opus", ".aiff", ".aif"}
FULL_SCALE = 2**31
BLOCK = 16384


class AudioError(ValueError):
    """The file could not be completely and consistently decoded."""


def file_sha256(path: Path, *, checkpoint: Callable[[], None] | None = None) -> str:
    """Hash read-only input, optionally checking between bounded 1 MiB reads."""
    if checkpoint is not None:
        checkpoint()
    with path.open("rb") as stream:
        if checkpoint is None:
            return hashlib.file_digest(stream, "sha256").hexdigest()
        digest = hashlib.sha256()
        while True:
            checkpoint()
            raw = stream.read(1024 * 1024)
            checkpoint()
            if not raw:
                break
            digest.update(raw)
        checkpoint()
        return digest.hexdigest()


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


def flac_streaminfo(path: Path) -> tuple[int, int, int | None] | None:
    """Read the mandatory first STREAMINFO block of native FLAC, not a duration.

    FLAC STREAMINFO packs sample rate (20 bits), channels minus one (3),
    bits per sample minus one (5), and total interchannel samples (36).
    The total counts PCM frames, not channels times frames; zero means unknown.
    Only the native fLaC signature qualifies, regardless of filename suffix.
    Other containers (including Ogg FLAC) retain decoder-only validation.
    """
    with path.open("rb") as source:
        if source.read(4) != b"fLaC":
            return None
        header = source.read(4)
        if len(header) != 4 or header[0] & 0x7f or int.from_bytes(header[1:], "big") != 34:
            raise AudioError("Invalid or truncated FLAC STREAMINFO header")
        payload = source.read(34)
        if len(payload) != 34:
            raise AudioError("Truncated FLAC STREAMINFO metadata")
    packed = int.from_bytes(payload[10:18], "big")
    rate = packed >> 44
    channels = ((packed >> 41) & 7) + 1
    width = ((packed >> 36) & 31) + 1
    if not rate or width < 4:
        raise AudioError("Invalid FLAC STREAMINFO sample format")
    total = packed & ((1 << 36) - 1)
    return rate, channels, total or None


def validate_frame_count(frames: int, info: dict) -> None:
    if not frames or (info["expected_frames"] is not None and frames != info["expected_frames"]):
        raise AudioError("Empty audio or decoded frame count differs from the audio header")


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
        flac = flac_streaminfo(path)
        try:
            result = subprocess.run(
                [ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "a:0",
                 "-show_entries", "stream=sample_rate,channels", "-of", "json", str(path)],
                capture_output=True, timeout=min(self.timeout, 30), check=True)
            stream = json.loads(result.stdout)["streams"][0]
            rate, channels = int(stream["sample_rate"]), int(stream["channels"])
            if flac is not None and (rate, channels) != flac[:2]:
                raise AudioError("FLAC STREAMINFO differs from the decoded sample format")
            return {"sample_rate": rate, "channels": channels,
                    "expected_frames": flac[2] if flac is not None else None,
                    "width": 4, "backend": "ffmpeg"}
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


def analyze(path: Path, decoder: Decoder | None = None, *,
            checkpoint: Callable[[], None] | None = None) -> dict:
    """Analyze with optional cooperative checks around hashing, probing and PCM blocks.

    Checks cannot interrupt an in-flight probe or a blocking decoder pipe read.
    Existing FFmpeg timeouts still apply; cancellation closes the block iterator.
    Source hashes before and after decoding detect persistent content changes,
    including replacements preserving size and mtime. This adds one full source
    read and is not an atomic snapshot: external writers must keep input stable.
    """
    if checkpoint is not None:
        checkpoint()
    decoder = decoder or Decoder()
    before = fingerprint(path)
    digest = file_sha256(path) if checkpoint is None else file_sha256(path, checkpoint=checkpoint)
    if checkpoint is not None:
        checkpoint()
    info = decoder.info(path)
    if checkpoint is not None:
        checkpoint()
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
    if checkpoint is not None:
        checkpoint()
    blocks = decoder.blocks(path, info)
    try:
        for raw in blocks:
            if checkpoint is not None:
                checkpoint()
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
            if checkpoint is not None:
                checkpoint()
    except BaseException:
        # Keep the original callback/decode exception even if cleanup also fails.
        try:
            close = getattr(blocks, "close", None)
            if close is not None:
                close()
        except BaseException:
            pass
        raise
    else:
        close = getattr(blocks, "close", None)
        if close is not None:
            close()
    if checkpoint is not None:
        checkpoint()
    if wave_count:
        peaks.append(wave_peak / FULL_SCALE)
    validate_frame_count(frames, info)
    # Advisory only: decode success does not establish Ogg finalization.
    ogg_flag = ending_advisory(path, checkpoint=checkpoint)
    mp3_flag = frame_count_advisory(path, checkpoint=checkpoint)
    mp4_flag = container_extent_advisory(path, checkpoint=checkpoint)
    mp4_samples_flag = indexed_audio_bytes_advisory(path, checkpoint=checkpoint)
    if fingerprint(path) != before:
        raise AudioError("Source changed during analysis; rescan after the file is stable")
    if checkpoint is not None:
        checkpoint()
    # Metadata alone misses same-size replacements with restored timestamps.
    # Reuse bounded, cancellable hashing; read failures and cancellation propagate.
    after_digest = (file_sha256(path) if checkpoint is None
                    else file_sha256(path, checkpoint=checkpoint))
    if after_digest != digest or fingerprint(path) != before:
        raise AudioError("Source changed during analysis; rescan after the file is stable")
    if checkpoint is not None:
        checkpoint()
    rms = math.sqrt(square_sum / count)
    rms_db = max(-120.0, 20 * math.log10(max(rms, 1e-6)))
    flags = [flag for flag in (ogg_flag, mp3_flag, mp4_flag, mp4_samples_flag) if flag]
    if rms_db <= -60:
        flags.append("silence_or_very_quiet")
    if near_clip:
        flags.append("near_full_scale")
    if channels > 2:
        flags.append("multichannel")
    hop = max(1, math.ceil(len(peaks) / 512))
    waveform = [round(max(peaks[i:i + hop]), 6) for i in range(0, len(peaks), hop)]
    if checkpoint is not None:
        checkpoint()
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
    # Each writer owns its stage, including across Workspace instances/processes.
    # Keep it beside the target so publication is a same-filesystem replacement.
    stage = tempfile.NamedTemporaryFile(prefix=f".{target.name}.", suffix=".tmp",
                                        dir=target.parent, delete=False)
    temporary = Path(stage.name)
    try:
        frames = 0
        with stage:
            with wave.open(stage, "wb") as out:
                out.setparams((info["channels"], 2, info["sample_rate"], 0, "NONE", "not compressed"))
                for raw in decoder.blocks(source, info):
                    if len(raw) % (4 * info["channels"]):
                        raise AudioError("Truncated decoded PCM frame")
                    frames += len(raw) // (4 * info["channels"])
                    values = array.array("h", (max(-32768, min(32767, round(sample / 65536 * gain)))
                                              for sample in integers(raw)))
                    if sys.byteorder != "little":
                        values.byteswap()
                    out.writeframesraw(values.tobytes())
        validate_frame_count(frames, info)
        if file_sha256(source) != expected_sha:
            raise AudioError("Source changed while preparing preview")
        try:
            temporary.replace(target)
        except OSError:
            # Windows can refuse to replace a winner already open for playback.
            # Existence alone is not proof of success. Compare complete bytes,
            # without filecmp's metadata cache, and retain the publication error
            # if either file disappeared/is unreadable (including ambiguous moves).
            identical = False
            try:
                with temporary.open("rb") as ours, target.open("rb") as winner:
                    while True:
                        block = ours.read(1024 * 1024)
                        if block != winner.read(1024 * 1024):
                            break
                        if not block:
                            identical = True
                            break
                if identical:
                    identical = file_sha256(source) == expected_sha
            except OSError:
                identical = False
            if not identical:
                raise
    finally:
        # Never remove the final output or another invocation's stage. Cleanup
        # failure must not mask a decode/publication error or negate success.
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            try:
                logging.getLogger(__name__).warning(
                    "Could not remove preview staging file %s; it may need manual cleanup",
                    temporary)
            except Exception:
                # A custom logging handler must not turn cleanup into a failure.
                pass
