"""Independent byte-address fixtures; all media is generated in temporary dirs."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from audio_review_desk import mp4_samples as mp
from audio_review_desk.audio import AudioError, analyze
from audio_review_desk.demo import write_wav
from audio_review_desk.mp4 import container_extent_advisory
from audio_review_desk.workspace import ImportCancelled, Workspace


def u32(*values):
    return struct.pack('>' + 'I' * len(values), *values)


def box(kind, data=b'', extended=False):
    return (u32(1) + kind + struct.pack('>Q', len(data) + 16) if extended else u32(len(data) + 8) + kind) + data


def descriptor(tag, data):
    assert len(data) < 128
    return bytes((tag, len(data))) + data


def fixture(*, overrides=None, extra=None, offsets=None, fixed=False, co64=False,
            extended=False, zero=False, missing=False, edits=True, groups=True):
    overrides, extra = overrides or {}, extra or {}
    def leaf(kind, data):
        return overrides.get(kind, box(kind, data, extended))
    def container(kind, data):
        return leaf(kind, data + extra.get(kind, b''))
    sizes = [4, 4, 4] if fixed else [3, 4, 5]
    config = descriptor(5, b'\x11\x88')
    es = descriptor(3, b'\x00\x01\x00' + descriptor(4, b'\x40\x15' + bytes(11) + config) + descriptor(6, b'\x02'))
    entry = bytes(6) + b'\0\1' + bytes(8) + b'\0\1\0\x10' + bytes(4) + u32(48000 << 16)
    stsd = leaf(b'stsd', bytes(4) + u32(1) + leaf(b'mp4a', entry + leaf(b'esds', bytes(4) + es)))
    def moov(locations):
        offsets_box = leaf(b'co64', bytes(4) + u32(2) + struct.pack('>QQ', *locations)) if co64 else leaf(b'stco', bytes(4) + u32(2) + u32(*locations))
        group_boxes = (leaf(b'sgpd', b'\1\0\0\0roll' + u32(2, 1) + b'\xff\xff') + leaf(b'sbgp', bytes(4) + b'roll' + u32(1, 3, 1))) if groups else b''
        stbl = container(b'stbl', stsd + leaf(b'stts', bytes(4) + u32(1, 3, 1024)) + leaf(b'stsc', bytes(4) + u32(2, 1, 2, 1, 2, 1, 1)) + leaf(b'stsz', bytes(4) + u32(4 if fixed else 0, 3) + (b'' if fixed else u32(*sizes))) + offsets_box + group_boxes)
        dinf = container(b'dinf', leaf(b'dref', bytes(4) + u32(1) + leaf(b'url ', b'\0\0\0\1')))
        minf = container(b'minf', leaf(b'smhd', bytes(8)) + dinf + stbl)
        mdia = container(b'mdia', leaf(b'mdhd', bytes(24)) + leaf(b'hdlr', bytes(8) + b'soun' + bytes(12)) + minf)
        edts = container(b'edts', leaf(b'elst', bytes(4) + u32(1, 123, 1024, 65536))) if edits else b''
        trak = container(b'trak', leaf(b'tkhd', bytes(84)) + edts + mdia)
        return container(b'moov', leaf(b'mvhd', bytes(100)) + trak)
    ftyp = leaf(b'ftyp', b'M4A ' + bytes(4) + b'isom')
    first_data = b'A' * sum(sizes[:2])
    second_data = b'B' * sizes[2]
    padding = box(b'free', b'gap')
    header = 16 if extended else 8
    first = len(ftyp) + len(moov((0, 0))) + header
    second = first + len(first_data) + len(padding) + header
    locations = offsets or (first, second)
    if missing:
        locations = (first, second + 50)
    last = box(b'mdat', second_data, extended)
    if zero:
        last = bytes(4) + b'mdat' + second_data
        # The second payload starts eight bytes earlier for a size0 header.
        if extended and offsets is None and not missing:
            locations = (first, second - 8)
    return ftyp + moov(locations) + box(b'mdat', first_data, extended) + padding + last + extra.get(b'top', b'')


class SampleTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'generated.m4a'

    def result(self, raw):
        self.path.write_bytes(raw)
        before = self.path.read_bytes()
        result = mp._assess(self.path)
        self.assertEqual(self.path.read_bytes(), before)
        return result

    def test_supported_present_and_missing_all_representations(self):
        for fixed in (False, True):
            for co64 in (False, True):
                for extended in (False, True):
                    for zero in (False, True):
                        with self.subTest(fixed=fixed, co64=co64, extended=extended, zero=zero):
                            options = dict(fixed=fixed, co64=co64, extended=extended, zero=zero)
                            self.assertEqual(self.result(fixture(**options)), mp.PRESENT)
                            self.assertEqual(self.result(fixture(**options, missing=True)), mp.UNAVAILABLE)
        self.assertEqual(self.result(fixture(groups=False, edits=False)), mp.PRESENT)

    def test_intervals_not_just_eof(self):
        raw = fixture()
        first = raw.index(b'mdat') + 4
        second = raw.rindex(b'mdat') + 4
        for offsets in ((0, second), (first - 1, second), (first + 1, second), (first, second + 1)):
            self.assertEqual(self.result(fixture(offsets=offsets)), mp.UNAVAILABLE)
        # Neither chunk ordering nor presentation timing is used as a shortcut.
        self.assertEqual(self.result(fixture(fixed=True, offsets=(second, first))), mp.UNAVAILABLE)
        self.assertEqual(self.result(fixture(co64=True, offsets=(2**64 - 1, second))), mp.UNAVAILABLE)

    def test_unknown_and_malformed_never_overrides_apparent_missing_bytes(self):
        bad = {
            b'stsz': [bytes(4) + u32(0, 3, 3, 0, 5), bytes(4) + u32(0, 4, 3, 4, 5), b'\1' + bytes(3) + u32(4, 3)],
            b'stco': [bytes(4) + u32(3, 9999, 9999), b'\1' + bytes(3) + u32(2, 9999, 9999)],
            b'stsc': [bytes(4) + u32(2, 1, 2, 1, first, n, description) for first, n, description in [(1, 1, 1), (0, 1, 1), (3, 1, 1), (2, 0, 1), (2, 1, 2), (2, 2, 1)]] + [bytes(4) + u32(1, 2, 3, 1), bytes(4) + u32(1, 1, 2, 1)],
            b'stts': [bytes(4) + u32(1, 2, 1024), b'\1' + bytes(3) + u32(1, 3, 1024)],
            b'url ': [bytes(4), b'\0\0\0\1url', b'\1\0\0\1'],
            b'dref': [bytes(4) + u32(2) + box(b'url ', b'\0\0\0\1')],
            b'stsd': [bytes(4) + u32(2)],
            b'mp4a': [bytes(6) + b'\0\2' + bytes(20), bytes(8) + b'\0\1' + bytes(18)],
            b'esds': [bytes(4) + b'\3\x80\x80\x80\x80\0', bytes(4) + descriptor(3, bytes(3))],
            b'sgpd': [b'\1\0\0\0seig' + u32(2, 1) + b'\xff\xff', b'\2\0\0\0roll' + u32(2, 1) + b'\xff\xff'],
            b'sbgp': [bytes(4) + b'roll' + u32(1, 3, 2), bytes(4) + b'roll' + u32(1, 2, 1)],
            b'elst': [b'\2\0\0\0' + u32(0), bytes(4) + u32(1)],
            b'hdlr': [bytes(8) + b'vide' + bytes(12)],
        }
        for kind, cases in bad.items():
            for data in cases:
                with self.subTest(kind=kind, data=data.hex()):
                    self.assertEqual(self.result(fixture(missing=True, overrides={kind: box(kind, data)})), mp.UNASSESSED)
        for parent, kind in [(b'top', b'moof'), (b'top', b'sidx'), (b'moov', b'mvex'), (b'moov', b'cmov'), (b'moov', b'trak'), (b'stbl', b'stz2'), (b'stbl', b'co64'), (b'stbl', b'stco'), (b'stbl', b'saio'), (b'stbl', b'saiz'), (b'stbl', b'xxxx'), (b'minf', b'xxxx')]:
            with self.subTest(parent=parent, kind=kind):
                self.assertEqual(self.result(fixture(missing=True, extra={parent: box(kind)})), mp.UNASSESSED)
        for raw in (b'', b'not mp4', fixture()[:-1], fixture(missing=True) + b'trailer'):
            self.assertEqual(self.result(raw), mp.UNASSESSED)

    def test_esds_and_asc_supported_shapes_and_unsupported_combinations(self):
        def esds(asc=b'\x11\x88', oti=0x40, stream=0x15, flags=0, sl=b'\x02'):
            config = descriptor(4, bytes((oti, stream)) + bytes(11) + descriptor(5, asc))
            es = descriptor(3, bytes((0, 1, flags)) + config + descriptor(6, sl))
            return box(b'esds', bytes(4) + es)
        for asc in (b'\x11\x88', b'\x11\x88\x56\xe5\x00'):
            self.assertEqual(self.result(fixture(overrides={b'esds': esds(asc)})), mp.PRESENT)
        cases = [esds(b''), esds(b'\x11'), esds(b'\x11\x88\0'),
                 esds(b'\x11\x88\x56\xe5\x01'), esds(b'\x29\x88'),
                 esds(b'\x16\x88'), esds(b'\x11\x80'), esds(b'\x11\x89'),
                 esds(b'\x11\x90'), esds(oti=0x66), esds(stream=0x11),
                 esds(flags=0x80), esds(sl=b'\x01')]
        for data in cases:
            with self.subTest(data=data.hex()):
                self.assertEqual(self.result(fixture(missing=True, overrides={b'esds': data})), mp.UNASSESSED)
        raw = fixture(missing=True)
        # Encrypted sample-entry tag, unknown child and trailing descriptor bytes.
        self.assertEqual(self.result(raw.replace(b'mp4a', b'enca', 1)), mp.UNASSESSED)
        self.assertEqual(self.result(raw.replace(b'esds', b'sinf', 1)), mp.UNASSESSED)
        self.assertEqual(self.result(fixture(missing=True, overrides={b'esds': esds()[:-1]})), mp.UNASSESSED)

    def test_descriptor_lengths_extensions_brands_and_no_group_mapping(self):
        def d4(tag, data):
            return bytes((tag, 0x80, 0x80, 0x80, len(data))) + data
        config = d4(4, b'\x40\x15' + bytes(11) + d4(5, b'\x11\x88'))
        es = d4(3, bytes((0, 1, 0)) + config + d4(6, b'\x02'))
        valid = bytes(4) + es
        self.assertEqual(self.result(fixture(overrides={b'esds': box(b'esds', valid)})), mp.PRESENT)
        for data in (valid + b'\0', valid[:-1], bytes(4) + b'\3\x80\x80\x80\x80\x01', bytes(4) + b'\3\x80'):
            self.assertEqual(self.result(fixture(missing=True, overrides={b'esds': box(b'esds', data)})), mp.UNASSESSED)
        raw = fixture()
        start = raw.index(b'mp4a') - 4; end = start + int.from_bytes(raw[start:start + 4], 'big')
        unknown_entry = box(b'mp4a', raw[start + 8:end] + box(b'xxxx'))
        self.assertEqual(self.result(fixture(missing=True, overrides={b'mp4a': unknown_entry})), mp.UNASSESSED)
        qt = box(b'ftyp', b'M4A ' + bytes(4) + b'qt  ')
        self.assertEqual(self.result(fixture(missing=True, overrides={b'ftyp': qt})), mp.UNASSESSED)
        no_group = box(b'sbgp', bytes(4) + b'roll' + u32(1, 3, 0))
        self.assertEqual(self.result(fixture(overrides={b'sbgp': no_group})), mp.PRESENT)
        for tag in (b'sgpd', b'sbgp'):
            self.assertEqual(self.result(fixture(missing=True, overrides={tag: b''})), mp.UNASSESSED)

    def test_nonmonotonic_chunks_and_exact_resource_boundaries(self):
        raw = fixture()
        first, second = raw.index(b'mdat') + 4, raw.rindex(b'mdat') + 4
        # Both independently located payloads hold four bytes: reverse chunk order.
        sizes = box(b'stsz', bytes(4) + u32(0, 3, 2, 2, 4))
        self.assertEqual(self.result(fixture(offsets=(second, first), overrides={b'stsz': sizes})), mp.PRESENT)
        moov = raw.index(b'moov') - 4
        payload_size = int.from_bytes(raw[moov:moov + 4], 'big') - 8
        with patch.object(mp, 'MAX_METADATA', payload_size):
            self.assertEqual(self.result(raw), mp.PRESENT)
        with patch.object(mp, 'MAX_METADATA', payload_size - 1):
            self.assertEqual(self.result(fixture(missing=True)), mp.UNASSESSED)
        calls = []
        native = mp._Reader.box
        def count(reader):
            native(reader); calls.append(reader.box_count)
        with patch.object(mp._Reader, 'box', count):
            self.assertEqual(self.result(raw), mp.PRESENT)
        with patch.object(mp, 'MAX_BOXES', max(calls)):
            self.assertEqual(self.result(raw), mp.PRESENT)
        with patch.object(mp, 'MAX_BOXES', max(calls) - 1):
            self.assertEqual(self.result(fixture(missing=True)), mp.UNASSESSED)

    def test_late_table_failure_beats_first_chunk_missing(self):
        # First chunk points beyond EOF; the last stsc run or group is invalid.
        for overrides in (
                {b'stsc': box(b'stsc', bytes(4) + u32(2, 1, 2, 1, 2, 1, 2))},
                {b'sbgp': box(b'sbgp', bytes(4) + b'roll' + u32(1, 3, 2))}):
            self.assertEqual(self.result(fixture(offsets=(999999, 999999), overrides=overrides)), mp.UNASSESSED)
        self.path.write_bytes(fixture())
        original = mp._tables
        validated = False
        class Cancelled(Exception): pass
        def tables(*args):
            nonlocal validated
            result = original(*args); validated = True; return result
        def checkpoint():
            if validated: raise Cancelled()
        with patch.object(mp, '_tables', tables):
            with self.assertRaises(Cancelled): mp._assess(self.path, checkpoint)

    def test_resource_caps_and_no_early_positive_verdict(self):
        for name, value in [('MAX_METADATA', 1), ('MAX_BOXES', 2), ('MAX_SAMPLES', 2), ('MAX_CHUNKS', 1), ('MAX_ROWS', 1)]:
            with self.subTest(cap=name), patch.object(mp, name, value):
                self.assertEqual(self.result(fixture(missing=True)), mp.UNASSESSED)
        with patch.object(mp, 'MAX_SAMPLES', 3), patch.object(mp, 'MAX_CHUNKS', 2):
            self.assertEqual(self.result(fixture()), mp.PRESENT)

    def test_cancellation_and_read_errors_propagate(self):
        self.path.write_bytes(fixture())
        class Cancelled(Exception): pass
        for at in (1, 5, 15, 35):
            count = 0
            def checkpoint():
                nonlocal count
                count += 1
                if count == at: raise Cancelled()
            with self.assertRaises(Cancelled): mp._assess(self.path, checkpoint)
        with patch.object(Path, 'open', side_effect=PermissionError('refused')):
            with self.assertRaises(PermissionError): mp._assess(self.path)

    def test_sparse_payload_is_not_read(self):
        raw = fixture()
        with self.path.open('wb') as stream:
            stream.write(raw)
            stream.write(u32(1024**3) + b'mdat')
            stream.seek(len(raw) + 1024**3 - 1)
            stream.write(b'\0')
        native = Path.open
        reads = []
        class Tracked:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): return self
            def __exit__(self, *args): self.stream.close()
            def fileno(self): return self.stream.fileno()
            def seek(self, *args): return self.stream.seek(*args)
            def read(self, n): reads.append(n); return self.stream.read(n)
        with patch.object(Path, 'open', lambda path, *a, **kw: Tracked(native(path, *a, **kw))):
            self.assertEqual(mp._assess(self.path), mp.PRESENT)
        self.assertLess(sum(reads), 2000)

    def test_final_hash_and_catalog_cancellation_still_apply(self):
        self.path.write_bytes(fixture())
        before = self.path.stat()
        class Decoder:
            def info(self, path): return dict(sample_rate=16000, channels=1, expected_frames=1, backend='fake')
            def blocks(self, path, info): yield struct.pack('<i', 12345678)
        def mutate(path, **kw):
            result = mp.indexed_audio_bytes_advisory(path, **kw)
            raw = bytearray(path.read_bytes()); raw[-1] ^= 1; path.write_bytes(raw)
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
            return result
        with patch('audio_review_desk.audio.indexed_audio_bytes_advisory', mutate):
            with self.assertRaisesRegex(AudioError, 'Source changed'): analyze(self.path, Decoder())
        wav = self.path.parent / 'audio/tone.wav'; write_wav(wav, seconds=.1)
        workspace = Workspace(self.path.parent / 'workspace'); workspace.scan(wav.parent)
        old = workspace.state(); event = threading.Event()
        def cancel(path, checkpoint=None): event.set(); checkpoint()
        with patch('audio_review_desk.audio.indexed_audio_bytes_advisory', cancel):
            with self.assertRaises(ImportCancelled): workspace.scan(wav.parent, cancelled=event)
        self.assertEqual(workspace.state(), old)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Optional installed codecs unavailable')
class ProducerTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.wav = self.root / 'tone.wav'; write_wav(self.wav, seconds=2, rate=48000)

    def produce(self, name, options):
        path = self.root / name
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(self.wav), '-c:a', 'aac', *options, str(path)], check=True, capture_output=True, timeout=15)
        return path

    def test_real_supported_and_fragmented_exclusions(self):
        for i, options in enumerate(([], ['-movflags', '+faststart'], ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000'], ['-movflags', '+frag_keyframe', '-frag_duration', '500000'])):
            path = self.produce(f'{i}.m4a', options)
            self.assertEqual(mp._assess(path), mp.PRESENT if i < 2 else mp.UNASSESSED)

    def test_real_midpoint_packet_cut_and_complete_zero_sized_mdat(self):
        full = self.produce('midpoint.m4a', ['-movflags', '+faststart'])
        raw = full.read_bytes()
        packets = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pos,size', '-of', 'json', str(full)], timeout=15))['packets']
        mdat = raw.index(b'mdat') - 4
        full.write_bytes(raw[:mdat] + bytes(4) + raw[mdat + 4:])
        self.assertEqual(mp._assess(full), mp.PRESENT)
        end = int(packets[len(packets) // 2]['pos'])
        deficit = sum(int(p['pos']) + int(p['size']) > end for p in packets)
        self.assertGreater(deficit, 1)
        for size in (0, end - mdat):
            full.write_bytes(raw[:mdat] + u32(size) + raw[mdat + 4:end])
            self.assertIsNone(container_extent_advisory(full))
            self.assertEqual(mp._assess(full), mp.UNAVAILABLE)
            quality = analyze(full)
            self.assertTrue(quality['decoded'])
            self.assertIn(mp.INDEXED_BYTES_UNAVAILABLE, quality['flags'])

    def test_real_packet_cut_zero_and_rewritten_mdat_both_sides(self):
        full = self.produce('full.m4a', ['-movflags', '+faststart'])
        raw = full.read_bytes()
        packets = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pos,size', '-of', 'json', str(full)], timeout=15))['packets']
        end = int(packets[-1]['pos']); self.assertEqual(end + int(packets[-1]['size']), len(raw))
        mdat = raw.index(b'mdat') - 4
        for zero in (True, False):
            cut = raw[:mdat] + u32(0 if zero else end - mdat) + raw[mdat + 4:end]
            for side in ('a', 'b'):
                with self.subTest(zero=zero, side=side), tempfile.TemporaryDirectory() as d:
                    root = Path(d); (root/'audio').mkdir(); a, b = root/'audio/a.m4a', root/'audio/b.m4a'
                    a.write_bytes(cut if side == 'a' else raw); b.write_bytes(cut if side == 'b' else raw)
                    flagged = a if side == 'a' else b
                    self.assertIsNone(container_extent_advisory(flagged))
                    self.assertEqual(mp._assess(flagged), mp.UNAVAILABLE)
                    self.assertEqual(mp._assess(b if side == 'a' else a), mp.PRESENT)
                    source_hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in (a,b)]
                    workspace = Workspace(root/'workspace'); rows = [dict(id='pair', path=str(a), reference_path=str(b))]
                    with patch('audio_review_desk.audio.indexed_audio_bytes_advisory', return_value=None):
                        old = workspace.ingest(rows, root, kind='manifest')['items'][0]
                    workspace.save_review(old['key'], dict(status='pass', score=8, note='human', expected_version=0))
                    history = workspace.history(old['key']); columns = next(csv.reader(io.StringIO(workspace.export_csv())))
                    state = workspace.ingest(rows, root, kind='manifest'); item = state['items'][0]
                    self.assertEqual(item['key'], old['key']); self.assertEqual(item['review'], history[-1]); self.assertEqual(workspace.history(item['key']), history)
                    self.assertTrue(item['eligible']); self.assertEqual(state['stats']['warnings'], 1)
                    for variant, quality in [('a','quality'),('b','reference_quality')]:
                        self.assertTrue(item[quality]['decoded'])
                        self.assertEqual(mp.INDEXED_BYTES_UNAVAILABLE in item[quality]['flags'], variant == side)
                        self.assertTrue(workspace.preview(item['key'], variant).is_file())
                        self.assertEqual(workspace.export()['items'][0][quality]['flags'], item[quality]['flags'])
                    self.assertEqual(next(csv.reader(io.StringIO(workspace.export_csv()))), columns)
                    self.assertAlmostEqual(state['stats']['human_approved_seconds'], item['quality']['duration'])
                    self.assertEqual([hashlib.sha256(p.read_bytes()).hexdigest() for p in (a,b)], source_hashes)
