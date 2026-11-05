"""Bounded top-level MP4 extent advisory, not a media integrity validator.

Apple QTFF Atoms describes size/extended-size/EOF semantics. W3C's ISO BMFF
byte-stream note is MSE-specific; its ordering/sample rules are NOT applied.
Only an explicit top-level extent beyond available bytes is reported.
"""
import os
from pathlib import Path
from typing import Callable

EXTENT_EXCEEDS_FILE = "mp4_extent_exceeds_file"
CHECK_INCOMPLETE = "mp4_check_incomplete"
MAX_BOXES = 4096
MAX_FTYP_BYTES = 4096
MAJOR_BRANDS = frozenset((b'isom', b'iso2', b'mp41', b'mp42', b'M4A ', b'M4B '))


def container_extent_advisory(path: Path, *, checkpoint: Callable[[], None] | None = None) -> str | None:
    """None means unassessed OR no observed discrepancy, never completeness.

    Require a complete, explicitly sized ftyp at offset zero with a recognized
    major brand and structurally aligned compatible brands. Skip all payloads,
    including moov/moof/sample tables. Size zero consumes EOF, not a promised
    recording length. No extension-based detection or resynchronization.
    analyze() owns before/after source hashes; I/O/callback errors propagate.
    """
    def check():
        if checkpoint is not None:
            checkpoint()

    check()
    with path.open('rb') as source:
        available = os.fstat(source.fileno()).st_size
        position = boxes = 0
        recognized = False
        while position < available:
            check()
            if boxes >= MAX_BOXES:
                return CHECK_INCOMPLETE if recognized else None
            source.seek(position)
            header = source.read(8)
            check()
            if len(header) != 8:
                return CHECK_INCOMPLETE if recognized else None
            size = int.from_bytes(header[:4], 'big')
            kind = header[4:8]
            header_size = 8
            if not recognized and (kind != b'ftyp' or size == 0):
                return None
            if size == 1:
                extended = source.read(8)
                check()
                if len(extended) != 8:
                    return CHECK_INCOMPLETE if recognized else None
                size = int.from_bytes(extended, 'big')
                header_size = 16
            # uuid carries a 16-byte user type in addition to the size/type.
            minimum = header_size + (16 if kind == b'uuid' else 0)
            if kind == b'uuid':
                user_type = source.read(16)
                check()
                if len(user_type) != 16:
                    return CHECK_INCOMPLETE if recognized else None
            if size == 0 and header_size == 8:
                return CHECK_INCOMPLETE if available - position < minimum else None
            if size < minimum:
                return CHECK_INCOMPLETE if recognized else None
            # Compare before adding/seeking: no platform offset overflow, even
            # for uint64 max. Python integers do not wrap.
            if size > available - position:
                return EXTENT_EXCEEDS_FILE if recognized else None
            if not recognized:
                payload_size = size - header_size
                if size > MAX_FTYP_BYTES or payload_size < 8 or payload_size % 4:
                    return None
                payload = source.read(payload_size)
                check()
                if len(payload) != payload_size or payload[:4] not in MAJOR_BRANDS:
                    return None
                recognized = True
            position += size
            boxes += 1
        return None
