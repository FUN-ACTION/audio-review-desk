"""Synthetic top-level framing only; no claim of media/sample completeness."""
import csv
import io
import os
import shutil
import subprocess
import struct
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk import mp4
from audio_review_desk.audio import AudioError, analyze
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import ImportCancelled, Workspace, statistics


def box(kind, payload=b'', *, size=None, extended=False):
    length = len(payload) + (16 if extended else 8) if size is None else size
    return ((struct.pack('>I4sQ', 1, kind, length) if extended
             else struct.pack('>I4s', length, kind)) + payload)


def ftyp(brand=b'M4A ', *, extended=False):
    return box(b'ftyp', brand + bytes(4) + b'isommp42', extended=extended)


class ExtentTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'source.m4a'

    def result(self, raw):
        self.path.write_bytes(raw)
        return mp4.container_extent_advisory(self.path)

    def test_normal_fast_start_tail_moov_and_unknown_boxes(self):
        for sequence in [(b'moov', b'mdat'), (b'mdat', b'moov'), (b'free', b'ZZZZ', b'moov', b'mdat')]:
            raw = ftyp() + b''.join(box(kind, b'opaque') for kind in sequence)
            self.assertIsNone(self.result(raw))
        # A nested impossible extent is opaque, not interpreted at top level.
        self.assertIsNone(self.result(ftyp() + box(b'moov', box(b'mdat', size=999))))
        self.assertIsNone(self.result(ftyp()))  # NOT a recording-completeness claim.

    def test_explicit_extent_and_growing_snapshots(self):
        raw = ftyp() + box(b'mdat', b'abc', size=20)
        self.assertEqual(self.result(raw), mp4.EXTENT_EXCEEDS_FILE)
        self.assertIsNone(self.result(raw + bytes(9)))
        for size in (0xffffffff, 0x100000000, 0xffffffffffffffff):
            self.assertEqual(self.result(ftyp() + box(b'mdat', size=size, extended=True)), mp4.EXTENT_EXCEEDS_FILE)
        self.assertEqual(self.result(ftyp() + box(b'ZZZZ', size=100)), mp4.EXTENT_EXCEEDS_FILE)

    def test_size_zero_consumes_eof_without_resync(self):
        for kind in (b'mdat', b'free', b'moov'):
            self.assertIsNone(self.result(ftyp() + box(kind, box(b'mdat', size=999), size=0)))
        self.assertIsNone(self.result(ftyp() + box(b'mdat', size=0)))
        self.assertIsNone(self.result(ftyp() + box(b'uuid', bytes(16), size=0)))

    def test_extended_headers_and_uuid(self):
        self.assertIsNone(self.result(ftyp(extended=True) + box(b'mdat', b'a', extended=True)))
        for extended in (False, True):
            self.assertIsNone(self.result(ftyp() + box(b'uuid', bytes(16), extended=extended)))
            self.assertEqual(self.result(ftyp() + box(b'uuid', bytes(16), size=100, extended=extended)), mp4.EXTENT_EXCEEDS_FILE)
            self.assertEqual(self.result(ftyp() + box(b'uuid', bytes(15), size=100, extended=extended)), mp4.CHECK_INCOMPLETE)

    def test_partial_and_malformed_headers_are_neutral(self):
        for n in range(1, 8):
            self.assertEqual(self.result(ftyp() + box(b'mdat')[:n]), mp4.CHECK_INCOMPLETE)
        for n in range(8, 16):
            self.assertEqual(self.result(ftyp() + box(b'mdat', extended=True)[:n]), mp4.CHECK_INCOMPLETE)
        for size in range(2, 8):
            self.assertEqual(self.result(ftyp() + box(b'mdat', size=size)), mp4.CHECK_INCOMPLETE)
        for size in range(16):
            self.assertEqual(self.result(ftyp() + box(b'mdat', size=size, extended=True)), mp4.CHECK_INCOMPLETE)
        self.assertEqual(self.result(ftyp() + b'trailer'), mp4.CHECK_INCOMPLETE)

    def test_initial_unsupported_is_silent_even_with_mp4_extension(self):
        for raw in (b'', b'not an MP4', box(b'mdat', size=999), box(b'free') + ftyp(),
                    ftyp(b'qt  '), ftyp(b'avif'), ftyp(b'xxxx'),
                    box(b'ftyp', b'isom' + bytes(3)), box(b'ftyp', b'isom' + bytes(5)),
                    box(b'ftyp', b'isom' + bytes(4), size=999),
                    box(b'ftyp', b'isom' + bytes(4), size=0)):
            self.assertIsNone(self.result(raw))
        for brand in mp4.MAJOR_BRANDS:
            self.assertEqual(self.result(ftyp(brand) + box(b'mdat', size=999)), mp4.EXTENT_EXCEEDS_FILE)
        # A recognized compatible brand alone cannot override unknown major brand.
        self.assertIsNone(self.result(ftyp(b'xxxx') + box(b'mdat', size=999)))

    def test_fragmented_hybrid_and_missing_whole_boxes(self):
        raw = ftyp() + box(b'moov') + box(b'moof') + box(b'mdat', b'abc')
        self.assertIsNone(self.result(raw))
        self.assertIsNone(self.result(raw + box(b'moof') + box(b'mdat')))
        self.assertEqual(self.result(raw + box(b'mdat', size=99)), mp4.EXTENT_EXCEEDS_FILE)
        # Losing an entire last fragment leaves no declared overrun to detect.
        self.assertIsNone(self.result(ftyp() + box(b'moov')))

    def test_caps_exact_eof_and_cancellation(self):
        with patch.object(mp4, 'MAX_BOXES', 2):
            self.assertIsNone(self.result(ftyp() + box(b'mdat')))
            self.assertEqual(self.result(ftyp() + box(b'mdat') + box(b'free')), mp4.CHECK_INCOMPLETE)
        with patch.object(mp4, 'MAX_FTYP_BYTES', len(ftyp()) - 1):
            self.assertIsNone(self.result(ftyp() + box(b'mdat', size=999)))
        raw = ftyp() + box(b'mdat')
        self.path.write_bytes(raw)
        calls = 0
        class Cancelled(Exception):
            pass
        def check():
            nonlocal calls
            calls += 1
            if calls == 5:
                raise Cancelled()
        with self.assertRaises(Cancelled):
            mp4.container_extent_advisory(self.path, checkpoint=check)
        self.assertEqual(self.path.read_bytes(), raw)

    def test_payload_is_seeked_not_read(self):
        # Sparse synthetic file: logical 1 GiB, no large allocation or payload read.
        with self.path.open('wb') as source:
            source.write(ftyp() + box(b'mdat', size=1024**3))
            source.seek(len(ftyp()) + 1024**3 - 1)
            source.write(b'\0')
        opened = Path.open
        reads = []
        class Tracked:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): return self
            def __exit__(self, *args): self.stream.close()
            def fileno(self): return self.stream.fileno()
            def seek(self, *args): return self.stream.seek(*args)
            def read(self, n): reads.append(n); return self.stream.read(n)
        with patch.object(Path, 'open', lambda path, *a, **kw: Tracked(opened(path, *a, **kw))):
            self.assertIsNone(mp4.container_extent_advisory(self.path))
        self.assertLess(sum(reads), 100)

    def test_source_change_and_io_errors_propagate(self):
        raw = ftyp() + box(b'mdat')
        self.path.write_bytes(raw)
        before = self.path.stat()
        class Decoder:
            def info(self, path): return dict(sample_rate=16000, channels=1, expected_frames=1, backend='fake')
            def blocks(self, path, info): yield struct.pack('<i', 12345678)
        native = mp4.container_extent_advisory
        def mutate(path, **kwargs):
            result = native(path, **kwargs)
            path.write_bytes(ftyp() + box(b'free'))
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
            return result
        with patch('audio_review_desk.audio.container_extent_advisory', mutate):
            with self.assertRaisesRegex(AudioError, 'Source changed'):
                analyze(self.path, Decoder())
        failure = PermissionError('read refused')
        with patch.object(Path, 'open', side_effect=failure):
            with self.assertRaises(PermissionError):
                mp4.container_extent_advisory(self.path)


