import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMusicPlayer } from '../src/audio_review_desk/static/tour/music-player.js';

function fakeRuntime() {
  const created=[],revoked=[],frames=new Map(),media=[],sources=[];
  let resume=async()=>{}, play=async()=>{},serial=0,closed=0;
  const connection=()=>({connect(){},disconnect(){this.disconnected=true}});
  class AudioContext {
    destination={};
    resume(){return resume();}
    createAnalyser(){return {...connection(),getFloatTimeDomainData(a){a.fill(.1)}};}
    createBuffer(){return {copyToChannel(){}};}
    createBufferSource(){const source={...connection(),start(){},stop(){this.stopped=true}};sources.push(source);return source;}
    createMediaElementSource(){return connection();}
    async close(){closed++;}
  }
  class Audio {
    constructor(){media.push(this);}
    play(){this.playing=true;return play(this);}
    pause(){this.playing=false;this.pauseCalls=(this.pauseCalls||0)+1;}
    removeAttribute(){delete this.src;}
    load(){}
  }
  return {runtime:{AudioContext,Audio,URL:{createObjectURL(file){const url='blob:'+file.name;created.push(url);return url},revokeObjectURL(url){revoked.push(url)}},requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id},cancelAnimationFrame(id){frames.delete(id)}},
    created,revoked,frames,media,sources,get closed(){return closed},set resume(fn){resume=fn},set play(fn){play=fn}};
}

