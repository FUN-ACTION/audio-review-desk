"""Conservative indexed-byte advisory for a verified, narrow AAC-LC MP4 subset.

This is not a decoder, an ISO conformance check or a completeness certificate.
The supported producer/field evidence and exclusions are in docs/mp4-samples.md.
"""
from bisect import bisect_right
import os
from pathlib import Path
import struct
from typing import Callable

from .mp4 import MAJOR_BRANDS, MAX_FTYP_BYTES

INDEXED_BYTES_UNAVAILABLE = "mp4_indexed_audio_bytes_unavailable"
PRESENT = "assessed_present"
UNAVAILABLE = "indexed_bytes_unavailable"
UNASSESSED = "unassessed"
MAX_METADATA = 8 * 1024 * 1024
MAX_BOXES = 4096
MAX_SAMPLES = 1_000_000
MAX_CHUNKS = 100_000
MAX_ROWS = 100_000


class _Unsupported(Exception):
    pass


def _require(condition):
    if not condition:
        raise _Unsupported()


def _u32(data, offset=0):
    return struct.unpack_from('>I', data, offset)[0]


class _Reader:
    def __init__(self, checkpoint):
        self.checkpoint = checkpoint
        self.box_count = 0

    def check(self):
        if self.checkpoint is not None:
            self.checkpoint()

    def box(self):
        self.check()
        self.box_count += 1
        _require(self.box_count <= MAX_BOXES)

    def children(self, data, allowed):
        """Fixed-depth callers only. No resync, unknown boxes or nested size0."""
        result = {}
        offset = 0
        while offset < len(data):
            self.box()
            _require(len(data) - offset >= 8)
            size, kind = struct.unpack_from('>I4s', data, offset)
            header = 8
            if size == 1:
                _require(len(data) - offset >= 16)
                size = struct.unpack_from('>Q', data, offset + 8)[0]
                header = 16
            _require(size >= header and size <= len(data) - offset)
            _require(kind in allowed and kind not in result)
            result[kind] = data[offset + header:offset + size]
            offset += size
        return result

    def full(self, data, minimum=4, versions=(0,), flags=0):
        _require(len(data) >= minimum)
        _require(data[0] in versions and int.from_bytes(data[1:4], 'big') == flags)

    def table(self, data, width, maximum=None, prefix=8):
        self.full(data, prefix)
        count = _u32(data, prefix - 4)
        maximum = MAX_ROWS if maximum is None else maximum
        _require(count <= maximum and len(data) == prefix + count * width)
        return count

    def tick(self, index):
        if index % 1024 == 0:
            self.check()


def _descriptor(data, offset, tag):
    _require(offset < len(data) and data[offset] == tag)
    offset += 1
    size = 0
    for _ in range(4):
        _require(offset < len(data))
        value = data[offset]
        offset += 1
        size = (size << 7) | (value & 127)
        if not value & 128:
            _require(size <= len(data) - offset)
            return data[offset:offset + size], offset + size
    raise _Unsupported()


def _aac_description(reader, data):
    reader.full(data, 8)
    _require(_u32(data, 4) == 1)
    entries = reader.children(data[8:], {b'mp4a'})
    _require(set(entries) == {b'mp4a'})
    entry = entries[b'mp4a']
    _require(len(entry) >= 28)
    # Six reserved bytes, data reference index, then ISO version0 prefix.
    _require(bytes(entry[:8]) == bytes(6) + b'\x00\x01')
    _require(bytes(entry[8:16]) == bytes(8))
    _require(int.from_bytes(entry[16:18], 'big') > 0)
    _require(bytes(entry[18:24]) == b'\x00\x10' + bytes(4))
    _require(int.from_bytes(entry[24:26], 'big') > 0 and bytes(entry[26:28]) == bytes(2))
    extensions = reader.children(entry[28:], {b'esds', b'btrt'})
    _require(b'esds' in extensions)
    if b'btrt' in extensions:
        _require(len(extensions[b'btrt']) == 12)
    esds = extensions[b'esds']
    reader.full(esds, 5)
    es, end = _descriptor(esds, 4, 3)
    _require(end == len(esds) and len(es) >= 3 and es[2] == 0)
    config, end = _descriptor(es, 3, 4)
    _require(len(config) >= 13 and bytes(config[:2]) == b'\x40\x15')
    asc, config_end = _descriptor(config, 13, 5)
    _require(config_end == len(config))
    sl, es_end = _descriptor(es, end, 6)
    _require(es_end == len(es) and bytes(sl) == b'\x02')
    # Deliberately only simple AAC-LC, with no PCE/core coder/extension flags.
    # The optional exact suffix is the producer's explicit SBR-absent marker.
    _require(len(asc) == 2 or (len(asc) == 5 and bytes(asc[2:]) == b'\x56\xe5\x00'))
    bits = int.from_bytes(asc[:2], 'big')
    _require(bits >> 11 == 2 and ((bits >> 7) & 15) <= 12)
    channel_config = (bits >> 3) & 15
    _require(1 <= channel_config <= 7 and bits & 7 == 0)
    channels = channel_config if channel_config < 7 else 8
    _require(int.from_bytes(entry[16:18], 'big') == channels)


