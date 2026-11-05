import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalReviewPlayer, localReviewLimits, moveLocalEdge, serializeLocalReview } from '../src/audio_review_desk/static/tour/local-review.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const media = [], created = [], revoked = [], timers = new Map(), frames = new Map(), errors = [];
  let serial = 0, ended = 0, play = async element => { element.paused = false; };
  class Audio {
    currentTime = 0; duration = NaN; paused = true;
    constructor() { media.push(this); }
    play() { return play(this); }
    pause() { this.paused = true; this.pauseCalls = (this.pauseCalls || 0) + 1; }
    removeAttribute(name) { delete this[name]; }
    load() {}
  }
  const runtime = { Audio,
    URL: { createObjectURL() { const url = `blob:local-${++serial}`; created.push(url); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
  };
  const player = createLocalReviewPlayer({ onEnded() { ended++; }, onError(error) { errors.push(error); } }, runtime);
  return { player, runtime, media, created, revoked, timers, frames, errors,
    get ended() { return ended; }, set play(fn) { play = fn; },
    async ready(name = 'take.wav', duration = 120) {
      const promise = player.load({ name, size: 100 });
      const element = media.at(-1); element.duration = duration; element.onloadedmetadata();
      return promise;
    },
    tick() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
  };
}

test('local metadata commits filename and duration without decoding or reading file bytes', async () => {
  const f = fixture(); let reads = 0;
  const loading = f.player.load({ name: 'C:\\private\\take.wav', size: localReviewLimits.maxBytes, arrayBuffer() { reads++; throw Error('must not read'); } });
  assert.equal(f.player.source, null); assert.equal(f.media[0].preload, 'metadata');
  f.media[0].duration = 3600; f.media[0].onloadedmetadata();
  assert.deepEqual(await loading, { ok: true, source: { name: 'take.wav', duration: 3600 } });
  assert.equal(reads, 0); assert.equal(f.timers.size, 0);
  f.player.dispose(); assert.deepEqual(f.revoked, f.created);
});

test('invalid sizes and unavailable native media allocate no object URLs', async () => {
  const f = fixture();
  for (const size of [0, -1, NaN, Infinity, localReviewLimits.maxBytes + 1])
    assert.deepEqual(await f.player.load({ name: 'bad.wav', size }), { ok: false, error: 'localSizeError' });
  assert.equal(f.created.length, 0);
  delete f.runtime.Audio;
  assert.deepEqual(await f.player.load({ size: 1 }), { ok: false, error: 'localUnsupported' });
});

test('duration failures, metadata errors and timeout retire candidates but preserve committed source', async () => {
  const f = fixture(); await f.ready();
  for (const duration of [NaN, Infinity, 0, .049, 3600.01]) {
    const loading = f.player.load({ name: 'bad.wav', size: 1 });
    const element = f.media.at(-1); element.duration = duration; element.onloadedmetadata();
    assert.deepEqual(await loading, { ok: false, error: 'localDurationError' });
    assert.equal(element.src, undefined); assert.equal(f.player.source.name, 'take.wav');
  }
  const broken = f.player.load({ size: 1 }); f.media.at(-1).onerror();
  assert.deepEqual(await broken, { ok: false, error: 'localUnsupported' });
  const timeout = f.player.load({ size: 1 });
  const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 12000); timer.fn();
  assert.deepEqual(await timeout, { ok: false, error: 'localMetadataTimeout' });
  assert.equal(f.timers.size, 0); f.player.dispose(); assert.deepEqual([...f.revoked].sort(), [...f.created].sort());
});

test('newer selection, explicit cancel, reset and dispose invalidate captured candidate events', async () => {
  const f = fixture();
  const first = f.player.load({ name: 'old.wav', size: 1 });
  const old = f.media[0], metadata = old.onloadedmetadata, error = old.onerror;
  const second = f.player.load({ name: 'new.wav', size: 1 });
  assert.deepEqual(await first, { ok: false, cancelled: true });
  old.duration = 999; metadata(); error();
  f.media[1].duration = 60; f.media[1].onloadedmetadata(); await second;
  assert.equal(f.player.source.name, 'new.wav');
  for (const action of ['cancelLoad', 'reset', 'dispose']) {
    const loading = f.player.load({ name: action, size: 1 }), candidate = f.media.at(-1);
    const callback = candidate.onloadedmetadata;
    f.player[action](); candidate.duration = 25; callback();
    assert.deepEqual(await loading, { ok: false, cancelled: true });
    assert.equal(candidate.src, undefined); assert.equal(f.timers.size, 0);
  }
  assert.equal(f.player.source, null); assert.deepEqual([...f.revoked].sort(), [...f.created].sort());
  assert.equal(new Set(f.revoked).size, f.revoked.length);
  f.player.dispose(); assert.deepEqual(await f.player.load({ size: 1 }), { ok: false, cancelled: true });
});