class ContractTests(unittest.TestCase):
    def test_cancelled_advisory_preserves_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'audio/a.wav'
            write_wav(source, seconds=.1)
            workspace = Workspace(root / 'workspace')
            workspace.scan(source.parent)
            before = workspace.state()
            event = threading.Event()
            def cancel(path, checkpoint=None):
                event.set()
                checkpoint()
            with patch('audio_review_desk.audio.container_extent_advisory', side_effect=cancel):
                with self.assertRaises(ImportCancelled):
                    workspace.scan(source.parent, cancelled=event)
            self.assertEqual(workspace.state(), before)

    def test_b_only_neutral_or_extent_preserves_reviews_and_csv_columns(self):
        for flag in (mp4.CHECK_INCOMPLETE, mp4.EXTENT_EXCEEDS_FILE):
            with self.subTest(flag=flag), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                a, b = root / 'audio/a.wav', root / 'audio/b.wav'
                write_wav(a, seconds=.1)
                write_wav(b, seconds=.1, amplitude=.3)
                workspace = Workspace(root / 'workspace')
                rows = [dict(id='pair', path=str(a), reference_path=str(b))]
                old = workspace.ingest(rows, root, kind='manifest')['items'][0]
                workspace.save_review(old['key'], dict(status='pass', score=0, note='heard', expected_version=0))
                history = workspace.history(old['key'])
                columns = next(csv.reader(io.StringIO(workspace.export_csv())))
                with patch('audio_review_desk.audio.container_extent_advisory', side_effect=lambda path, **kw: flag if path == b else None):
                    state = workspace.ingest(rows, root, kind='manifest')
                item = state['items'][0]
                self.assertEqual(item['key'], old['key'])
                self.assertEqual(workspace.history(item['key']), history)
                self.assertEqual(item['review'], history[-1])
                self.assertTrue(item['eligible'])
                self.assertEqual(state['stats']['warnings'], 1)
                self.assertAlmostEqual(state['stats']['human_approved_seconds'], .1)
                self.assertTrue(workspace.preview(item['key'], 'a').is_file())
                self.assertTrue(workspace.preview(item['key'], 'b').is_file())
                self.assertEqual(workspace.export()['items'][0]['reference_quality']['flags'], [flag])
                self.assertEqual(next(csv.reader(io.StringIO(workspace.export_csv()))), columns)
                item['quality']['flags'] = [flag, 'near_full_scale']
                self.assertEqual(statistics([item])['warnings'], 1)