function deferred() {
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

for(const newerState of ['pending','playing']) {
  test(`a late old play cannot pause the same element's newer ${newerState} request`,async()=>{
    const env=fakeRuntime(),first=deferred(),second=deferred();
    let calls=0;
    env.play=()=>++calls===1?first.promise:second.promise;
    const player=createMusicPlayer({},env.runtime);
    player.selectFile({name:'song.flac'});
    const oldPlay=player.toggle();await Promise.resolve();
    player.pause();
    const newPlay=player.toggle();await Promise.resolve();
    assert.equal(calls,2);
    if(newerState==='playing'){second.resolve();await newPlay;}
    else assert.equal(player.state.pending,true);
    const pauseCalls=env.media[0].pauseCalls;
    first.resolve();await oldPlay;
    assert.equal(env.media[0].pauseCalls,pauseCalls);
    assert.equal(env.media[0].playing,true);
    assert.equal(player.state[newerState],true);
    if(newerState==='pending'){second.resolve();await newPlay;}
    assert.equal(player.state.playing,true);assert.equal(env.frames.size,1);
    player.dispose();assert.equal(env.frames.size,0);assert.deepEqual(env.revoked,env.created);
  });
}

test('a late successful media play still stops after the current intent changed to pause',async()=>{
  const env=fakeRuntime(),late=deferred();
  env.play=element=>late.promise.then(()=>{element.playing=true;});
  const player=createMusicPlayer({},env.runtime);
  player.selectFile({name:'song.wav'});
  const oldPlay=player.toggle();await Promise.resolve();
  player.pause();const pauseCalls=env.media[0].pauseCalls;
  late.resolve();await oldPlay;
  assert.equal(env.media[0].playing,false);
  assert.equal(env.media[0].pauseCalls,pauseCalls+1);
  assert.equal(player.state.pending,false);assert.equal(player.state.playing,false);
  assert.equal(env.frames.size,0);player.dispose();
});

test('captured events from a replaced media element cannot stop or report errors for the current file',async()=>{
  const env=fakeRuntime(),errors=[];
  const player=createMusicPlayer({onError:error=>errors.push(error)},env.runtime);
  player.selectFile({name:'old.wav'});
  const onended=env.media[0].onended,onerror=env.media[0].onerror;
  player.selectFile({name:'new.wav'});await player.toggle();
  const pauseCalls=env.media[1].pauseCalls||0;
  onended();onerror();
  assert.equal(player.state.name,'new.wav');assert.equal(player.state.playing,true);
  assert.equal(env.media[1].playing,true);assert.equal(env.media[1].pauseCalls||0,pauseCalls);
  assert.equal(errors.length,0);assert.equal(env.frames.size,1);
  player.dispose();onended();onerror();assert.equal(errors.length,0);
});

test('disposing during pending media playback stops a late play and releases its URL and callbacks',async()=>{
  const env=fakeRuntime(),late=deferred(),errors=[];
  env.play=element=>late.promise.then(()=>{element.playing=true;});
  const player=createMusicPlayer({onError:error=>errors.push(error)},env.runtime);
  player.selectFile({name:'local.mp3'});
  const oldMedia=env.media[0],onerror=oldMedia.onerror,onended=oldMedia.onended;
  const pending=player.toggle();await Promise.resolve();
  player.dispose();late.resolve();await pending;
  onerror();onended();
  assert.equal(oldMedia.playing,false);assert.equal(oldMedia.onended,null);assert.equal(oldMedia.onerror,null);
  assert.equal('src' in oldMedia,false);assert.deepEqual(env.revoked,env.created);
  assert.equal(env.frames.size,0);assert.equal(env.closed,1);assert.equal(errors.length,0);
});

test('pausing during AudioContext resume cannot start a late sample or RAF',async()=>{
  const env=fakeRuntime();let resolve;env.resume=()=>new Promise(r=>resolve=r);
  const player=createMusicPlayer({},env.runtime);const pending=player.toggle();
  assert.equal(player.state.pending,true);player.pause();resolve();await pending;
  assert.equal(env.sources.length,0);assert.equal(env.frames.size,0);assert.equal(player.state.playing,false);
  player.dispose();assert.equal(env.closed,1);
});

test('replacing local music during play releases old URLs without pausing the new selection',async()=>{
  const env=fakeRuntime();let resolve;env.play=()=>new Promise(r=>resolve=r);
  const player=createMusicPlayer({},env.runtime);
  player.selectFile({name:'first.flac'});const pending=player.toggle();
  await Promise.resolve();
  const oldMedia=env.media[0];player.selectFile({name:'second.wav'});
  assert.equal(oldMedia.onended,null);assert.equal(oldMedia.onerror,null);
  env.play=async()=>{};await player.toggle();
  assert.equal(player.state.playing,true);resolve();await pending;
  assert.equal(env.media[1].playing,true);assert.equal(oldMedia.playing,false);
  assert.deepEqual(env.revoked,['blob:first.flac']);
  player.dispose();assert.deepEqual(env.revoked,env.created);assert.equal(env.frames.size,0);assert.equal(env.closed,1);
});

test('sample end and reset release playback while allowing a later local selection',async()=>{
  const env=fakeRuntime(),levels=[],errors=[];
  const player=createMusicPlayer({onLevel:n=>levels.push(n),onError:e=>errors.push(e)},env.runtime);
  await player.toggle();assert.equal(player.state.playing,true);env.sources[0].onended();
  assert.equal(player.state.playing,false);assert.equal(env.frames.size,0);
  player.selectFile({name:'take.wav'});await player.toggle();env.media[0].onerror();
  assert.equal(errors.length,1);assert.equal(player.state.playing,false);
  player.reset();assert.equal(player.state.name,'');assert.deepEqual(env.revoked,env.created);
  assert.equal(levels.at(-1),0);player.dispose();
});

for (const selected of [false, true]) {
  for (const failure of ['missing', 'construct', 'resume-sync', 'resume-async', 'graph', 'play']) {
    test(`error category stays scoped: ${failure}, selected=${selected}`, async () => {
      const env = fakeRuntime(), errors = [], original = new Error('Not a file diagnosis');
      original.name = 'NotAllowedError';
      const player = createMusicPlayer({ onError: (...args) => errors.push(args) }, env.runtime);
      if (selected) player.selectFile({ name: 'audio.wav' });
      if (failure === 'missing') delete env.runtime.AudioContext;
      if (failure === 'construct') env.runtime.AudioContext = class { constructor() { throw original; } };
      if (failure === 'resume-sync') env.resume = () => { throw original; };
      if (failure === 'resume-async') env.resume = async () => { throw original; };
      if (failure === 'graph') env.runtime.AudioContext.prototype.createAnalyser = () => { throw original; };
      if (failure === 'play') {
        if (selected) env.play = async () => { throw original; };
        else env.runtime.AudioContext.prototype.createBuffer = () => { throw original; };
      }
      await player.toggle();
      assert.equal(errors.length, 1);
      assert.equal(errors[0][1], failure === 'missing' ? 'unavailable' : failure.startsWith('resume-') ? 'resume' : 'playback');
      if (failure !== 'missing') assert.equal(errors[0][0], original);
      assert.deepEqual(player.state, { playing: false, pending: false, name: selected ? 'audio.wav' : '' });
      assert.equal(env.frames.size, 0); player.dispose(); assert.deepEqual(env.revoked, env.created);
    });
  }
}
for (const code of [undefined, 1, 2, 3, 4, 99]) {
  test(`native media error ${code} only diagnoses supported codes`, async () => {
    const env = fakeRuntime(), errors = [];
    const player = createMusicPlayer({ onError: (...args) => errors.push(args) }, env.runtime);
    player.selectFile({ name: 'audio.wav' }); await player.toggle();
    env.media[0].error = code === undefined ? null : { code };
    env.media[0].onerror();
    assert.equal(errors[0][1], code === 3 ? 'decode' : code === 4 ? 'unsupported' : 'playback');
    assert.equal(player.state.playing, false); assert.equal(player.state.pending, false);
    player.dispose();
  });
}
for (const phase of ['resume', 'play']) for (const change of ['pause', 'replace', 'new-play', 'dispose']) {
  test(`late ${phase} rejection after ${change} cannot report or alter newer state`, async () => {
    const env = fakeRuntime(), errors = []; let reject;
    env[phase] = () => new Promise((_, no) => { reject = no; });
    const player = createMusicPlayer({ onError: (...args) => errors.push(args) }, env.runtime);
    player.selectFile({ name: 'old.wav' }); const pending = player.toggle(); await Promise.resolve();
    if (change === 'dispose') player.dispose();
    else if (change === 'replace') player.selectFile({ name: 'new.wav' });
    else { player.pause(); if (change === 'new-play') { env[phase] = async () => {}; await player.toggle(); } }
    const state = player.state, frames = env.frames.size;
    reject(new Error('late')); await pending;
    assert.deepEqual(errors, []); assert.deepEqual(player.state, state); assert.equal(env.frames.size, frames);
    player.dispose(); assert.deepEqual(env.revoked, env.created);
  });
}

test('resume failure can retry successfully; a later graph error is not mislabeled resume', async () => {
  const env = fakeRuntime(), errors = [];
  env.resume = async () => { throw new Error('first'); };
  const player = createMusicPlayer({ onError: (...args) => errors.push(args) }, env.runtime);
  player.selectFile({ name: 'keep.wav' }); await player.toggle();
  assert.equal(errors[0][1], 'resume'); assert.deepEqual(env.revoked, []);
  env.resume = async () => {}; await player.toggle();
  assert.equal(player.state.playing, true); assert.equal(player.state.name, 'keep.wav');
  player.pause(); env.play = async () => { throw new Error('play failure'); };
  await player.toggle(); assert.equal(errors[1][1], 'playback');
  player.dispose(); assert.deepEqual(env.revoked, env.created);
});

const tourSource = readFileSync(new URL('../src/audio_review_desk/static/tour/tour.js', import.meta.url), 'utf8');
const visibilityStart = tourSource.indexOf('const heroVisibility =');
const visibilityEnd = tourSource.indexOf('const revealObserver =', visibilityStart);
assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart);
const visibilityWiring = tourSource.slice(visibilityStart, visibilityEnd);
for (const route of ['hidden', 'offscreen']) for (const pending of [false, true]) {
  test(`hero ${route} callback independently pauses ${pending ? 'pending synthetic' : 'playing local'} audio and frames`, async () => {
    const env = fakeRuntime(), player = createMusicPlayer({}, env.runtime), wait = deferred();
    if (pending) env.resume = () => wait.promise;
    else player.selectFile({ name: 'visibility.wav' });
    const hero = {}, listeners = new Map(); let intersection, observed;
    const document = { hidden: false, addEventListener(type, fn) { listeners.set(type, fn); } };
    class Observer { constructor(fn) { intersection = fn; } observe(node) { observed = node; } }
    // Evaluate production registration, not an equivalent hand-written pause.
    Function('IntersectionObserver', '$', 'music', 'document', visibilityWiring)(Observer,
      id => { assert.equal(id, 'heroStage'); return hero; }, player, document);
    assert.equal(observed, hero); assert.ok(listeners.has('visibilitychange'));
    const playing = player.toggle();
    if (!pending) { await playing; assert.equal(player.state.playing, true); assert.ok(env.frames.size > 0); }
    else assert.equal(player.state.pending, true);
    if (route === 'hidden') { document.hidden = true; listeners.get('visibilitychange')(); }
    else intersection([{ isIntersecting: false }]);
    assert.equal(player.state.playing, false); assert.equal(player.state.pending, false);
    assert.equal(env.frames.size, 0);
    if (pending) { wait.resolve(); await playing; assert.equal(env.sources.length, 0); }
    else assert.equal(env.media[0].playing, false);
    assert.equal(env.frames.size, 0);
    if (route === 'hidden') { document.hidden = false; listeners.get('visibilitychange')(); }
    else intersection([{ isIntersecting: true }]);
    assert.equal(player.state.playing, false); assert.equal(player.state.pending, false);
    assert.equal(env.frames.size, 0, 'becoming visible cannot auto-resume');
    player.dispose();
  });
}