test('pending playback resolves harmlessly after pause, reset or dispose', async () => {
  for (const action of ['pause', 'reset', 'dispose']) {
    const f = fixture(); await f.ready(); const late = deferred(), element = f.media[0];
    f.play = media => late.promise.then(() => { media.paused = false; });
    const playing = f.player.play(); f.player[action](); late.resolve();
    assert.equal(await playing, false); assert.equal(element.paused, true); assert.equal(f.frames.size, 0);
    f.player.dispose();
  }
});

for (const newerState of ['pending', 'playing']) test(`old play completion preserves a newer same-element ${newerState} owner`, async () => {
  const f = fixture(); await f.ready(); const first = deferred(), second = deferred(); let calls = 0;
  f.play = media => (++calls === 1 ? first.promise : second.promise).then(() => { media.paused = false; });
  const old = f.player.play(); f.player.pause(); const newer = f.player.play({ at: 50 });
  if (newerState === 'playing') { second.resolve(); assert.equal(await newer, true); }
  const pauseCalls = f.media[0].pauseCalls; first.resolve(); assert.equal(await old, false);
  assert.equal(f.media[0].pauseCalls, pauseCalls);
  if (newerState === 'pending') { second.resolve(); assert.equal(await newer, true); }
  assert.equal(f.frames.size, 1); f.player.dispose();
});

test('replaced media callbacks and rejected stale plays cannot affect the new source', async () => {
  const f = fixture(); await f.ready('old.wav'); const oldMedia = f.media[0];
  const error = oldMedia.onerror, ended = oldMedia.onended, update = oldMedia.ontimeupdate, late = deferred();
  f.play = () => late.promise; const oldPlay = f.player.play();
  await f.ready('new.wav'); f.play = async media => { media.paused = false; }; await f.player.play();
  error(); ended(); update(); late.reject(Error('stale')); assert.equal(await oldPlay, false);
  assert.equal(f.errors.length, 0); assert.equal(f.ended, 0); assert.equal(f.media[1].paused, false);
  assert.equal(f.frames.size, 1); f.player.dispose();
});

test('range ends once, repeated audition restarts at range start, and loops stay in range', async () => {
  const f = fixture(); await f.ready(); const media = f.media[0];
  await f.player.play({ at: 100, start: 20, end: 30 }); assert.equal(media.currentTime, 20);
  media.currentTime = 31; media.ontimeupdate(); assert.equal(media.currentTime, 30);
  assert.equal(media.paused, true); assert.equal(f.ended, 1); assert.equal(f.frames.size, 0);
  media.onended(); assert.equal(f.ended, 1);
  await f.player.play({ at: f.player.time, start: 20, end: 30 }); assert.equal(media.currentTime, 20);
  await f.player.play({ at: 22, start: 20, end: 30, loop: true });
  for (let index = 0; index < 3; index++) { media.currentTime = 30; f.tick(); assert.equal(media.currentTime, 20); }
  assert.equal(f.ended, 1); assert.equal(f.frames.size, 1); f.player.dispose();
});

test('late loop resume cannot restart playback after pause, reset or dispose', async () => {
  for (const action of ['pause', 'reset', 'dispose']) {
    const f = fixture(); await f.ready(); const media = f.media[0];
    await f.player.play({ start: 10, end: 20, loop: true });
    const late = deferred(); f.play = element => late.promise.then(() => { element.paused = false; });
    media.paused = true; media.onended(); f.player[action](); late.resolve();
    await late.promise; await Promise.resolve(); await Promise.resolve();
    assert.equal(media.paused, true, `stale loop resume after ${action}`); assert.equal(f.frames.size, 0);
    f.player.dispose();
  }
});

