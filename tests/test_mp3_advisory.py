"""Synthetic framing and locally generated producer fixtures. No user audio/network."""
import csv
import io
import ctypes as c
import ctypes
import ctypes.util
import os
import shutil
import struct
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from audio_review_desk import mp3
from audio_review_desk.audio import AudioError, analyze
from audio_review_desk.demo import write_wav
from audio_review_desk.workspace import ImportCancelled, Workspace, statistics


def frame(count=None, flags=1, header=b'\xff\xfb\x90\x00'):
    size, _, offset = mp3._header(header)
    raw = bytearray(header + bytes(size - 4))
    if count is not None:
        raw[offset:offset+12] = b'Xing' + flags.to_bytes(4,'big') + count.to_bytes(4,'big')
    return bytes(raw)


def id3(raw, version=4, footer=False):
    payload = b'padding without MPEG sync'
    h = b'ID3' + bytes([version,0,16 if footer else 0]) + len(payload).to_bytes(4,'big')
    return h + payload + (b'3DI'+h[3:] if footer else b'') + raw


class FramingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'input.mp3'
    def result(self, raw):
        self.path.write_bytes(raw); return mp3.frame_count_advisory(self.path)
    def test_count_excludes_metadata_and_clean_removal(self):
        raw = frame(2)+frame()+frame()
        self.assertIsNone(self.result(raw))
        self.assertEqual(self.result(raw[:-len(frame())]), mp3.COUNT_DIFFERS)
        self.assertEqual(self.result(frame(1)+frame()+frame()), mp3.COUNT_DIFFERS)
    def test_all_partial_tails_are_incomplete(self):
        for cut in range(1,len(frame())):
            self.assertEqual(self.result(frame(2)+frame()+frame()[:cut]), mp3.CHECK_INCOMPLETE)
    def test_tags_and_footer(self):
        for version, footer in [(3,False),(4,False),(4,True)]:
            self.assertIsNone(self.result(id3(frame(1)+frame(),version,footer)))
            self.assertEqual(self.result(id3(frame(2)+frame(),version,footer)),mp3.COUNT_DIFFERS)
        raw=id3(frame(2)+frame(),footer=True)
        self.assertIsNone(self.result(raw.replace(b'3DI',b'BAD')))
        for i,value in [(3,2),(4,1),(5,1),(6,128)]:
            bad=bytearray(raw);bad[i]=value;self.assertIsNone(self.result(bad))
    def test_missing_zero_and_unsupported_initial_are_silent_unknown(self):
        for raw in [b'',b'not MP3',frame(),frame(0),frame(2,flags=0),b'\xff\xfb\x00\x00',frame(2,header=b'\xff\xfa\x90\x00')+frame(),b'junk'+frame(2)+frame()]:
            self.assertIsNone(self.result(raw))
    def test_ambiguity_never_reports_mismatch(self):
        for tail in [b'TAG'+bytes(125),b'APETAGEX',frame(1)+frame(),b'garbage',frame(header=b'\xff\xfb\x94\x00'),frame(header=b'\xff\xfa\x90\x00')]:
            self.assertEqual(self.result(frame(100)+frame()+tail),mp3.CHECK_INCOMPLETE)
        self.assertEqual(self.result(frame(100,flags=17)),mp3.CHECK_INCOMPLETE)
        # 32kbps MPEG2.5 frame at 24kHz: flagged TOC cannot fit.
        self.assertEqual(self.result(frame(100,flags=15,header=b'\xff\xf3\x44\x00')),mp3.CHECK_INCOMPLETE)
    def test_bounds_and_cancellation(self):
        self.path.write_bytes(frame(100)+frame())
        for name,value in [('MAX_BYTES',len(frame())+4),('MAX_FRAMES',1)]:
            with patch.object(mp3,name,value):self.assertEqual(mp3.frame_count_advisory(self.path),mp3.CHECK_INCOMPLETE)
        class Cancelled(Exception):pass
        n=0
        def check():
            nonlocal n;n+=1
            if n==6:raise Cancelled()
        with self.assertRaises(Cancelled):mp3.frame_count_advisory(self.path,checkpoint=check)
    def test_source_mutation_guard(self):
        self.path.write_bytes(frame(1)+frame()); before=self.path.stat()
        class Decoder:
            def info(self,path):return dict(sample_rate=16000,channels=1,expected_frames=1,backend='fake')
            def blocks(self,path,info):yield struct.pack('<i',12345678)
        original=mp3._header
        replacement=frame(2)+frame()
        def mutate(raw):
            self.path.write_bytes(replacement);os.utime(self.path,ns=(before.st_atime_ns,before.st_mtime_ns));return original(raw)
        with patch.object(mp3,'_header',mutate),self.assertRaisesRegex(AudioError,'Source changed'):analyze(self.path,Decoder())


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg required')
class ProducerTests(unittest.TestCase):
    def test_ffmpeg_cbr_vbr_channels_rates_and_id3(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); wav=root/'tone.wav';write_wav(wav,seconds=.25)
            target=root/'tone.mp3'
            for rate in [44100,22050,11025,24000]:
                for channels in [1,2]:
                    for mode in [['-b:a','64k'],['-b:a','8k'],['-q:a','4']]:
                        for version in [3,4]:
                            with self.subTest(rate=rate,channels=channels,mode=mode,version=version):
                                subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(wav),'-ar',str(rate),'-ac',str(channels),'-c:a','libmp3lame',*mode,'-id3v2_version',str(version),str(target)],check=True,capture_output=True)
                                raw=target.read_bytes();self.assertIsNone(mp3.frame_count_advisory(target))
                                quality=analyze(target);self.assertTrue(quality['decoded'])
                                start=10+sum(v<<s for v,s in zip(raw[6:10],(21,14,7,0)))
                                offsets=[];pos=start
                                while pos<len(raw):offsets.append(pos);pos+=mp3._header(raw[pos:pos+4])[0]
                                self.assertEqual(pos,len(raw))
                                tag_offset=mp3._header(raw[start:start+4])[2]+start
                                self.assertEqual(int.from_bytes(raw[tag_offset+8:tag_offset+12],'big'),len(offsets)-1)
                                self.assertEqual(int.from_bytes(raw[tag_offset+12:tag_offset+16],'big'),len(raw)-start)
                                target.write_bytes(raw[:offsets[-1]])
                                self.assertEqual(mp3.frame_count_advisory(target),mp3.COUNT_DIFFERS)
                                shortened=analyze(target);self.assertTrue(shortened['decoded']);self.assertIn(mp3.COUNT_DIFFERS,shortened['flags'])
                                target.write_bytes(raw[:-1]);self.assertEqual(mp3.frame_count_advisory(target),mp3.CHECK_INCOMPLETE)


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
            with patch('audio_review_desk.audio.frame_count_advisory', side_effect=cancel):
                with self.assertRaises(ImportCancelled):
                    workspace.scan(source.parent, cancelled=event)
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
                return mp3.COUNT_DIFFERS if path == b else None
            with patch('audio_review_desk.audio.frame_count_advisory', side_effect=flag):
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
            self.assertEqual(exported['reference_quality']['flags'], [mp3.COUNT_DIFFERS])
            self.assertEqual(next(csv.reader(io.StringIO(workspace.export_csv()))), columns)
            item['quality']['flags'] = [mp3.CHECK_INCOMPLETE, 'near_full_scale']
            self.assertEqual(statistics([item])['warnings'], 1)
            item['quality']['decoded'] = False
            self.assertEqual(statistics([item])['warnings'], 0)
            self.assertEqual(statistics([item])['errors'], 1)