for (const route of ['hidden', 'offscreen']) {
  test(`hero ${route} during local media.play pending rejects late success without auto-resuming`, async () => {
    const env = fakeRuntime(), player = createMusicPlayer({}, env.runtime), wait = deferred();
    let playStarted = false;
    player.selectFile({ name: 'delayed.wav' });
    // Deliberately make the media active on late resolution, as a controlled
    // adverse outcome; this is not a claim about native transient audibility.
    env.play = media => { playStarted = true; return wait.promise.then(() => { media.playing = true; }); };
    const hero = {}, listeners = new Map(); let intersection, observed;
    const document = { hidden: false, addEventListener(type, fn) { listeners.set(type, fn); } };
    class Observer { constructor(fn) { intersection = fn; } observe(node) { observed = node; } }
    Function('IntersectionObserver', '$', 'music', 'document', visibilityWiring)(Observer,
      id => { assert.equal(id, 'heroStage'); return hero; }, player, document);
    assert.equal(observed, hero); assert.ok(listeners.has('visibilitychange'));
    const pending = player.toggle();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.equal(playStarted, true, 'must reach media.play, not remain in context.resume');
    assert.equal(player.state.pending, true);
    if (route === 'hidden') { document.hidden = true; listeners.get('visibilitychange')(); }
    else intersection([{ isIntersecting: false }]);
    const pausesAfterHide = env.media[0].pauseCalls;
    assert.equal(player.state.playing, false); assert.equal(player.state.pending, false);
    assert.equal(env.frames.size, 0);
    wait.resolve(); await pending;
    assert.equal(env.media[0].playing, false);
    assert.ok(env.media[0].pauseCalls > pausesAfterHide, 'late active media must be paused again');
    assert.equal(player.state.playing, false); assert.equal(player.state.pending, false);
    assert.equal(env.frames.size, 0);
    if (route === 'hidden') { document.hidden = false; listeners.get('visibilitychange')(); }
    else intersection([{ isIntersecting: true }]);
    assert.equal(env.media[0].playing, false);
    assert.equal(player.state.playing, false); assert.equal(player.state.pending, false);
    assert.equal(env.frames.size, 0, 'becoming visible cannot auto-resume');
    player.dispose();
  });
}