for (const outcome of ['resolve', 'reject']) test(`a stale loop ${outcome} preserves newer playback and reports no stale error`, async () => {
  const f = fixture(); await f.ready(); const media = f.media[0];
  await f.player.play({ start: 10, end: 20, loop: true });
  const late = deferred(); f.play = element => late.promise.then(() => { element.paused = false; });
  media.paused = true; media.onended();
  f.play = async element => { element.paused = false; };
  await f.player.play({ at: 50, start: 40, end: 60 });
  const pauses = media.pauseCalls;
  if (outcome === 'resolve') late.resolve(); else late.reject(Error('stale loop'));
  await late.promise.catch(() => {}); await Promise.resolve(); await Promise.resolve();
  assert.equal(media.paused, false); assert.equal(media.pauseCalls, pauses);
  assert.equal(f.errors.length, 0); assert.equal(f.frames.size, 1); assert.equal(f.player.time, 50);
  f.player.dispose();
});

test('late loop resume retires its replaced element without pausing the replacement', async () => {
  const f = fixture(); await f.ready(); const old = f.media[0];
  await f.player.play({ start: 10, end: 20, loop: true });
  const late = deferred(); f.play = element => late.promise.then(() => { element.paused = false; });
  old.paused = true; old.onended(); await f.ready('new.wav');
  f.play = async element => { element.paused = false; }; await f.player.play();
  late.resolve(); await late.promise; await Promise.resolve(); await Promise.resolve();
  assert.equal(old.paused, true); assert.equal(f.media[1].paused, false); assert.equal(f.frames.size, 1);
  f.player.dispose();
});

test('current playback errors stop transport, and invalid ranges reject without starting', async () => {
  const f = fixture(); await f.ready();
  for (const options of [{ end: 121 }, { start: 20, end: 10 }, { at: Infinity }, { start: -1 }])
    await assert.rejects(f.player.play(options), RangeError);
  assert.equal(f.frames.size, 0);
  await f.player.play(); f.media[0].onerror();
  assert.deepEqual(f.errors, ['localPlaybackError']); assert.equal(f.frames.size, 0); assert.equal(f.media[0].paused, true);
  f.play = async () => { throw Error('play denied'); };
  await assert.rejects(f.player.play(), /play denied/); assert.equal(f.frames.size, 0);
  f.player.dispose();
});

test('short supported sources and local range edits stay bounded', async () => {
  const f = fixture(); assert.equal((await f.ready('short.wav', .05)).ok, true);
  await f.player.play({ start: 0, end: .05 }); f.player.dispose();
  assert.deepEqual(moveLocalEdge(0, .05, 'start', 1, .05), [0, .05]);
  assert.deepEqual(moveLocalEdge(0, .05, 'end', -1, .05), [0, .05]);
  assert.deepEqual(moveLocalEdge(20, 60, 'start', 100, 120), [59.75, 60]);
  assert.deepEqual(moveLocalEdge(20, 60, 'end', NaN, 120), [20, 20.25]);
  for (const args of [[0, 0, 'start', 0, 120], [0, 20, 'x', 0, 120], [0, 20, 'end', 1, Infinity]])
    assert.throws(() => moveLocalEdge(...args), RangeError);
});

test('local exports support long timestamps, sorted bounded notes and filename-only provenance', () => {
  const notes = [{ at: 75.123456, text: 'Ending', path: '/private/secret' }, { at: 20, text: 'Start' }];
  const data = JSON.parse(serializeLocalReview({ name: '/private/folder/take\u0000.wav', duration: 120, range: [20, 90.123456], notes, bytes: 'secret' }));
  assert.equal(data.format, 'audio-review-desk-local-review'); assert.deepEqual(data.source, { name: 'take.wav' });
  assert.deepEqual(data.notes, [{ seconds: 20, text: 'Start' }, { seconds: 75.123, text: 'Ending' }]);
  assert.deepEqual(data.selected_range_seconds, [20, 90.123]); assert.equal(data.duration_seconds, 120);
  assert.match(data.timing, /not sample-accurate/); assert.doesNotMatch(JSON.stringify(data), /private|secret|bytes/);
  assert.equal(notes[0].at, 75.123456);
  const base = { name: 'C:\\secret\\take.wav', duration: 120, range: [0, 120], notes: [] };
  assert.equal(JSON.parse(serializeLocalReview(base)).source.name, 'take.wav');
  assert.equal(JSON.parse(serializeLocalReview({ ...base, notes: Array(20).fill({ at: 120, text: 'x' }) })).notes.length, 20);
  for (const invalid of [null, Array(21).fill({ at: 1, text: 'x' }), [{ at: 121, text: 'x' }], [{ at: NaN, text: 'x' }], [{ at: -1, text: 'x' }], [{ at: 1, text: '' }], [{ at: 1, text: ' ' }], [{ at: 1, text: 'x'.repeat(121) }]])
    assert.throws(() => serializeLocalReview({ ...base, notes: invalid }));
  for (const range of [[0, 121], [20, 20], [30, 20], [NaN, 20], [-1, 20]])
    assert.throws(() => serializeLocalReview({ ...base, range }));
});

