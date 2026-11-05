"""Conservative Ogg framing advisory, never a codec/completeness verdict.

RFC 3533 sections 4/6, RFC 7845 section 3, and Xiph's framing document.
Reads one page at a time; no packet assembly or resynchronization. Unknown or
inconsistent framing is deliberately distinct from a reliably absent EOS.
"""
import binascii
from pathlib import Path
from typing import Callable

ENDING_UNCONFIRMED = "ogg_ending_unconfirmed"
CHECK_INCOMPLETE = "ogg_check_incomplete"
MAX_BYTES = 16 * 1024 * 1024
MAX_PAGES = 100_000
MAX_SERIALS = 4096  # Bound even adversarial chains; exceeding this is unknown.


# Reversal conjugates the reflected IEEE recurrence used by binascii into
# Ogg's direct recurrence (polynomial 0x04C11DB7). Translate runs in C and
# allocates only one page-sized buffer, never an entire file/packet.
_REVERSE_BYTE = bytes(int(f"{byte:08b}"[::-1], 2) for byte in range(256))


def page_crc(page: bytes) -> int:
    """Ogg direct CRC, NOT ordinary IEEE/zlib CRC; checksum bytes must be zero.

    R32(crc32(R8(page), 0xffffffff) XOR 0xffffffff) has Ogg's zero initial
    register and zero final XOR. Reversing every input byte and all output
    bits converts the reflected recurrence into the non-reflected one.
    """
    reflected = binascii.crc32(page.translate(_REVERSE_BYTE), 0xFFFFFFFF) ^ 0xFFFFFFFF
    return int.from_bytes(reflected.to_bytes(4, "little").translate(_REVERSE_BYTE), "big")


def ending_advisory(path: Path, *, checkpoint: Callable[[], None] | None = None) -> str | None:
    """None means no advisory, NOT that the original recording is complete.

    All observed logical streams must have consistent version-0 framing before
    missing EOS can be reported. Partial pages, loss, malformed/unsupported
    layouts and caps instead yield CHECK_INCOMPLETE. Live captures may lack EOS.
    No codec packets/granule positions are interpreted. Source consistency is
    owned by analyze()'s enclosing hash checks, not this standalone reader.
    """
    def check():
        if checkpoint is not None:
            checkpoint()

    check()
    # Retain all serials to reject reuse across chains, with a hard memory cap.
    streams: dict[int, tuple[int, bool, bool]] = {}  # sequence, pending packet, EOS
    active = 0
    bytes_read = pages = 0
    bos_phase = True
    with path.open("rb") as source:
        while True:
            check()
            if pages >= MAX_PAGES or bytes_read + 27 > MAX_BYTES:
                return CHECK_INCOMPLETE
            header = source.read(27)
            check()
            if not header:
                if not streams:
                    return CHECK_INCOMPLETE if path.suffix.lower() in {".ogg", ".opus"} else None
                return ENDING_UNCONFIRMED if active else None
            if header[:4] != b"OggS":
                if not streams and path.suffix.lower() not in {".ogg", ".opus"}:
                    return None
                return CHECK_INCOMPLETE
            if len(header) != 27 or header[4] != 0 or header[5] & ~7:
                return CHECK_INCOMPLETE
            pages += 1
            bytes_read += 27
            if bytes_read + header[26] > MAX_BYTES:
                return CHECK_INCOMPLETE
            lacing = source.read(header[26])
            check()
            if len(lacing) != header[26]:
                return CHECK_INCOMPLETE
            bytes_read += len(lacing)
            if bytes_read + sum(lacing) > MAX_BYTES:
                return CHECK_INCOMPLETE
            bytes_read += sum(lacing)
            body = source.read(sum(lacing))  # At most 255 * 255 bytes.
            check()
            if len(body) != sum(lacing):
                return CHECK_INCOMPLETE
            expected = int.from_bytes(header[22:26], "little")
            page = header[:22] + bytes(4) + header[26:] + lacing + body
            if page_crc(page) != expected:
                return CHECK_INCOMPLETE
            check()
            serial = int.from_bytes(header[14:18], "little")
            sequence = int.from_bytes(header[18:22], "little")
            continued, bos, eos = (bool(header[5] & flag) for flag in (1, 2, 4))
            if bos:
                if serial in streams or len(streams) >= MAX_SERIALS:
                    return CHECK_INCOMPLETE
                if active == 0:
                    bos_phase = True  # A new chain may start only after all EOS.
                if not bos_phase or continued or sequence != 0:
                    return CHECK_INCOMPLETE
                previous_pending = False
                active += 1
            else:
                bos_phase = False
                previous = streams.get(serial)
                if previous is None or previous[2] or sequence != (previous[0] + 1) & 0xFFFFFFFF:
                    return CHECK_INCOMPLETE
                previous_pending = previous[1]
            if lacing:
                if continued != previous_pending:
                    return CHECK_INCOMPLETE
                pending = lacing[-1] == 255
            else:
                # Nil EOS pages are explicitly allowed by RFC 3533. Empty pages
                # amidst a continued packet have ambiguous continuation semantics
                # for this conservative checker; do not guess missing EOS.
                if continued or previous_pending:
                    return CHECK_INCOMPLETE
                pending = False
            if eos and pending:
                return CHECK_INCOMPLETE
            streams[serial] = sequence, pending, eos
            if eos:
                active -= 1