def _groups(reader, tables, samples):
    if not ({b'sgpd', b'sbgp'} & tables.keys()):
        return
    _require(b'sgpd' in tables and b'sbgp' in tables)
    group = tables[b'sgpd']
    reader.full(group, 16, versions=(1,))
    _require(bytes(group[4:8]) == b'roll' and _u32(group, 8) == 2)
    count = _u32(group, 12)
    _require(0 < count <= MAX_ROWS and len(group) == 16 + 2 * count)
    for i in range(count):
        reader.tick(i)
        _require(bytes(group[16 + i * 2:18 + i * 2]) == b'\xff\xff')
    mapping = tables[b'sbgp']
    reader.full(mapping, 12)
    _require(bytes(mapping[4:8]) == b'roll')
    rows = _u32(mapping, 8)
    _require(0 < rows <= MAX_ROWS and len(mapping) == 12 + rows * 8)
    total = 0
    for i in range(rows):
        reader.tick(i)
        n, index = struct.unpack_from('>II', mapping, 12 + i * 8)
        _require(n > 0 and index <= count)
        total += n
        _require(total <= samples)
    _require(total == samples)


def _tables(reader, moov):
    movie = reader.children(moov, {b'mvhd', b'trak', b'udta'})
    _require({b'mvhd', b'trak'} <= movie.keys())
    reader.full(movie[b'mvhd'], 4, versions=(0, 1))
    _require(len(movie[b'mvhd']) == (100 if movie[b'mvhd'][0] == 0 else 112))
    track = reader.children(movie[b'trak'], {b'tkhd', b'mdia', b'edts'})
    _require({b'tkhd', b'mdia'} <= track.keys())
    header = track[b'tkhd']
    _require(len(header) >= 4 and header[0] in (0, 1))
    _require(int.from_bytes(header[1:4], 'big') & ~7 == 0)
    _require(len(header) == (84 if header[0] == 0 else 96))
    if b'edts' in track:
        edits = reader.children(track[b'edts'], {b'elst'})
        _require(set(edits) == {b'elst'})
        edit = edits[b'elst']
        reader.full(edit, 8, versions=(0, 1))
        count = _u32(edit, 4)
        _require(count <= MAX_ROWS and len(edit) == 8 + count * (12 if edit[0] == 0 else 20))
        # Edits change presentation, not indexed byte locations. Do not compare
        # durations or discard indexed samples excluded by presentation edits.
    media = reader.children(track[b'mdia'], {b'mdhd', b'hdlr', b'minf'})
    _require(set(media) == {b'mdhd', b'hdlr', b'minf'})
    reader.full(media[b'mdhd'], 4, versions=(0, 1))
    _require(len(media[b'mdhd']) == (24 if media[b'mdhd'][0] == 0 else 36))
    handler = media[b'hdlr']
    reader.full(handler, 24)
    _require(bytes(handler[4:8]) == bytes(4) and bytes(handler[8:12]) == b'soun')
    info = reader.children(media[b'minf'], {b'smhd', b'dinf', b'stbl'})
    _require(set(info) == {b'smhd', b'dinf', b'stbl'})
    reader.full(info[b'smhd'], 8)
    _require(len(info[b'smhd']) == 8)
    refs = reader.children(info[b'dinf'], {b'dref'})
    _require(set(refs) == {b'dref'})
    ref = refs[b'dref']
    reader.full(ref, 8)
    _require(_u32(ref, 4) == 1)
    urls = reader.children(ref[8:], {b'url '})
    _require(set(urls) == {b'url '} and bytes(urls[b'url ']) == b'\0\0\0\1')
    tables = reader.children(info[b'stbl'], {b'stsd', b'stts', b'stsc', b'stsz', b'stco', b'co64', b'sgpd', b'sbgp'})
    _require({b'stsd', b'stts', b'stsc', b'stsz'} <= tables.keys())
    _require((b'stco' in tables) != (b'co64' in tables))
    _aac_description(reader, tables[b'stsd'])
    sizes = tables[b'stsz']
    reader.full(sizes, 12)
    fixed, samples = struct.unpack_from('>II', sizes, 4)
    _require(0 < samples <= MAX_SAMPLES)
    _require(len(sizes) == (12 if fixed else 12 + 4 * samples))
    if not fixed:
        for i in range(samples):
            reader.tick(i)
            _require(_u32(sizes, 12 + i * 4) > 0)
    offsets = tables.get(b'stco', tables.get(b'co64'))
    width = 4 if b'stco' in tables else 8
    chunks = reader.table(offsets, width, MAX_CHUNKS)
    _require(chunks > 0)
    runs = tables[b'stsc']
    rows = reader.table(runs, 12)
    _require(0 < rows <= chunks)
    total = 0
    previous = 0
    for i in range(rows):
        reader.tick(i)
        first, n, description = struct.unpack_from('>III', runs, 8 + i * 12)
        _require(previous < first <= chunks and n > 0 and description == 1)
        if i == 0:
            _require(first == 1)
        next_first = _u32(runs, 8 + (i + 1) * 12) if i + 1 < rows else chunks + 1
        _require(first < next_first <= chunks + 1)
        total += (next_first - first) * n
        _require(total <= samples)
        previous = first
    _require(total == samples)
    timing = tables[b'stts']
    count = reader.table(timing, 8)
    total = 0
    for i in range(count):
        reader.tick(i)
        n, delta = struct.unpack_from('>II', timing, 8 + i * 8)
        _require(n > 0 and delta > 0)
        total += n
        _require(total <= samples)
    _require(total == samples)
    _groups(reader, tables, samples)
    return sizes, fixed, samples, offsets, width, chunks, runs, rows