for(const failure of ['audio', 'url']) test(`allocation failure ${failure} preserves the committed source`,async()=>{
 const f=fixture();await f.ready('kept.wav');const Audio=f.runtime.Audio,create=f.runtime.URL.createObjectURL;
 if(failure==='audio')f.runtime.Audio=function(){throw Error('constructor failed');};
 else f.runtime.URL.createObjectURL=()=>{throw Error('URL allocation failed');};
 assert.deepEqual(await f.player.load({name:'bad.wav',size:1}),{ok:false,error:'localUnsupported'});
 assert.equal(f.player.source.name,'kept.wav');assert.equal(f.timers.size,0);assert.equal(f.revoked.length,0);
 f.runtime.Audio=Audio;f.runtime.URL.createObjectURL=create;await f.player.play();f.player.dispose();assert.deepEqual(f.revoked,f.created);
});
test('repeated same-file replacement cancels stale events and balances URLs/timers',async()=>{
 const f=fixture();await f.ready('same.wav');
 for(let i=0;i<100;i++){
  const pending=f.player.load({name:'same.wav',size:1}),entry=f.media.at(-1),metadata=entry.onloadedmetadata,error=entry.onerror;
  if(i%3===0){f.player.cancelLoad();assert.deepEqual(await pending,{ok:false,cancelled:true});}
  else if(i%3===1){error();assert.equal((await pending).error,'localUnsupported');}
  else {entry.duration=60;metadata();assert.equal((await pending).ok,true);}
  const committed=f.player.source;entry.duration=90;metadata();error();assert.deepEqual(f.player.source,committed);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);
  assert.equal(f.created.length-f.revoked.length,1);assert.equal(new Set(f.revoked).size,f.revoked.length);
 }
 f.player.dispose();assert.deepEqual([...f.created].sort(),[...f.revoked].sort());assert.equal(f.player.source,null);
});

const sourceNameCases=[
 ['split supplementary', 'a'.repeat(239)+'🎧.wav', 'a'.repeat(239)],
 ['complete supplementary at ceiling', 'a'.repeat(238)+'🎧.wav', 'a'.repeat(238)+'🎧'],
 ['BMP ceiling', '声'.repeat(241), '声'.repeat(240)],
 ['supplementary-only ceiling', '🎧'.repeat(121), '🎧'.repeat(120)],
 ['short supplementary name', 'take-🎧.wav', 'take-🎧.wav'],
 ['sanitized path boundary', '/private/folder/'+ 'a'.repeat(239)+'🎧.wav', 'a'.repeat(239)],
];
for(const [label,name,expected] of sourceNameCases) test(`local source name stays Unicode-safe through metadata and export: ${label}`,async()=>{
 const f=fixture();const result=await f.ready(name,60);assert.equal(result.source.name,expected);assert.equal(f.player.source.name,expected);
 assert.ok(expected.length<=240);assert.equal(new TextDecoder().decode(new TextEncoder().encode(result.source.name)),result.source.name);
 for(const inputName of [name,result.source.name]){
  const json=serializeLocalReview({name:inputName,duration:60,range:[1,20],notes:[{at:2.123,text:'Keep 🎵'}]});
  const data=JSON.parse(new TextDecoder().decode(new TextEncoder().encode(json)));
  assert.equal(data.source.name,expected);assert.equal(data.source.name.isWellFormed(),true);
  assert.deepEqual(data.notes,[{seconds:2.123,text:'Keep 🎵'}]);assert.deepEqual(data.selected_range_seconds,[1,20]);assert.doesNotMatch(data.source.name,/private|folder/);
 }
 f.player.dispose();assert.deepEqual(f.revoked,f.created);
});