@unittest.skipUnless(ctypes.util.find_library("mp3lame"), "System LAME library required")
class LameProducerTests(unittest.TestCase):
    def test_independent_producer_counts_and_crc_placement(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lame.mp3"
            l=c.CDLL(ctypes.util.find_library('mp3lame')); l.lame_init.restype=c.c_void_p
            for name in ['lame_set_in_samplerate','lame_set_num_channels','lame_set_brate','lame_set_error_protection','lame_set_VBR']:
             f=getattr(l,name); f.argtypes=[c.c_void_p,c.c_int]; f.restype=c.c_int
            l.lame_init_params.argtypes=[c.c_void_p]; l.lame_close.argtypes=[c.c_void_p]
            l.lame_encode_buffer.argtypes=[c.c_void_p,c.POINTER(c.c_short),c.POINTER(c.c_short),c.c_int,c.POINTER(c.c_ubyte),c.c_int]
            l.lame_encode_flush.argtypes=[c.c_void_p,c.POINTER(c.c_ubyte),c.c_int]
            l.lame_get_lametag_frame.argtypes=[c.c_void_p,c.POINTER(c.c_ubyte),c.c_size_t]; l.lame_get_lametag_frame.restype=c.c_size_t
            for rate in [44100,22050,11025]:
             for channels in [1,2]:
              for crc in [0,1]:
               for vbr in [0,4]:
                g=l.lame_init()
                for name,value in [('in_samplerate',rate),('num_channels',channels),('brate',64),('error_protection',crc),('VBR',vbr)]: assert getattr(l,'lame_set_'+name)(g,value)==0
                assert l.lame_init_params(g)==0
                pcm=(c.c_short*(rate))(*[int(10000*((i%100)/100-.5)) for i in range(rate)]); buf=(c.c_ubyte*(rate*5+7200))()
                n=l.lame_encode_buffer(g,pcm,pcm,rate,buf,len(buf)); raw=bytes(buf[:n]); n=l.lame_encode_flush(g,buf,len(buf)); raw+=bytes(buf[:n]); n=l.lame_get_lametag_frame(g,buf,len(buf)); tag=bytes(buf[:n]); raw=tag+raw[n:]; l.lame_close(g)
                off=0; frames=0
                while off<len(raw):
                 h=int.from_bytes(raw[off:off+4],'big'); v=(h>>19)&3; ix=(h>>12)&15; sr=[44100,48000,32000][(h>>10)&3]//({3:1,2:2,0:4}[v]); br=([0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] if v==3 else [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[ix]; size=(144000 if v==3 else 72000)*br//sr+((h>>9)&1); off+=size; frames+=1
                x=4+((17 if channels==1 else 32) if v==3 else (9 if channels==1 else 17)); count=int.from_bytes(raw[x+8:x+12],'big'); bytecount=int.from_bytes(raw[x+12:x+16],'big')
                assert raw[x:x+4] in [b'Xing',b'Info'],(rate,channels,crc,vbr,x)
                assert count==frames-1 and bytecount==len(raw),(count,frames,bytecount,len(raw))
                path.write_bytes(raw)
                self.assertIsNone(mp3.frame_count_advisory(path))
                if not crc:
                 path.write_bytes(raw[:-size]);self.assertEqual(mp3.frame_count_advisory(path),mp3.COUNT_DIFFERS)
                else:
                 path.write_bytes(raw[:-size]);self.assertIsNone(mp3.frame_count_advisory(path))
