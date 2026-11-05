"""Narrow Xing/Info frame-count advisory, not an MP3 integrity validator.

Producer convention: LAME libmp3lame/VbrTag.c and FFmpeg libavformat/mp3dec.c:
count excludes the metadata frame, bytes includes it, and LAME's CRC protection
keeps the Xing offset unchanged. This is not a universal MPEG guarantee.
"""
from pathlib import Path
from typing import Callable

COUNT_DIFFERS = "mp3_frame_count_differs"
CHECK_INCOMPLETE = "mp3_check_incomplete"
MAX_BYTES = 16 * 1024 * 1024
MAX_FRAMES = 100_000


def _header(raw: bytes):
    if len(raw) != 4:
        return None
    h = int.from_bytes(raw, 'big')
    version, layer, bitrate, rate = (h >> 19) & 3, (h >> 17) & 3, (h >> 12) & 15, (h >> 10) & 3
    if h >> 21 != 0x7ff or version == 1 or layer != 1 or bitrate in (0, 15) or rate == 3 or h & 3 == 2:
        return None
    hz = (44100, 48000, 32000)[rate] // {3: 1, 2: 2, 0: 4}[version]
    rates = ((0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320) if version == 3
             else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160))
    size = (144000 if version == 3 else 72000) * rates[bitrate] // hz + ((h >> 9) & 1)
    mono = (h >> 6) & 3 == 3
    offset = 4 + ((17 if mono else 32) if version == 3 else (9 if mono else 17))
    return size, (version, hz, mono), offset


def frame_count_advisory(path: Path, *, checkpoint: Callable[[], None] | None = None) -> str | None:
    """No flag means no discrepancy found OR not checked, never completeness.

    Missing/zero counts and unsupported initial layouts are silently not checked.
    Once a positive Xing/Info count is recognized, ambiguous framing yields a
    neutral incomplete-check flag. Bounded sequential reads, no resync, no PCM
    duration comparison, no CRC/bit-reservoir validation. analyze() owns source
    consistency checks; callback exceptions and I/O failures propagate.
    """
    def check():
        if checkpoint is not None:
            checkpoint()

    check()
    with path.open('rb') as source:
        lead = source.read(10)
        check()
        start = 0
        if lead[:3] == b'ID3':
            if (len(lead) != 10 or lead[3] not in (3, 4) or lead[4] != 0
                    or lead[5] & ~(0xe0 if lead[3] == 3 else 0xf0)
                    or any(byte & 0x80 for byte in lead[6:10])):
                return None
            size = sum(byte << shift for byte, shift in zip(lead[6:10], (21, 14, 7, 0)))
            footer = lead[3] == 4 and bool(lead[5] & 0x10)
            start = 10 + size + (10 if footer else 0)
            if start > MAX_BYTES:
                return None
            if footer:
                source.seek(10 + size)
                if source.read(10) != b'3DI' + lead[3:]:
                    return None
                check()
        source.seek(start)
        position, frames, expected, layout = start, 0, None, None
        while True:
            check()
            if frames >= MAX_FRAMES or position + 4 > MAX_BYTES:
                return CHECK_INCOMPLETE if expected is not None else None
            header = source.read(4)
            check()
            if not header:
                if expected is None:
                    return None
                return COUNT_DIFFERS if frames - 1 != expected else None
            parsed = _header(header)
            if parsed is None or not header[1] & 1:
                return CHECK_INCOMPLETE if expected is not None else None
            size, current, offset = parsed
            if position + size > MAX_BYTES or (frames == 0 and size < offset + 4):
                return CHECK_INCOMPLETE if expected is not None else None
            body = source.read(size - 4)
            check()
            if len(body) != size - 4:
                return CHECK_INCOMPLETE if expected is not None else None
            frame = header + body
            tag = frame[offset:offset + 4]
            if frames == 0:
                if tag not in (b'Xing', b'Info') or offset + 12 > size:
                    return None
                flags = int.from_bytes(frame[offset + 4:offset + 8], 'big')
                count = int.from_bytes(frame[offset + 8:offset + 12], 'big')
                if not flags & 1 or not count:
                    return None
                expected = count
                # Require the full flagged header to fit the metadata frame.
                extent = offset + 8 + sum(length for bit, length in ((1, 4), (2, 4), (4, 100), (8, 4)) if flags & bit)
                if flags & ~15 or extent > size:
                    return CHECK_INCOMPLETE
                layout = current
            elif current != layout or tag in (b'Xing', b'Info') or frame[36:40] == b'VBRI':
                return CHECK_INCOMPLETE
            frames += 1
            position += size
