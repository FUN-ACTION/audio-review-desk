"""Only synthetic bytes/generated tones; no private inputs or network."""
import csv
import io
import os
import random
import shutil
import struct
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk import ogg
from audio_review_desk.audio import AudioError, analyze
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import ImportCancelled, Workspace, statistics


def slow_crc(data):
    """Independent bitwise oracle, not the production table builder."""
    crc = 0
    for byte in data:
        crc ^= byte << 24
        for _ in range(8):
            top = crc & 0x80000000
            crc = (crc << 1) & 0xffffffff
            if top:
                crc ^= 0x04c11db7
    return crc


def legacy_crc(data):
    """Pre-acceleration direct table recurrence, retained only as test oracle."""
    table = [slow_crc(bytes([byte])) for byte in range(256)]
    crc = 0
    for byte in data:
        crc = ((crc << 8) & 0xffffffff) ^ table[(crc >> 24) ^ byte]
    return crc


def page(serial=1, seq=0, flags=2, lacing=(1,), body=None, version=0):
    if body is None:
        body = b'x' * sum(lacing)
    header = b'OggS' + bytes([version, flags]) + bytes(8) + struct.pack('<II', serial, seq) + bytes(4) + bytes([len(lacing)])
    raw = header + bytes(lacing) + body
    return raw[:22] + struct.pack('<I', slow_crc(raw)) + raw[26:]


def pages(data):
    result = []
    offset = 0
    while offset < len(data):
        count = data[offset + 26]
        size = 27 + count + sum(data[offset + 27:offset + 27 + count])
        result.append(data[offset:offset + size])
        offset += size
    return result


class CRCAccelerationTests(unittest.TestCase):
    def test_oracle_all_byte_values_patterns_random_and_maximum_pages(self):
        rng = random.Random(35337845)
        vectors = [b'', b'123456789', bytes(range(256)), bytes(range(255, -1, -1))]
        vectors += [bytes([byte]) for byte in range(256)]
        vectors += [bytes([byte]) * 65307 for byte in (0, 1, 0x55, 0xaa, 0xff)]
        vectors += [rng.randbytes(size) for size in (1, 2, 3, 4, 7, 8, 27, 255, 256, 257, 4096, 65307)]
        vectors += [rng.randbytes(rng.randrange(2048)) for _ in range(128)]
        for data in vectors:
            self.assertEqual(ogg.page_crc(data), slow_crc(data))
            self.assertEqual(ogg.page_crc(data), legacy_crc(data))

    def test_scanner_matches_legacy_outputs_and_checkpoints(self):
        rng = random.Random(3533)
        valid = page() + page(seq=1, flags=4)
        corpus = [valid, valid[:-1], page(), page(flags=6), page(lacing=(255,)),
                  page(1) + page(2) + page(1, 1, 4) + page(2, 1, 4),
                  valid + page(2, flags=6), page(version=1), b'OggS', b'not Ogg']
        for _ in range(100):
            changed = bytearray(valid)
            changed[rng.randrange(len(changed))] ^= rng.randrange(1, 256)
            corpus.append(changed)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.ogg'
            for raw in corpus:
                path.write_bytes(raw)
                observed = []
                for crc in (ogg.page_crc, legacy_crc):
                    checks = []
                    with patch.object(ogg, 'page_crc', crc):
                        result = ogg.ending_advisory(path, checkpoint=lambda: checks.append(None))
                    observed.append((result, len(checks)))
                self.assertEqual(*observed)
            path.write_bytes(valid)
            for name, value in [('MAX_BYTES', len(valid)), ('MAX_PAGES', 1), ('MAX_SERIALS', 0)]:
                for crc in (ogg.page_crc, legacy_crc):
                    with patch.object(ogg, 'page_crc', crc), patch.object(ogg, name, value):
                        self.assertEqual(ogg.ending_advisory(path), ogg.CHECK_INCOMPLETE)


class FramingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'audio.ogg'

    def result(self, raw):
        self.path.write_bytes(raw)
        return ogg.ending_advisory(self.path)

    def test_valid_single_nil_eos_and_zero_length_packet(self):
        for raw in [page(flags=6), page() + page(seq=1, flags=4, lacing=()),
                    page(lacing=(0,)) + page(seq=1, flags=4)]:
            self.assertIsNone(self.result(raw))

    def test_valid_continued_packets_and_zero_termination(self):
        raw = page(lacing=(255,)) + page(seq=1, flags=1, lacing=(255,)) + page(seq=2, flags=5, lacing=(0,))
        self.assertIsNone(self.result(raw))

    def test_multiplexed_and_chained_groups(self):
        raw = page(1) + page(2) + page(1, 1, 0) + page(2, 1, 4) + page(1, 2, 4)
        self.assertIsNone(self.result(raw + page(3, flags=6)))
        self.assertEqual(self.result(raw + page(3)), ogg.ENDING_UNCONFIRMED)
        self.assertEqual(self.result(page(1) + page(2) + page(1, 1, 4)), ogg.ENDING_UNCONFIRMED)

    def test_clean_boundary_missing_end_and_unfinished_packet(self):
        for raw in [page(), page() + page(seq=1, flags=0), page(lacing=(255,))]:
            self.assertEqual(self.result(raw), ogg.ENDING_UNCONFIRMED)

    def test_every_partial_final_page_is_indeterminate(self):
        final = page(seq=1, flags=4, lacing=(255, 2))
        for cut in range(1, len(final)):
            self.assertEqual(self.result(page() + final[:cut]), ogg.CHECK_INCOMPLETE, cut)

    def test_crc_rejects_changes_even_to_eos_flag(self):
        raw = bytearray(page(flags=6))
        for index in [5, 6, 14, 18, 22, 27, 28]:
            changed = raw.copy()
            changed[index] ^= 1
            self.assertEqual(self.result(changed), ogg.CHECK_INCOMPLETE)
        self.assertEqual(ogg.page_crc(b'123456789'), 0x89a1897f)
        self.assertEqual(ogg.page_crc(bytes(range(256))), slow_crc(bytes(range(256))))

    def test_unsupported_and_inconsistent_layout_is_not_missing_eos(self):
        cases = [page(version=1), page(flags=10), page(flags=0), page(seq=1),
                 page() + page(seq=2, flags=4), page() + page(seq=0, flags=2),
                 page(flags=6) + page(seq=1, flags=4),
                 page(flags=6) + page(flags=6),
                 page() + page(seq=1, flags=0) + page(2),
                 page() + page(seq=1, flags=5),
                 page(lacing=(255,)) + page(seq=1, flags=4),
                 page(lacing=(255,), flags=6),
                 page(lacing=(255,)) + page(seq=1, flags=1, lacing=()),
                 page() + b'trailer', b'OggS', b'']
        for raw in cases:
            self.assertEqual(self.result(raw), ogg.CHECK_INCOMPLETE)

    def test_nonzero_initial_sequence_is_indeterminate(self):
        self.assertEqual(self.result(page(seq=0xffffffff) + page(seq=0, flags=4)), ogg.CHECK_INCOMPLETE)

    def test_live_join_with_pasted_headers_is_indeterminate(self):
        self.assertEqual(self.result(page() + page(seq=20, flags=1, lacing=(20,))), ogg.CHECK_INCOMPLETE)

    def test_caps_are_indeterminate_even_after_eos(self):
        raw = page(flags=6)
        self.path.write_bytes(raw)
        for name, value in [('MAX_BYTES', len(raw)), ('MAX_PAGES', 1), ('MAX_SERIALS', 0)]:
            with patch.object(ogg, name, value):
                self.assertEqual(ogg.ending_advisory(self.path), ogg.CHECK_INCOMPLETE)

    def test_not_ogg_is_not_a_completeness_claim(self):
        self.path = self.path.with_suffix('.bin')
        self.assertIsNone(self.result(b'RIFFnot an ogg'))
        self.assertIsNone(self.result(page(flags=6)))  # signature, not extension

    def test_cancellation_during_page_scan_propagates(self):
        self.path.write_bytes(page() + page(seq=1, flags=4))
        class Cancelled(Exception):
            pass
        calls = 0
        def check():
            nonlocal calls
            calls += 1
            if calls == 5:
                raise Cancelled()
        with self.assertRaises(Cancelled):
            ogg.ending_advisory(self.path, checkpoint=check)

    def test_scan_mutation_cannot_escape_existing_source_guard(self):
        self.path.write_bytes(page(flags=6))
        original_stat = self.path.stat()
        class Decoder:
            def info(self, path):
                return dict(sample_rate=16000, channels=1, expected_frames=1, backend='fake')
            def blocks(self, path, info):
                yield struct.pack('<i', 12345678)
        original_crc = ogg.page_crc
        def mutate(raw):
            self.path.write_bytes(page(flags=2))
            os.utime(self.path, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            return original_crc(raw)
        with patch.object(ogg, 'page_crc', mutate):
            with self.assertRaisesRegex(AudioError, 'Source changed'):
                analyze(self.path, Decoder())


class AdvisoryContractTests(unittest.TestCase):
    def test_cancellation_in_framing_preserves_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'audio/a.wav'
            write_wav(source, seconds=.1)
            workspace = Workspace(root / 'workspace')
            workspace.scan(source.parent)
            before = workspace.state()
            ogg_path = root / 'ogg/input.ogg'
            ogg_path.parent.mkdir()
            ogg_path.write_bytes(page(flags=6))
            class Decoder:
                def info(self, path):
                    return dict(sample_rate=16000, channels=1, expected_frames=1, backend='fake')
                def blocks(self, path, info):
                    yield struct.pack('<i', 12345678)
            workspace.decoder = Decoder()
            event = threading.Event()
            crc = ogg.page_crc
            def cancel(raw):
                event.set()
                return crc(raw)
            with patch.object(ogg, 'page_crc', cancel):
                with self.assertRaises(ImportCancelled):
                    workspace.scan(ogg_path.parent, cancelled=event)
            self.assertEqual(workspace.state(), before)

    def test_b_only_advisory_keeps_keys_reviews_exports_and_playback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            a, b = root / 'audio/a.wav', root / 'audio/b.wav'
            write_wav(a, seconds=.1)
            write_wav(b, seconds=.1, amplitude=.3)
            workspace = Workspace(root / 'workspace')
            rows = [dict(id='pair', path=str(a), reference_path=str(b))]
            first = workspace.ingest(rows, root, kind='manifest')['items'][0]
            workspace.save_review(first['key'], dict(status='pass', score=0, note='heard', expected_version=0))
            columns = next(csv.reader(io.StringIO(workspace.export_csv())))
            def flag(path, **kwargs):
                return ogg.ENDING_UNCONFIRMED if path == b else None
            with patch('audio_review_desk.audio.ending_advisory', side_effect=flag):
                state = workspace.ingest(rows, root, kind='manifest')
            item = state['items'][0]
            self.assertEqual(item['key'], first['key'])
            self.assertTrue(item['eligible'])
            self.assertTrue(item['quality']['decoded'])
            self.assertEqual(item['review']['status'], 'pass')
            self.assertEqual(state['stats']['warnings'], 1)
            self.assertAlmostEqual(state['stats']['human_approved_seconds'], .1)
            self.assertTrue(workspace.preview(item['key'], 'a').is_file())
            self.assertTrue(workspace.preview(item['key'], 'b').is_file())
            exported = workspace.export()['items'][0]
            self.assertEqual(exported['reference_quality']['flags'], [ogg.ENDING_UNCONFIRMED])
            self.assertEqual(next(csv.reader(io.StringIO(workspace.export_csv()))), columns)
            item['quality']['flags'] = [ogg.CHECK_INCOMPLETE, 'near_full_scale']
            self.assertEqual(statistics([item])['warnings'], 1)
            item['quality']['decoded'] = False
            self.assertEqual(statistics([item])['warnings'], 0)
            self.assertEqual(statistics([item])['errors'], 1)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class RealCodecTests(unittest.TestCase):
    def test_generated_vorbis_opus_and_ogg_flac(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wav = root / 'tone.wav'
            write_wav(wav, seconds=4)
            for codec in ['libvorbis', 'libopus', 'flac']:
                with self.subTest(codec=codec):
                    target = root / (codec + '.ogg')
                    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(wav), '-c:a', codec, '-f', 'ogg', str(target)], check=True, capture_output=True)
                    raw = target.read_bytes()
                    self.assertIsNone(ogg.ending_advisory(target))
                    quality = analyze(target)
                    self.assertFalse(any(flag.startswith('ogg_') for flag in quality['flags']))
                    framed = pages(raw)
                    for framed_page in framed:
                        zeroed = framed_page[:22] + bytes(4) + framed_page[26:]
                        expected = int.from_bytes(framed_page[22:26], 'little')
                        self.assertEqual(ogg.page_crc(zeroed), expected)
                        self.assertEqual(slow_crc(zeroed), expected)
                        self.assertEqual(legacy_crc(zeroed), expected)
                    self.assertGreater(len(framed), 3)
                    target.write_bytes(b''.join(framed[:-1]))
                    self.assertEqual(ogg.ending_advisory(target), ogg.ENDING_UNCONFIRMED)
                    truncated = analyze(target)
                    self.assertTrue(truncated['decoded'])
                    self.assertIn(ogg.ENDING_UNCONFIRMED, truncated['flags'])
                    self.assertLess(truncated['frames'], quality['frames'])
                    target.write_bytes(raw[:-1])
                    self.assertEqual(ogg.ending_advisory(target), ogg.CHECK_INCOMPLETE)
                    # Actual codec pages in separate unique-serial streams.
                    serial = (int.from_bytes(framed[0][14:18], 'little') + 1) & 0xffffffff
                    other = []
                    for original in framed:
                        changed = original[:14] + struct.pack('<I', serial) + original[18:22] + bytes(4) + original[26:]
                        other.append(changed[:22] + struct.pack('<I', slow_crc(changed)) + changed[26:])
                    target.write_bytes(raw + b''.join(other))
                    self.assertIsNone(ogg.ending_advisory(target))
                    target.write_bytes(b''.join(a + b for a, b in zip(framed, other)))
                    self.assertIsNone(ogg.ending_advisory(target))
                    self.assertTrue(analyze(target)['decoded'])



if __name__ == '__main__':
    unittest.main()