# Optional installed tools only; never install codecs or use user media.


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Optional FFmpeg tools unavailable')
class ProducerTests(unittest.TestCase):
    def test_tail_moov_faststart_fragmented_hybrid_and_zero_mdat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wav = root / 'tone.wav'
            write_wav(wav, seconds=2, rate=48000)
            modes = [([], False), (['-movflags', '+faststart'], False),
                     (['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000'], True),
                     (['-movflags', '+frag_keyframe', '-frag_duration', '500000'], True)]
            for i, (options, fragmented) in enumerate(modes):
                with self.subTest(options=options):
                    path = root / f'{i}.m4a'
                    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(wav),
                                    '-c:a', 'aac', *options, str(path)], check=True,
                                   capture_output=True, timeout=15)
                    raw = path.read_bytes()
                    self.assertIn(raw[8:12], mp4.MAJOR_BRANDS)
                    self.assertIsNone(mp4.container_extent_advisory(path))
                    self.assertTrue(analyze(path)['decoded'])
                    path.write_bytes(raw[:-1])
                    self.assertEqual(mp4.container_extent_advisory(path), mp4.EXTENT_EXCEEDS_FILE)
                    path.write_bytes(raw)
                    positions, position = [], 0
                    while position < len(raw):
                        size = int.from_bytes(raw[position:position+4], 'big')
                        kind = raw[position+4:position+8]
                        self.assertGreaterEqual(size, 8)
                        positions.append((position, kind))
                        position += size
                    kinds = [kind for _, kind in positions]
                    self.assertEqual(b'moof' in kinds, fragmented)
                    if i == 0:
                        self.assertLess(kinds.index(b'mdat'), kinds.index(b'moov'))
                    if i == 1:
                        self.assertLess(kinds.index(b'moov'), kinds.index(b'mdat'))
                        mdat = next(position for position, kind in positions if kind == b'mdat')
                        path.write_bytes(raw[:mdat] + bytes(4) + raw[mdat+4:])
                        self.assertIsNone(mp4.container_extent_advisory(path))
                        self.assertTrue(analyze(path)['decoded'])