def _assess(path: Path, checkpoint: Callable[[], None] | None = None) -> str:
    reader = _Reader(checkpoint)
    reader.check()
    try:
        with path.open('rb') as source:
            available = os.fstat(source.fileno()).st_size
            position = 0
            movie = None
            extents = []
            recognized = False
            while position < available:
                reader.box()
                source.seek(position)
                header = source.read(8)
                reader.check()
                _require(len(header) == 8)
                size, kind = struct.unpack('>I4s', header)
                head = 8
                _require(kind in {b'ftyp', b'moov', b'mdat', b'free', b'skip'})
                if size == 1:
                    header = source.read(8)
                    reader.check()
                    _require(len(header) == 8)
                    size = struct.unpack('>Q', header)[0]
                    head = 16
                elif size == 0:
                    _require(kind == b'mdat' and recognized)
                    size = available - position
                _require(size >= head and size <= available - position)
                if not recognized:
                    _require(position == 0 and kind == b'ftyp' and head + 8 <= size <= MAX_FTYP_BYTES)
                    _require((size - head) % 4 == 0)
                    payload = source.read(size - head)
                    reader.check()
                    _require(len(payload) == size - head and payload[:4] in MAJOR_BRANDS)
                    # QuickTime-compatible interpretation is outside this subset.
                    _require(b'qt  ' not in [payload[i:i + 4] for i in range(8, len(payload), 4)])
                    recognized = True
                else:
                    _require(kind != b'ftyp')
                if kind == b'moov':
                    _require(movie is None and size - head <= MAX_METADATA)
                    movie = (position + head, size - head)
                elif kind == b'mdat':
                    extents.append((position + head, position + size))
                position += size
            _require(recognized and movie is not None and extents)
            source.seek(movie[0])
            metadata = bytearray()
            remaining = movie[1]
            while remaining:
                reader.check()
                block = source.read(min(65536, remaining))
                _require(block)
                metadata.extend(block)
                remaining -= len(block)
            reader.check()
            sizes, fixed, samples, offsets, width, chunks, runs, rows = _tables(reader, memoryview(metadata))
            # No missing-byte verdict before ALL supported structures validate.
            starts = [start for start, _ in extents]
            sample = run = 0
            missing = False
            for chunk in range(1, chunks + 1):
                reader.tick(chunk - 1)
                if run + 1 < rows and chunk == _u32(runs, 8 + (run + 1) * 12):
                    run += 1
                n = _u32(runs, 12 + run * 12)
                offset = int.from_bytes(offsets[8 + (chunk - 1) * width:8 + chunk * width], 'big')
                length = 0
                if fixed:
                    length = n * fixed
                else:
                    for i in range(n):
                        reader.tick(sample + i)
                        length += _u32(sizes, 12 + (sample + i) * 4)
                sample += n
                extent = bisect_right(starts, offset) - 1
                # Contiguous samples of a chunk must fit one mdat payload.
                if extent < 0 or offset + length > extents[extent][1]:
                    missing = True
            _require(sample == samples)
            reader.check()
            return UNAVAILABLE if missing else PRESENT
    except _Unsupported:
        return UNASSESSED


def indexed_audio_bytes_advisory(path: Path, *, checkpoint: Callable[[], None] | None = None) -> str | None:
    """None means no observed discrepancy OR unassessed, never completeness.

    The caller owns source stability hashing. I/O and cancellation propagate.
    """
    return INDEXED_BYTES_UNAVAILABLE if _assess(path, checkpoint) == UNAVAILABLE else None
