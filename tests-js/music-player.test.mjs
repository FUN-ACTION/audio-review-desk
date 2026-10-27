import test from 'node:test';
import assert from 'node:assert/strict';
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
