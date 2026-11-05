import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { copy } from '../src/audio_review_desk/static/tour/tour-copy.js';
import { serializeSampleNotes } from '../src/audio_review_desk/static/tour/review-tabs.js';
import { formatRangeTime, resolveRangeInput } from '../src/audio_review_desk/static/tour/range-time.js';
import { moveSampleEdge } from '../src/audio_review_desk/static/tour/studio-signal.js';
import { createLocalReviewPlayer, moveLocalEdge, serializeLocalReview } from '../src/audio_review_desk/static/tour/local-review.js';

const source=readFileSync(new URL('../src/audio_review_desk/static/tour/tour.js', import.meta.url),'utf8');
const mounting=source.slice(source.indexOf('function mountExamples() {'),source.indexOf('\nexamples = mountExamples();'));
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture({pending=false}={}) {
  const element=()=>({attrs:{},dataset:{},listeners:new Map(),children:[],value:'',hidden:false,disabled:false,
    setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.listeners.set(k,v);},removeEventListener(k){this.listeners.delete(k);},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},focus(){this.focused=true;document.activeElement=this;},remove(){this.removed=true;},click(){this.clicked=true;},
    emit(type,extra={}){return this.listeners.get(type)?.({target:this,preventDefault(){},...extra});}});
  const kinds=['compare','range','notes']; const roots=[]; let drawn=0,bars=0;
  const drawing={clearRect(){drawn++;},fillRect(){},beginPath(){},roundRect(){bars++;},fill(){},moveTo(){},lineTo(){},stroke(){},arc(){}};
  for(const kind of kinds){
    const root=element();root.dataset.example=kind;const nodes=new Map();root.nodes=nodes;
    for(const key of ['canvas','.sample-seek','.sample-play','.sample-time','.range-start','.range-end','.range-start-value','.range-end-value','.range-time-form','.range-time-start','.range-time-end','.range-time-apply','.range-time-revert','.range-time-status','.sample-loop','.note-form','.note-status','.note-input','.note-add','.sample-notes','.note-count','.note-export'])nodes.set(key,element());
    nodes.get('canvas').getBoundingClientRect=()=>({width:500,height:126});nodes.get('canvas').getContext=()=>drawing;
    const variants=['a','b'].map(v=>{const e=element();e.dataset.variant=v;return e;});root.variants=variants;
    root.querySelector=sel=>nodes.get(sel);root.querySelectorAll=()=>variants;roots.push(root);
  }
  const document=element();document.hidden=false;document.querySelectorAll=()=>roots;document.createElement=()=>element();document.body=element();
  const errors=element(), timers=[],blobs=[],urls=[],revoked=[],contexts=[],resumeRequests=[],media=[],ids=new Map(),frames=new Map();let frameId=0;
  ids.set('sampleError',errors);
  class Context {
    constructor(){this.currentTime=0;this.destination={};this.sources=[];contexts.push(this);}
    resume(){return pending?new Promise(resolve=>{resumeRequests.push(resolve);}):Promise.resolve();}
    createBuffer(){return {copyToChannel(){}};}
    createGain(){return {disconnections:0,gain:{value:0,targets:[],cancellations:[],setTargetAtTime(...args){this.targets.push(args);},cancelScheduledValues(time){this.cancellations.push(time);}},connect(){},disconnect(){this.disconnections++;}};}
    createBufferSource(){const s={disconnections:0,connect(gain){this.gain=gain;},disconnect(){this.disconnections++;},stop(...args){this.stopped=true;(this.stopCalls ||= []).push(args);},start(...args){this.started=args;}};this.sources.push(s);return s;}
    close(){return Promise.resolve();}
  }
  const observers=[];
  class Observer {constructor(cb){this.cb=cb;this.targets=[];observers.push(this);}observe(node){this.targets.push(node);}disconnect(){}}
  class Audio {
    constructor(){this.duration=NaN;this.currentTime=0;this.paused=true;media.push(this);}
    play(){this.paused=false;return Promise.resolve();}
    pause(){this.paused=true;}
    load(){}
    removeAttribute(key){delete this[key];}
  }
  const env={document,window:{...element(),AudioContext:Context,confirm:()=>true},Audio,ResizeObserver:Observer,IntersectionObserver:Observer,devicePixelRatio:1,
    sampleSignal:()=>new Float32Array(10),signalPeaks:()=>Array(120).fill(.25),sampleDuration:12,moveSampleEdge,serializeSampleNotes,formatRangeTime,resolveRangeInput,
    createLocalReviewPlayer:options=>createLocalReviewPlayer(options,env),moveLocalEdge,serializeLocalReview,
    music:{pauses:0,pause(){this.pauses++;},selectFile(file){this.selected=file;},reset(){this.selected=null;}},t:key=>copy.en[key],$:id=>{if(!ids.has(id))ids.set(id,element());return ids.get(id);},
    requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);},Blob:class {constructor(parts,options){this.parts=parts;this.options=options;blobs.push(this);}},
    URL:{createObjectURL(){const u=`blob:test-${urls.length}`;urls.push(u);return u;},revokeObjectURL(u){revoked.push(u);}},
    setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}};
  vm.createContext(env);vm.runInContext(`${mounting}\nvar api=mountExamples();`,env);env.api.translate();
  return {observers,get pendingFrames(){return frames.size;},roots,env,contexts,errors,blobs,urls,revoked,timers,media,ids,api:env.api,tick(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},get drawn(){return drawn;},get bars(){return bars;},resume(){resumeRequests.splice(0).forEach(resolve=>resolve());},
    async load(name='my-audio.wav',duration=95){const loading=env.api.selectFile({name,size:1000});const audio=media.at(-1);audio.duration=duration;audio.onloadedmetadata();return loading;}};
}

test('switching panels invalidates a pending AudioContext resume before it can start',async()=>{
  const f=fixture({pending:true});const compare=f.roots[0];compare.nodes.get('.sample-play').emit('click');
  assert.equal(compare.nodes.get('.sample-play').attrs['aria-pressed'],'true');
  f.api.show('notes');f.resume();await settle();
  assert.equal(f.contexts[0].sources.length,0);
  assert.equal(compare.nodes.get('.sample-play').attrs['aria-pressed'],'false');
});
test('switching panels stops active audio, keeps position and redraws the visible panel',async()=>{
  const f=fixture();const compare=f.roots[0];compare.nodes.get('.sample-play').emit('click');await settle();
  assert.equal(f.contexts[0].sources.length,1);f.contexts[0].currentTime=2.5;
  const before=f.drawn;f.api.show('range');
  assert.equal(f.contexts[0].sources[0].stopped,true);assert.equal(compare.nodes.get('.sample-seek').value,2.5);assert.ok(f.drawn>before);
  compare.nodes.get('.sample-play').emit('click');await settle();assert.equal(f.contexts[0].sources[1].started[1],2.5);
});
test('a repeated pending play click cancels instead of starting late',async()=>{
  const f=fixture({pending:true});const play=f.roots[0].nodes.get('.sample-play');play.emit('click');play.emit('click');f.resume();await settle();
  assert.equal(f.contexts[0].sources.length,0);assert.equal(play.attrs['aria-pressed'],'false');
});
test('A/B preserves the active position and audio owner',async()=>{
  const f=fixture();const root=f.roots[0];root.nodes.get('.sample-play').emit('click');await settle();f.contexts[0].currentTime=4;
  root.variants[1].emit('click');await settle();
  assert.equal(f.contexts[0].sources[0].stopped,true);assert.equal(f.contexts[0].sources[1].started[1],4);
  assert.equal(root.variants[1].attrs['aria-pressed'],'true');
});
test('repeated seek input keeps only the latest pending playback intent',async()=>{
  const f=fixture({pending:true}),n=f.roots[0].nodes;
  n.get('.sample-play').emit('click');
  for(const time of [2,4,7.25]){n.get('.sample-seek').value=time;n.get('.sample-seek').emit('input');}
  f.resume();await settle();
  assert.equal(f.contexts[0].sources.length,1);
  assert.equal(f.contexts[0].sources[0].started[1],7.25);
  assert.equal(n.get('.sample-play').attrs['aria-pressed'],'true');
});
test('pending A/B, range and loop changes preserve the latest play request',async()=>{
  for(const kind of ['compare','range']){
    const f=fixture({pending:true}),root=f.roots[kind==='compare'?0:1],n=root.nodes;
    n.get('.sample-play').emit('click');
    if(kind==='compare')root.variants[1].emit('click');
    else{
      n.get('.range-start').value=4;n.get('.range-start').emit('input');
      n.get('.range-end').value=5;n.get('.range-end').emit('input');
      n.get('.sample-loop').checked=false;n.get('.sample-loop').emit('change');
    }
    f.resume();await settle();
    assert.equal(f.contexts[0].sources.length,1,kind);
    if(kind==='range')assert.deepEqual(f.contexts[0].sources[0].started,[0,4,1]);
    else assert.equal(root.variants[1].attrs['aria-pressed'],'true');
  }
});
test('choosing a note timestamp supersedes a pending resume at the old position',async()=>{
  const f=fixture({pending:true}),n=f.roots[2].nodes;
  n.get('.sample-seek').value=5;n.get('.sample-seek').emit('input');
  n.get('.note-input').value='Listen again';n.get('.note-form').emit('submit');
  n.get('.sample-seek').value=1;n.get('.sample-seek').emit('input');
  n.get('.sample-play').emit('click');
  n.get('.sample-notes').children[0].children[0].emit('click');
  f.resume();await settle();
  assert.equal(f.contexts[0].sources.length,1);
  assert.equal(f.contexts[0].sources[0].started[1],5);
});
test('late end notification cannot move a non-looping range beyond its chosen edge',async()=>{
  const f=fixture(),n=f.roots[1].nodes;
  n.get('.sample-loop').checked=false;n.get('.sample-loop').emit('change');
  n.get('.sample-play').emit('click');await settle();
  f.contexts[0].currentTime=8;f.contexts[0].sources[0].onended();
  assert.equal(n.get('.sample-seek').value,6.2);
  assert.equal(n.get('.sample-play').attrs['aria-pressed'],'false');
});
test('native sliders announce localized time units after seeking and language changes',()=>{
  const f=fixture(),n=f.roots[1].nodes;
  n.get('.sample-seek').value=4.25;n.get('.sample-seek').emit('input');
  assert.equal(n.get('.sample-seek').attrs['aria-valuetext'],'4.25 seconds');
  assert.equal(n.get('.range-start').attrs['aria-valuetext'],'3.000 seconds');
  assert.equal(n.get('.range-end').attrs['aria-valuetext'],'6.200 seconds');
  f.env.t=key=>copy.zh[key];f.api.translate();
  assert.equal(n.get('.sample-seek').attrs['aria-valuetext'],'4.25 秒');
  assert.equal(n.get('.range-end').attrs['aria-valuetext'],'6.200 秒');
});
test('notes keep their order, 20-note boundary and temporary data across tabs and translation',()=>{
  const f=fixture();const root=f.roots[2],n=root.nodes;
  assert.equal(n.get('.note-export').disabled,true);
  for(let i=0;i<21;i++){n.get('.sample-seek').value=12-i*.2;n.get('.sample-seek').emit('input');n.get('.note-input').value=`Note ${i}`;n.get('.note-form').emit('submit');}
  assert.equal(n.get('.sample-notes').children.length,20);assert.equal(n.get('.note-count').textContent,copy.en.noteLimit);
  f.api.show('compare');f.api.show('notes');f.env.t=key=>copy.zh[key];f.api.translate();
  assert.equal(n.get('.sample-notes').children.length,20);assert.equal(n.get('.note-count').textContent,copy.zh.noteLimit);
  assert.equal(n.get('.note-export').disabled,false);
  n.get('.note-export').emit('click');assert.equal(f.blobs.length,0);assert.equal(n.get('.note-status').textContent,copy.zh.noteExportLimit);
  n.get('.note-input').value='';n.get('.note-input').emit('input');
  n.get('.note-export').emit('click');const exported=JSON.parse(f.blobs[0].parts[0]);
  assert.equal(exported.notes.length,20);assert.equal(exported.notes[0].text,'Note 19');assert.equal(exported.notes.at(-1).text,'Note 0');
});
test('export is repeatable and deletion restores the disabled empty state without retained URLs',()=>{
  const f=fixture();const n=f.roots[2].nodes;
  n.get('.note-input').value='细节'.repeat(60);n.get('.note-form').emit('submit');
  n.get('.note-export').emit('click');n.get('.note-export').emit('click');
  assert.equal(f.blobs.length,2);assert.equal(JSON.parse(f.blobs[0].parts[0]).notes[0].text.length,120);
  assert.equal(f.blobs[0].parts[0],f.blobs[1].parts[0]);
  f.timers.forEach(fn=>fn());assert.deepEqual(f.revoked,f.urls);
  n.get('.sample-notes').children[0].children[2].emit('click');assert.equal(n.get('.note-export').disabled,true);
  assert.equal(n.get('.note-input').focused,true);
});

test('a local source reaches every tool with real duration, disabled B and no synthetic waveform',async()=>{
  const f=fixture();assert.equal(await f.load('my recording.mp3',95),true);
  assert.equal(f.ids.get('reviewSourceName').textContent,'my recording.mp3');
  assert.equal(f.ids.get('reviewSourceDuration').textContent,'1:35.00');
  assert.equal(f.ids.get('reviewSourceLabel').textContent,copy.en.localMode);
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localAudioReady);
  assert.notEqual(f.ids.get('reviewSourceStatus').textContent,copy.en.localReady);
  assert.equal(f.env.music.selected.name,'my recording.mp3');
  assert.equal(f.roots[0].variants[1].disabled,true);
  assert.equal(f.ids.get('compareCaption').textContent,copy.en.localNoReference);
  for(const root of f.roots){assert.equal(root.nodes.get('.sample-seek').max,95);assert.equal(root.nodes.get('.sample-time').textContent,'0:00.00 / 1:35.00');}
  const bars=f.bars;f.api.translate();assert.equal(f.bars,bars,'local ruler must not draw sample bars');
  f.roots[0].variants[1].emit('click');assert.equal(f.roots[0].variants[1].attrs['aria-pressed'],'false');
  f.api.dispose();
});

test('local listening, range and notes share the file and carry the cursor between panels',async()=>{
  const f=fixture();await f.load('take.wav',95);const compare=f.roots[0].nodes,range=f.roots[1].nodes,notes=f.roots[2].nodes;
  compare.get('.sample-seek').value=27;compare.get('.sample-seek').emit('input');compare.get('.sample-play').emit('click');await settle();
  assert.equal(f.media[0].currentTime,27);assert.equal(f.contexts.length,0,'local path must not allocate decoded sample buffers');
  f.media[0].currentTime=29.5;f.api.show('notes');assert.equal(f.media[0].paused,true);assert.equal(notes.get('.sample-seek').value,29.5);
  notes.get('.note-input').value='Listen to this breath';notes.get('.note-form').emit('submit');
  f.api.show('range');assert.equal(range.get('.sample-seek').value,29.5);
  range.get('.range-end').value=40;range.get('.range-end').emit('input');range.get('.range-start').value=20;range.get('.range-start').emit('input');
  f.api.show('notes');notes.get('.note-export').emit('click');
  const data=JSON.parse(f.blobs[0].parts[0]);assert.equal(data.format,'audio-review-desk-local-review');
  assert.equal(data.source.name,'take.wav');assert.equal(data.duration_seconds,95);assert.deepEqual(data.selected_range_seconds,[20,40]);
  assert.equal(data.notes[0].seconds,29.5);assert.equal(data.notes[0].text,'Listen to this breath');
  assert.doesNotMatch(f.blobs[0].parts[0],/Synthesized/);
  f.api.dispose();
});

test('failed or cancelled replacement preserves the previous source and its notes',async()=>{
  const f=fixture();await f.load();const notes=f.roots[2].nodes;
  notes.get('.note-input').value='Keep this';notes.get('.note-form').emit('submit');
  f.env.window.confirm=()=>false;const count=f.media.length;
  assert.equal(await f.api.selectFile({name:'denied.wav',size:20}),false);assert.equal(f.media.length,count);
  f.env.window.confirm=()=>true;
  const bad=f.api.selectFile({name:'broken.wav',size:20});assert.equal(notes.get('.note-input').disabled,true);
  assert.equal(notes.get('.note-export').disabled,false);f.media.at(-1).onerror();assert.equal(await bad,false);
  assert.equal(f.ids.get('reviewSourceName').textContent,'my-audio.wav');assert.equal(notes.get('.sample-notes').children.length,1);
  assert.equal(notes.get('.note-input').disabled,false);assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localUnsupported);
  const pending=f.api.selectFile({name:'slow.wav',size:20});const candidate=f.media.at(-1),late=candidate.onloadedmetadata;
  f.api.cancelImport();candidate.duration=200;late();assert.equal(await pending,false);
  assert.equal(f.ids.get('reviewSourceName').textContent,'my-audio.wav');assert.equal(notes.get('.sample-notes').children.length,1);
  assert.equal(f.ids.get('reviewSourceControls').attrs['aria-busy'],'false');f.api.dispose();
});

test('newest local selection wins and an interrupted import cannot return after reset or disposal',async()=>{
  const f=fixture();const first=f.api.selectFile({name:'old.wav',size:20});const old=f.media[0],late=old.onloadedmetadata;
  const second=f.api.selectFile({name:'new.wav',size:20});f.media[1].duration=64;f.media[1].onloadedmetadata();
  assert.equal(await second,true);old.duration=99;late();assert.equal(await first,false);
  assert.equal(f.ids.get('reviewSourceName').textContent,'new.wav');
  const loading=f.api.selectFile({name:'reset.wav',size:20}),candidate=f.media.at(-1),callback=candidate.onloadedmetadata;
  f.api.resetSource();candidate.duration=120;callback();assert.equal(await loading,false);
  assert.equal(f.ids.get('reviewSourceName').textContent,'PIANO STUDY');assert.equal(f.roots[0].variants[1].disabled,false);
  const disposed=f.api.selectFile({name:'disposed.wav',size:20}),last=f.media.at(-1),lastCallback=last.onloadedmetadata;
  f.api.dispose();last.duration=45;lastCallback();assert.equal(await disposed,false);
  assert.equal(new Set(f.revoked).size,f.revoked.length);assert.deepEqual([...f.revoked].sort(),[...f.urls].sort());
});

test('local range-only exports work, and unsaved local work warns before leaving',async()=>{
  const f=fixture();await f.load('range.wav',120);const range=f.roots[1].nodes,notes=f.roots[2].nodes;
  const leaving=()=>{let prevented=false;f.env.window.emit('beforeunload',{preventDefault(){prevented=true;}});return prevented;};
  assert.equal(leaving(),false);assert.equal(notes.get('.note-export').disabled,false);
  range.get('.range-end').value=30;range.get('.range-end').emit('input');assert.equal(leaving(),true);
  f.env.window.confirm=()=>false;assert.equal(f.api.resetSource(),false,'range-only work requires confirmation too');
  notes.get('.note-export').emit('click');assert.equal(leaving(),true);
  assert.equal(f.ids.get('reviewConfirmExport').hidden,false);
  f.ids.get('reviewConfirmExport').emit('click');assert.equal(leaving(),false);
  assert.equal(f.ids.get('reviewConfirmExport').hidden,true);
  assert.equal(JSON.parse(f.blobs[0].parts[0]).notes.length,0);assert.deepEqual(JSON.parse(f.blobs[0].parts[0]).selected_range_seconds,[0,30]);
  notes.get('.note-input').value='unfinished';assert.equal(leaving(),true);
  f.env.window.confirm=()=>false;assert.equal(f.api.resetSource(),false);assert.equal(notes.get('.note-input').value,'unfinished');
  f.env.window.confirm=()=>true;assert.equal(f.api.resetSource(),true);assert.equal(leaving(),false);
  assert.equal(notes.get('.note-export').disabled,true);assert.equal(f.env.music.selected,null);f.api.dispose();
  assert.equal(f.env.window.listeners.has('beforeunload'),false);
});

test('failed downloads retain local unsaved protection and provide an actionable message',async()=>{
  const f=fixture();await f.load();const notes=f.roots[2].nodes;
  notes.get('.note-input').value='Keep me';notes.get('.note-form').emit('submit');
  const create=f.env.document.createElement;
  f.env.document.createElement=()=>{const node=create();node.click=()=>{throw Error('download blocked');};return node;};
  assert.doesNotThrow(()=>notes.get('.note-export').emit('click'));
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localExportError);
  let prevented=false;f.env.window.emit('beforeunload',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  assert.equal(notes.get('.sample-notes').children.length,1);
  f.env.document.createElement=create;notes.get('.note-export').emit('click');
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.exportStarted);
  assert.equal(f.ids.get('reviewSourceStatus').dataset.state,'ready');
  f.timers.forEach(fn=>fn());assert.ok(f.revoked.includes(f.urls.at(-1)));f.api.dispose();
});

test('a failed export URL allocation does not discard notes or report a successful save',async()=>{
  const f=fixture();await f.load();const notes=f.roots[2].nodes;
  notes.get('.note-input').value='Still here';notes.get('.note-form').emit('submit');
  f.env.URL.createObjectURL=()=>{throw Error('allocation failed');};
  assert.doesNotThrow(()=>notes.get('.note-export').emit('click'));
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localExportError);
  assert.equal(notes.get('.sample-notes').children.length,1);
  let prevented=false;f.env.window.emit('beforeunload',{preventDefault(){prevented=true;}});assert.equal(prevented,true);f.api.dispose();
});

test('flat tour dictionaries contain no duplicate translation keys',()=>{
  const text=readFileSync(new URL('../src/audio_review_desk/static/tour/tour-copy.js',import.meta.url),'utf8');
  for(const language of ['zh','en']){
    const body=text.match(new RegExp(`\\b${language}:\\s*\\{([\\s\\S]*?)\\n  \\}`))[1];
    const withoutStrings=body.replace(/'(?:\\.|[^'\\])*'/g,"''");
    const keys=[...withoutStrings.matchAll(/(?:^|,)\s*([A-Za-z]\w*)\s*:/g)].map(match=>match[1]);
    assert.equal(keys.length,new Set(keys).size,language);
  }
});

test('short local files retain valid controls and local errors translate without exposing old drafts',async()=>{
  const f=fixture();await f.load('short.wav',.05);const range=f.roots[1].nodes;
  assert.equal(range.get('.range-start').max,0);assert.equal(range.get('.range-end').min,.05);assert.equal(range.get('.range-end').max,.05);
  range.get('.range-start').value=10;range.get('.range-start').emit('input');assert.equal(range.get('.range-start').value,0);
  assert.equal(await f.api.selectFile({name:'empty.wav',size:0}),false);
  f.env.t=key=>copy.zh[key];f.api.translate();
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.zh.localSizeError);
  assert.equal(f.ids.get('compareCaption').textContent,copy.zh.localNoReference);
  assert.equal(f.ids.get('reviewSourceName').textContent,'short.wav');f.api.dispose();
});


test('hero setup failure cannot strand a committed local source or disable its review tools',async()=>{
  const f=fixture();f.env.music.selectFile=()=>{throw Error('secondary allocation failed');};
  assert.equal(await f.load('working.wav',95),true);
  assert.equal(f.ids.get('reviewSourceName').textContent,'working.wav');
  assert.equal(f.ids.get('reviewSourceControls').attrs['aria-busy'],'false');
  assert.equal(f.ids.get('musicError').dataset.errorKey,'localHeroError');
  assert.equal(f.ids.get('musicError').hidden,false);
  const notes=f.roots[2].nodes;assert.equal(notes.get('.sample-play').disabled,false);
  notes.get('.sample-play').emit('click');await settle();assert.equal(f.media[0].paused,false);
  notes.get('.note-input').value='Retained';notes.get('.note-form').emit('submit');
  notes.get('.note-export').emit('click');assert.equal(JSON.parse(f.blobs[0].parts[0]).source.name,'working.wav');f.api.dispose();
});

test('a download request keeps discard protection until an explicit saved-copy confirmation',async()=>{
  const f=fixture();await f.load();const notes=f.roots[2].nodes;
  const leaving=()=>{let prevented=false;f.env.window.emit('beforeunload',{preventDefault(){prevented=true;}});return prevented;};
  notes.get('.note-input').value='First snapshot';notes.get('.note-form').emit('submit');
  notes.get('.note-export').emit('click');assert.equal(leaving(),true);
  f.env.window.confirm=()=>false;assert.equal(f.api.resetSource(),false);
  notes.get('.note-input').value='Added after download';notes.get('.note-form').emit('submit');
  f.ids.get('reviewConfirmExport').emit('click');assert.equal(leaving(),true,'acknowledgment applies only to downloaded snapshot');
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.exportConfirmed);
  notes.get('.note-export').emit('click');f.ids.get('reviewConfirmExport').emit('click');assert.equal(leaving(),false);
  notes.get('.note-input').value='Unfinished';assert.equal(leaving(),true);
  f.env.window.confirm=()=>true;f.api.resetSource();assert.equal(f.ids.get('reviewConfirmExport').hidden,true);f.api.dispose();
});

test('short-file duration and cursor remain legible rather than displaying zero over zero',async()=>{
  const f=fixture();await f.load('short.wav',.08);
  assert.equal(f.ids.get('reviewSourceDuration').textContent,'0:00.08');
  for(const root of f.roots)assert.equal(root.nodes.get('.sample-time').textContent,'0:00.00 / 0:00.08');
  const n=f.roots[0].nodes;n.get('.sample-seek').value=.05;n.get('.sample-seek').emit('input');
  assert.equal(n.get('.sample-time').textContent,'0:00.05 / 0:00.08');f.api.dispose();
});

test('loading live status is outside the busy controls subtree',()=>{
  const html=readFileSync(new URL('../src/audio_review_desk/static/tour/index.html',import.meta.url),'utf8');
  assert.match(html,/<div class="review-source-top" id="reviewSourceControls" aria-busy="false">[\s\S]*?<\/div><\/div>\s*<p id="reviewSourceStatus"[^>]*role="status"/);
});


test('sample export does not ask for an unavailable local saved-copy confirmation',()=>{
  const f=fixture(),notes=f.roots[2].nodes;
  notes.get('.note-input').value='Sample note';notes.get('.note-form').emit('submit');
  notes.get('.note-export').emit('click');
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.sampleExportStarted);
  assert.equal(f.ids.get('reviewConfirmExport').hidden,true);f.api.dispose();
});

test('exporting the retained source cannot hide a pending replacement status',async()=>{
  const f=fixture();await f.load();const notes=f.roots[2].nodes;
  notes.get('.note-input').value='Keep';notes.get('.note-form').emit('submit');
  const loading=f.api.selectFile({name:'next.wav',size:20});
  notes.get('.note-export').emit('click');
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localLoading);
  f.ids.get('reviewConfirmExport').emit('click');
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localLoading);
  f.api.cancelImport();assert.equal(await loading,false);
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.localLoadCancelled);
  assert.equal(f.ids.get('reviewSourceName').textContent,'my-audio.wav');f.api.dispose();
});


function typeRange(f,start,end){
  const n=f.roots[1].nodes;
  for(const [edge,value] of [['start',start],['end',end]]){n.get('.range-time-'+edge).value=value;n.get('.range-time-'+edge).emit('input');}
  return n;
}
function wouldWarn(f){let prevented=false;f.env.window.emit('beforeunload',{preventDefault(){prevented=true;}});return prevented;}

test('paired input selects a precise passage in a long file and exports only the applied times',async()=>{
  const f=fixture();await f.load('hour.wav',3600);const n=typeRange(f,'30:00.125','30:01.875');
  assert.equal(n.get('.range-start').disabled,true);n.get('.range-time-form').emit('submit');
  assert.equal(n.get('.range-start').value,1800.125);assert.equal(n.get('.range-end').value,1801.875);
  assert.equal(n.get('.range-start').disabled,false);assert.equal(n.get('.range-time-apply').disabled,true);
  assert.equal(n.get('.sample-seek').value,1800.125);assert.equal(n.get('.range-time-status').textContent,copy.en.rangeInputApplied);
  f.roots[2].nodes.get('.note-export').emit('click');assert.deepEqual(JSON.parse(f.blobs[0].parts[0]).selected_range_seconds,[1800.125,1801.875]);f.api.dispose();
});

test('invalid typed times do not pause active playback or change its applied interval',async()=>{
  const f=fixture();await f.load();const n=f.roots[1].nodes;n.get('.sample-play').emit('click');await settle();
  const media=f.media[0];media.currentTime=4;const playState=n.get('.sample-play').attrs['aria-pressed'];
  for(const [start,end,key] of [['1:','20','rangeInputFormatError'],['2','500','rangeInputBoundsError'],['10','9','rangeInputLengthError']]){
    typeRange(f,start,end);n.get('.range-time-form').emit('submit');
    assert.equal(media.paused,false);assert.equal(media.currentTime,4);assert.equal(n.get('.sample-play').attrs['aria-pressed'],playState);
    assert.equal(n.get('.range-start').value,0);assert.equal(n.get('.range-end').value,10);
    assert.equal(n.get('.range-time-status').textContent,copy.en[key].replace('{duration}','1:35.000').replace('{minimum}','0.25'));
    assert.equal(n.get('.range-time-start').value,start);assert.equal(n.get('.range-time-end').value,end);
  }
  assert.equal(n.get('.range-time-start').attrs['aria-invalid'],'true');assert.equal(n.get('.range-time-start').focused,true);f.api.dispose();
});

test('drafts and errors survive frame paints, seeking, translation and tab round trips',async()=>{
  const f=fixture();await f.load();const n=typeRange(f,'1:','20');n.get('.range-time-form').emit('submit');
  n.get('.sample-play').emit('click');await settle();f.media[0].currentTime=2;f.tick();
  n.get('.sample-seek').value=3;n.get('.sample-seek').emit('input');await settle();
  f.env.t=key=>copy.zh[key];f.api.translate();f.api.show('notes');f.api.show('range');
  assert.equal(n.get('.range-time-start').value,'1:');assert.equal(n.get('.range-time-end').value,'20');
  assert.equal(n.get('.range-time-status').textContent,copy.zh.rangeInputFormatError);
  assert.equal(n.get('.range-time-start').attrs['aria-invalid'],'true');
  n.get('.range-start').value=4;n.get('.range-start').emit('input');
  assert.equal(n.get('.range-time-start').value,'1:','disabled slider cannot discard a draft');f.api.dispose();
});

test('draft-only work survives failed and cancelled import and requires confirmation to discard',async()=>{
  const f=fixture();await f.load();const n=typeRange(f,'2:','3:');
  f.env.window.confirm=()=>false;const count=f.media.length;
  assert.equal(await f.api.selectFile({name:'other.wav',size:20}),false);assert.equal(f.api.resetSource(),false);assert.equal(f.media.length,count);assert.equal(wouldWarn(f),true);
  f.env.window.confirm=()=>true;const loading=f.api.selectFile({name:'bad.wav',size:20});
  assert.equal(n.get('.range-time-start').disabled,true);assert.equal(n.get('.range-time-apply').disabled,true);
  f.media.at(-1).onerror();assert.equal(await loading,false);assert.equal(n.get('.range-time-start').value,'2:');assert.equal(n.get('.range-time-end').value,'3:');
  const pending=f.api.selectFile({name:'slow.wav',size:20});const media=f.media.at(-1),late=media.onloadedmetadata;
  f.api.cancelImport();media.duration=80;late();assert.equal(await pending,false);assert.equal(n.get('.range-time-start').value,'2:');
  assert.equal(await f.load('new.wav',60),true);assert.equal(n.get('.range-time-start').value,'0:00.000');assert.equal(n.get('.range-time-end').value,'0:10.000');assert.equal(wouldWarn(f),false);f.api.dispose();
});

test('export acknowledgment cannot retire an unapplied range draft',async()=>{
  const f=fixture();await f.load();typeRange(f,'20','30');const notes=f.roots[2].nodes;
  notes.get('.note-export').emit('click');assert.deepEqual(JSON.parse(f.blobs[0].parts[0]).selected_range_seconds,[0,10]);
  assert.equal(f.ids.get('reviewSourceStatus').textContent,copy.en.exportAppliedRangeStarted);
  f.ids.get('reviewConfirmExport').emit('click');assert.equal(wouldWarn(f),true);
  f.roots[1].nodes.get('.range-time-form').emit('submit');assert.equal(wouldWarn(f),true,'new applied snapshot differs from saved download');f.api.dispose();
});

test('Escape and restore clear only drafts and never change applied playback',async()=>{
  const f=fixture();await f.load();const n=f.roots[1].nodes;n.get('.sample-play').emit('click');await settle();f.media[0].currentTime=4;
  typeRange(f,'bad','20');n.get('.range-time-form').emit('submit');
  let prevented=false;n.get('.range-time-start').emit('keydown',{key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(n.get('.range-time-start').value,'0:00.000');assert.equal(n.get('.range-time-start').attrs['aria-invalid'],'false');
  assert.equal(f.media[0].paused,false);assert.equal(f.media[0].currentTime,4);assert.equal(wouldWarn(f),false);
  typeRange(f,'5','8');n.get('.range-time-revert').emit('click');assert.equal(n.get('.range-end').value,10);assert.equal(f.media[0].paused,false);f.api.dispose();
});

test('precise sample drafts are protected even before a local file is chosen',()=>{
  const f=fixture();const n=typeRange(f,'1:','5');assert.equal(wouldWarn(f),true);
  f.env.window.confirm=()=>false;assert.equal(f.api.resetSource(),false);
  n.get('.range-time-revert').emit('click');assert.equal(wouldWarn(f),false);f.api.dispose();
});

test('unfinished sample notes request navigation protection until cleared',()=>{
  const f=fixture(), n=f.roots[2].nodes;
  assert.equal(wouldWarn(f),false);
  n.get('.note-input').value='  '; assert.equal(wouldWarn(f),false);
  n.get('.note-input').value='A saved note'; n.get('.note-form').emit('submit');
  n.get('.note-input').value='Unfinished thought'; assert.equal(wouldWarn(f),true);
  assert.equal(n.get('.note-export').disabled,false);
  n.get('.note-export').emit('click'); assert.equal(f.blobs.length,0); assert.equal(wouldWarn(f),true);
  assert.equal(n.get('.note-status').textContent,copy.en.noteExportDraft);
  n.get('.note-input').value=''; n.get('.note-input').emit('input'); assert.equal(wouldWarn(f),false);
  n.get('.note-export').emit('click'); assert.equal(f.blobs.length,1);
  f.api.dispose();
});

test('unchanged applied pair neither restarts audio nor creates a changed review',async()=>{
  const f=fixture();await f.load('precise.wav',.0504);const n=f.roots[1].nodes;
  n.get('.sample-play').emit('click');await settle();f.media[0].currentTime=.02;
  typeRange(f,'0','0.050');n.get('.range-time-form').emit('submit');
  assert.equal(f.media[0].currentTime,.02);assert.equal(f.media[0].paused,false);assert.equal(n.get('.range-end').value,.0504);assert.equal(wouldWarn(f),false);f.api.dispose();
});

test('rapid paired changes supersede pending sample playback and tab changes cancel it',async()=>{
  for(const cancel of [false,true]){
    const f=fixture({pending:true}),n=f.roots[1].nodes;n.get('.sample-play').emit('click');
    typeRange(f,'1.125','2.375');n.get('.range-time-form').emit('submit');
    typeRange(f,'7.125','8.875');n.get('.range-time-form').emit('submit');
    if(cancel)f.api.show('notes');f.resume();await settle();
    assert.equal(f.contexts[0].sources.length,cancel?0:1);
    if(!cancel){assert.equal(f.contexts[0].sources[0].started[1],7.125);assert.equal(f.contexts[0].sources[0].loopEnd,8.875);}f.api.dispose();
  }
});

test('rapid paired changes retain only the latest pending native playback owner',async()=>{
  const f=fixture();await f.load('hour.wav',3600);const n=f.roots[1].nodes,media=f.media[0],requests=[];
  media.play=()=>new Promise(resolve=>requests.push(()=>{media.paused=false;resolve();}));
  n.get('.sample-play').emit('click');typeRange(f,'20.125','30.375');n.get('.range-time-form').emit('submit');
  typeRange(f,'30:00.125','30:02.875');n.get('.range-time-form').emit('submit');
  assert.equal(requests.length,3);requests[0]();requests[1]();await settle();assert.equal(n.get('.sample-play').attrs['aria-pressed'],'true');
  requests[2]();await settle();assert.equal(media.currentTime,1800.125);assert.equal(media.paused,false);
  typeRange(f,'40','50');n.get('.range-time-form').emit('submit');n.get('.sample-play').emit('click');requests[3]();await settle();
  assert.equal(media.paused,true);assert.equal(n.get('.sample-play').attrs['aria-pressed'],'false');f.api.dispose();
});

test('typed minimum decimal interval remains usable with subsequent sample slider input',()=>{
  const f=fixture();const n=typeRange(f,'.1','.35');n.get('.range-time-form').emit('submit');
  n.get('.range-end').value=.5;assert.doesNotThrow(()=>n.get('.range-end').emit('input'));assert.equal(n.get('.range-end').value,.5);f.api.dispose();
});

test('precise fields have labels, help, live feedback, decimal sliders and non-submit restore',()=>{
  const html=readFileSync(new URL('../src/audio_review_desk/static/tour/index.html',import.meta.url),'utf8');
  for(const name of ['Start','End']){
    assert.match(html,new RegExp('<label for="rangeTime'+name+'">'));
    assert.match(html,new RegExp('id="rangeTime'+name+'"[^>]+aria-describedby="rangeTimeHint rangeTimeStatus"'));
  }
  assert.match(html,/class="range-time-revert subtle-button" type="button"/);
  assert.match(html,/id="rangeTimeStatus"[^>]+role="status"/);
  assert.match(html,/class="range-start"[^>]+step="0.001"/);assert.match(html,/class="range-end"[^>]+step="0.001"/);
});


test('invalid Apply leaves a pending sample resume intact and composition Escape preserves the draft',async()=>{
  const f=fixture({pending:true}),n=f.roots[1].nodes;n.get('.sample-play').emit('click');
  typeRange(f,'1:','4');n.get('.range-time-form').emit('submit');
  n.get('.range-time-start').emit('keydown',{key:'Escape',isComposing:true});assert.equal(n.get('.range-time-start').value,'1:');
  f.resume();await settle();assert.equal(f.contexts[0].sources.length,1);assert.equal(f.contexts[0].sources[0].started[1],3);
  assert.equal(f.contexts[0].sources[0].loopEnd,6.2);f.api.dispose();
});

test('near-EOF no-op input does not move or restart local playback',async()=>{
  const f=fixture();await f.load('near-end.wav',10.0004);const n=f.roots[1].nodes;
  n.get('.sample-play').emit('click');await settle();f.media[0].currentTime=4;
  typeRange(f,'0','0:10.000');n.get('.range-time-form').emit('submit');
  assert.equal(n.get('.range-end').value,10);assert.equal(f.media[0].currentTime,4);assert.equal(f.media[0].paused,false);assert.equal(wouldWarn(f),false);f.api.dispose();
});

for (const failure of ['cancelScheduledValues', 'setTargetAtTime', 'stop']) test(`failed ${failure} retires the old source without affecting a new play`, async()=>{
  const f=fixture(),card=f.roots[0];card.nodes.get('.sample-play').emit('click');await settle();
  const old=f.contexts[0].sources[0];
  if(failure==='stop')old.stop=()=>{throw Error('stop failed');};
  else old.gain.gain[failure]=()=>{throw Error('fade failed');};
  f.api.pause();assert.equal(old.disconnections,1);assert.equal(old.gain.disconnections,1);assert.equal(old.onended,null);
  card.nodes.get('.sample-play').emit('click');await settle();
  assert.equal(card.nodes.get('.sample-play').attrs['aria-pressed'],'true');
  assert.equal(f.contexts[0].sources[1].disconnections,0);f.api.dispose();
});

test('dispose releases all fading sources without waiting for ended and ignores their late callbacks',async()=>{
  const f=fixture(),card=f.roots[0],callbacks=[];
  for(let i=0;i<4;i++){
    card.nodes.get('.sample-play').emit('click');await settle();f.api.pause();
    callbacks.push(f.contexts[0].sources.at(-1).onended);
  }
  card.nodes.get('.sample-play').emit('click');await settle();
  f.api.dispose();f.api.dispose();callbacks.forEach(fn=>fn());
  for(const old of f.contexts[0].sources){assert.equal(old.disconnections,1);assert.equal(old.gain.disconnections,1);assert.equal(old.onended,null);}
});

test('a completed fade cleans once and its late callback leaves newer playback alone',async()=>{
  const f=fixture(),card=f.roots[0];card.nodes.get('.sample-play').emit('click');await settle();
  const old=f.contexts[0].sources[0];f.api.pause();const end=old.onended;
  card.nodes.get('.sample-play').emit('click');await settle();end();end();
  assert.equal(old.disconnections,1);assert.equal(old.gain.disconnections,1);assert.equal(old.onended,null);
  assert.equal(card.nodes.get('.sample-play').attrs['aria-pressed'],'true');
  assert.equal(f.contexts[0].sources[1].disconnections,0);f.api.dispose();assert.equal(old.disconnections,1);
});

for(const pausedAt of [0, 3.125]) test(`normal sample pause schedules a 15 ms fade at audio time ${pausedAt} without early disconnection`,async()=>{
  const f=fixture(),card=f.roots[0];card.nodes.get('.sample-play').emit('click');await settle();
  const context=f.contexts[0],old=context.sources[0];context.currentTime=pausedAt;
  f.api.pause();const end=old.onended;
  assert.deepEqual(old.stopCalls,[[pausedAt+.015]]);
  assert.deepEqual(old.gain.gain.cancellations,[pausedAt]);
  assert.deepEqual(old.gain.gain.targets.at(-1),[0,pausedAt,.003]);
  assert.equal(old.disconnections,0);assert.equal(old.gain.disconnections,0);assert.equal(typeof end,'function');
  // The fake does not synthesize ended from stop(). Keep the audio graph connected
  // until the controlled completion, independently of UI pause/new-play state.
  context.currentTime=pausedAt+.014;card.nodes.get('.sample-play').emit('click');await settle();
  assert.equal(old.disconnections,0);assert.equal(old.gain.disconnections,0);
  context.currentTime=pausedAt+.015;end();
  assert.equal(old.disconnections,1);assert.equal(old.gain.disconnections,1);assert.equal(old.onended,null);
  assert.equal(card.nodes.get('.sample-play').attrs['aria-pressed'],'true');
  assert.equal(context.sources[1].disconnections,0);f.api.dispose();
});

function hideClearsFocus(f,node){
  let hidden=node.hidden;
  Object.defineProperty(node,'hidden',{get(){return hidden;},set(value){hidden=value;if(value&&f.env.document.activeElement===node)f.env.document.activeElement=null;}});
}
for(const outcome of ['cancel','success','error']) for(const focusCancel of [true,false]) test(`file loading ${outcome} restores only a hidden cancel focus=${focusCancel}`,async()=>{
  const f=fixture(),choose=f.env.$('reviewChoose'),other=f.env.$('languageToggle');
  const promise=f.api.selectFile({name:'new.wav',size:1}),cancel=f.ids.get('reviewCancel');hideClearsFocus(f,cancel);
  cancel.focus();
  if(!focusCancel)other.focus(); // Move away during loading, before its callback arrives.
  if(outcome==='cancel')f.api.cancelImport();
  else if(outcome==='success'){f.media.at(-1).duration=30;f.media.at(-1).onloadedmetadata();}
  else f.media.at(-1).onerror();
  await promise;assert.equal(cancel.hidden,true);assert.equal(f.env.document.activeElement,focusCancel?choose:other);f.api.dispose();
});
for(const origin of ['reviewReset','resetMusic']) test(`resetting local audio restores the ${origin} chooser without leaving focus hidden`,async()=>{
  const f=fixture();await f.load();const reset=f.env.$(origin),choose=f.env.$(origin==='resetMusic'?'chooseMusic':'reviewChoose');
  hideClearsFocus(f,reset);reset.focus();const original=f.env.music.reset;
  f.env.music.reset=()=>{original.call(f.env.music);f.env.$('resetMusic').hidden=true;};
  assert.equal(f.api.resetSource(),true);assert.equal(reset.hidden,true);assert.equal(f.env.document.activeElement,choose);f.api.dispose();
});
test('declining audio reset and resetting with unrelated focus do not move keyboard focus',async()=>{
  const f=fixture();await f.load();const notes=f.roots[2].nodes;
  notes.get('.note-input').value='keep';const reset=f.env.$('reviewReset');reset.focus();f.env.window.confirm=()=>false;
  assert.equal(f.api.resetSource(),false);assert.equal(f.env.document.activeElement,reset);
  f.env.window.confirm=()=>true;const unrelated=f.env.$('languageToggle');unrelated.focus();
  assert.equal(f.api.resetSource(),true);assert.equal(f.env.document.activeElement,unrelated);f.api.dispose();
});

for(const text of ['   ','\t \n','\u3000']) test(`blank note ${JSON.stringify(text)} preserves input and reports associated error`,()=>{
 const f=fixture(),n=f.roots[2].nodes,input=n.get('.note-input');input.value=text;n.get('.note-form').emit('submit');
 assert.equal(input.value,text);assert.equal(input.attrs['aria-invalid'],'true');assert.equal(f.env.document.activeElement,input);
 assert.equal(n.get('.note-status').textContent,copy.en.noteRequired);assert.equal(n.get('.sample-notes').children[0].className,'no-notes');
 f.env.t=key=>copy.zh[key];f.api.translate();assert.equal(n.get('.note-status').textContent,copy.zh.noteRequired);f.api.dispose();
});
test('correcting a rejected blank note clears error without adding or changing input',()=>{
 const f=fixture(),n=f.roots[2].nodes,input=n.get('.note-input');input.value=' ';n.get('.note-form').emit('submit');
 input.value='Still typing';input.emit('input');assert.equal(input.value,'Still typing');assert.equal(input.attrs['aria-invalid'],'false');assert.equal(n.get('.note-status').textContent,'');
 n.get('.note-form').emit('submit');assert.equal(n.get('.sample-notes').children[0].children[1].textContent,'Still typing');assert.equal(input.value,'');f.api.dispose();
});
test('full note capacity explains rejection, retains text and clears after deletion',()=>{
 const f=fixture(),n=f.roots[2].nodes,input=n.get('.note-input');
 for(let i=0;i<20;i++){input.value=`Note ${i}`;n.get('.note-form').emit('submit');}
 input.value='Pending note';n.get('.note-form').emit('submit');assert.equal(input.value,'Pending note');assert.equal(n.get('.note-status').textContent,copy.en.noteLimit);assert.equal(input.attrs['aria-invalid'],'false');
 n.get('.sample-notes').children[0].children[2].emit('click');assert.equal(n.get('.note-status').textContent,'');assert.equal(input.value,'Pending note');
 n.get('.note-form').emit('submit');assert.equal(n.get('.sample-notes').children.length,20);assert.equal(input.value,'');f.api.dispose();
});
test('note feedback survives failed audio replacement but clears on successful replacement and reset',async()=>{
 const f=fixture(),n=f.roots[2].nodes,input=n.get('.note-input');input.value=' ';n.get('.note-form').emit('submit');
 assert.equal(await f.api.selectFile({name:'invalid.wav',size:0}),false);assert.equal(input.attrs['aria-invalid'],'true');assert.equal(n.get('.note-status').textContent,copy.en.noteRequired);
 await f.load();assert.equal(input.attrs['aria-invalid'],'false');assert.equal(n.get('.note-status').textContent,'');
 input.value=' ';n.get('.note-form').emit('submit');f.api.resetSource();assert.equal(input.attrs['aria-invalid'],'false');assert.equal(n.get('.note-status').textContent,'');f.api.dispose();
});
test('note input is associated with a persistent atomic status region',()=>{
 const html=readFileSync(new URL('../src/audio_review_desk/static/tour/index.html',import.meta.url),'utf8');
 assert.match(html,/class="note-input"[^>]*aria-describedby="noteStatus"/);assert.match(html,/<p id="noteStatus"[^>]*role="status"[^>]*aria-atomic="true"/);
});

for(const [duration,at] of [[.05,.04],[95,94.99]])for(const route of ['resume','seek','note'])test(`local near-EOF ${route} keeps requested ${at} of ${duration}`,async()=>{
 const f=fixture();await f.load('end.wav',duration);f.api.show(route==='note'?'notes':'compare');const n=f.roots[route==='note'?2:0].nodes;
 const seek=value=>{n.get('.sample-seek').value=value;n.get('.sample-seek').emit('input');};
 if(route==='resume'){seek(at);n.get('.sample-play').emit('click');}
 else if(route==='seek'){n.get('.sample-play').emit('click');await settle();seek(at);}
 else {seek(at);n.get('.note-input').value='Ending detail';n.get('.note-form').emit('submit');seek(0);n.get('.sample-play').emit('click');await settle();n.get('.sample-notes').children[0].children[0].emit('click');}
 await settle();assert.equal(f.media[0].currentTime,at);assert.equal(n.get('.sample-seek').value,at);assert.equal(n.get('.sample-play').attrs['aria-pressed'],'true');
 if(route==='note'){n.get('.note-export').emit('click');assert.equal(JSON.parse(f.blobs.at(-1).parts[0]).notes[0].seconds,at);}
 f.api.dispose();
});
test('short local looping range starts at the requested tail then wraps only at its end',async()=>{
 const f=fixture();await f.load('short.wav',.05);f.api.show('range');const n=f.roots[1].nodes;
 n.get('.sample-seek').value=.04;n.get('.sample-seek').emit('input');n.get('.sample-play').emit('click');await settle();assert.equal(f.media[0].currentTime,.04);
 f.media[0].currentTime=.05;f.media[0].paused=true;f.media[0].onended();await settle();f.tick();
 assert.equal(f.media[0].currentTime,0);assert.equal(n.get('.sample-seek').value,0);assert.equal(n.get('.sample-play').attrs['aria-pressed'],'true');f.api.dispose();
});
test('sample playback preserves a valid 11.99-second tail seek',async()=>{
 const f=fixture(),n=f.roots[0].nodes;n.get('.sample-seek').value=11.99;n.get('.sample-seek').emit('input');n.get('.sample-play').emit('click');await settle();
 assert.equal(f.contexts[0].sources[0].started[1],11.99);assert.equal(n.get('.sample-seek').value,11.99);f.api.dispose();
});
for(const local of [false,true])test(`actual EOF still restarts ${local?'local':'sample'} playback from the beginning`,async()=>{
 const f=fixture();if(local)await f.load('short.wav',.05);const n=f.roots[0].nodes;n.get('.sample-seek').value=local ? .05 : 12;n.get('.sample-seek').emit('input');n.get('.sample-play').emit('click');await settle();
 assert.equal(local?f.media[0].currentTime:f.contexts[0].sources[0].started[1],0);f.api.dispose();
});

for(const local of [false,true])test(`natural ${local?'local':'sample'} end replays from zero on the next explicit Play`,async()=>{
 const f=fixture();if(local)await f.load('ending.wav',95);const n=f.roots[0].nodes;
 n.get('.sample-play').emit('click');await settle();
 if(local){f.media[0].currentTime=95;f.media[0].paused=true;f.media[0].onended();}
 else {f.contexts[0].currentTime=12;f.contexts[0].sources[0].onended();}
 assert.equal(n.get('.sample-play').attrs['aria-pressed'],'false');assert.equal(n.get('.sample-seek').value,local?95:12);
 n.get('.sample-play').emit('click');await settle();assert.equal(local?f.media[0].currentTime:f.contexts[0].sources.at(-1).started[1],0);assert.equal(n.get('.sample-play').attrs['aria-pressed'],'true');f.api.dispose();
});
for(const local of [false,true])test(`finished non-looping ${local?'local':'sample'} range replays from the selected start`,async()=>{
 const f=fixture();if(local)await f.load('range.wav',95);f.api.show('range');const n=f.roots[1].nodes;
 n.get('.sample-loop').checked=false;n.get('.sample-loop').emit('change');n.get('.sample-play').emit('click');await settle();
 if(local){f.media[0].currentTime=10;f.media[0].ontimeupdate();}
 else {f.contexts[0].currentTime=8;f.contexts[0].sources[0].onended();}
 assert.equal(n.get('.sample-play').attrs['aria-pressed'],'false');assert.equal(n.get('.sample-seek').value,local?10:6.2);
 n.get('.sample-play').emit('click');await settle();assert.equal(local?f.media[0].currentTime:f.contexts[0].sources.at(-1).started[1],local?0:3);assert.equal(n.get('.sample-loop').checked,false);f.api.dispose();
});

// DOM doubles do not establish actual screen-reader speech or browser
// accessible-name computation.
test('note delete names distinguish different text at the same timestamp without markup parsing',()=>{
 const f=fixture(),n=f.roots[2].nodes;
 n.get('.sample-seek').value=2.5;n.get('.sample-seek').emit('input');
 for(const text of ['First phrase','<img src=x onerror=alert(1)> & "second"']){
  n.get('.note-input').value=text;n.get('.note-form').emit('submit');
 }
 const rows=n.get('.sample-notes').children;
 assert.equal(rows.length,2);assert.equal(rows[0].children[0].textContent,rows[1].children[0].textContent);
 for(const row of rows){
  const [time,text,remove]=row.children;
  assert.equal(time.attrs['aria-label'],`${copy.en.seekNote}: ${time.textContent} — ${text.textContent}`);
  assert.equal(remove.attrs['aria-label'],`${copy.en.removeNote}: ${time.textContent} — ${text.textContent}`);
  assert.equal(remove.children.length,0);
 }
 assert.notEqual(rows[0].children[2].attrs['aria-label'],rows[1].children[2].attrs['aria-label']);f.api.dispose();
});
test('note delete names distinguish identical text at different timestamps',()=>{
 const f=fixture(),n=f.roots[2].nodes;
 for(const time of [1.25,2.5]){
  n.get('.sample-seek').value=time;n.get('.sample-seek').emit('input');
  n.get('.note-input').value='Same words';n.get('.note-form').emit('submit');
 }
 const rows=n.get('.sample-notes').children;
 assert.equal(rows[0].children[1].textContent,rows[1].children[1].textContent);
 assert.notEqual(rows[0].children[0].attrs['aria-label'],rows[1].children[0].attrs['aria-label']);
 assert.notEqual(rows[0].children[2].attrs['aria-label'],rows[1].children[2].attrs['aria-label']);f.api.dispose();
});
for(const [first,next] of [['en','zh'],['zh','en']])test(`note delete name translates ${first} to ${next} and removes only its own same-time note`,()=>{
 const f=fixture(),n=f.roots[2].nodes;f.env.t=key=>copy[first][key];f.api.translate();
 for(const text of ['Keep this note','Remove this note']){n.get('.note-input').value=text;n.get('.note-form').emit('submit');}
 let rows=n.get('.sample-notes').children;
 assert.equal(rows[1].children[0].attrs['aria-label'],`${copy[first].seekNote}: ${rows[1].children[0].textContent} — Remove this note`);
 assert.equal(rows[1].children[2].attrs['aria-label'],`${copy[first].removeNote}: ${rows[1].children[0].textContent} — Remove this note`);
 f.env.t=key=>copy[next][key];f.api.translate();rows=n.get('.sample-notes').children;
 assert.equal(rows[1].children[0].attrs['aria-label'],`${copy[next].seekNote}: ${rows[1].children[0].textContent} — Remove this note`);
 assert.equal(rows[1].children[2].attrs['aria-label'],`${copy[next].removeNote}: ${rows[1].children[0].textContent} — Remove this note`);
 rows[1].children[2].emit('click');rows=n.get('.sample-notes').children;
 assert.equal(rows.length,1);assert.equal(rows[0].children[1].textContent,'Keep this note');
 assert.equal(f.env.document.activeElement,n.get('.note-input'));f.api.dispose();
});

// Explicit source wiring plus the existing mounted-example DOM doubles.
for(const ready of [true,false])test(`workspace readiness ${ready} preserves note buttons, focus and unsent input`,async()=>{
 const f=fixture(),n=f.roots[2].nodes;
 n.get('.note-input').value='Saved note';n.get('.note-form').emit('submit');
 const row=n.get('.sample-notes').children[0],remove=row.children[2];remove.focus();
 n.get('.note-input').value='Unsent draft';
 let translations=0;const originalTranslate=f.api.translate;
 f.env.examples={translate(){translations++;originalTranslate();}};
 const link={};const originalQuery=f.env.document.querySelectorAll;
 f.env.document.querySelectorAll=selector=>selector==='[data-open]'?[link]:originalQuery(selector);
 f.env.workspaceReady=!ready;f.env.workspaceProbe=null;f.env.releaseURL='https://example.invalid/release';
 f.env.probeLocalWorkspace=async()=>ready;
 const paintLink=source.match(/function paintWorkspaceLink\(\) \{[\s\S]*?\n\}/)[0];
 const refresh=source.match(/function refreshWorkspaceLink\(\) \{[\s\S]*?\n\}/)[0];
 // Load the actual page translate too: the old refresh route must not pass by
 // failing to resolve translate. Its example translation would replace this row.
 const translate=source.match(/function translate\(\) \{[\s\S]*?\n\}/)[0];
 f.env.language='en';f.env.document.documentElement={};f.env.document.querySelector=()=>({setAttribute(){}});
 f.env.paintMusic=()=>{};f.env.paintMotion=()=>{};
 vm.runInContext(`${paintLink}\n${translate}\n${refresh}`,f.env);
 await vm.runInContext('refreshWorkspaceLink()',f.env);
 assert.equal(translations,0);assert.equal(n.get('.sample-notes').children[0],row);
 assert.equal(row.children[2],remove);assert.equal(f.env.document.activeElement,remove);
 assert.equal(n.get('.note-input').value,'Unsent draft');
 assert.equal(link.href,ready?'/':f.env.releaseURL);
 assert.equal(f.ids.get('heroInstallHint').textContent,ready?copy.en.localReady:copy.en.installBody);
 f.api.dispose();
});

for (const local of [false,true]) for (const language of ['en','zh']) {
 test(`${language} ${local?'local':'sample'} export blocks unfinished text without silently assigning a time`,async()=>{
  const f=fixture();if(local)await f.load();f.env.t=key=>copy[language][key];f.api.translate();const n=f.roots[2].nodes;
  n.get('.note-input').value='Saved note';n.get('.note-form').emit('submit');
  const before=n.get('.sample-notes').children.length;n.get('.note-input').value='Unfinished note';n.get('.note-input').emit('input');
  n.get('.note-export').emit('click');
  assert.equal(f.blobs.length,0);assert.equal(f.urls.length,local?1:0,'only the local media URL may exist');
  assert.equal(n.get('.sample-notes').children.length,before);assert.equal(n.get('.note-input').value,'Unfinished note');
  assert.equal(n.get('.note-status').textContent,copy[language].noteExportDraft);assert.equal(n.get('.note-input').attrs['aria-invalid'],'false');
  assert.equal(f.env.document.activeElement,n.get('.note-input'));assert.equal(wouldWarn(f),true);
  n.get('.sample-seek').value='4';n.get('.sample-seek').emit('input');n.get('.note-form').emit('submit');
  assert.equal(n.get('.note-status').textContent,'');n.get('.note-export').emit('click');
  const payload=JSON.parse(f.blobs.at(-1).parts[0]);assert.ok(JSON.stringify(payload).includes('Unfinished note'));
  assert.equal(payload.notes.at(-1).seconds,4);
  f.api.dispose();
 });
 test(`${language} ${local?'local':'sample'} full note list explains delete-or-clear choices and updates after deletion`,async()=>{
  const f=fixture();if(local)await f.load();f.env.t=key=>copy[language][key];f.api.translate();const n=f.roots[2].nodes;
  for(let i=0;i<20;i++){n.get('.note-input').value=`Note ${i}`;n.get('.note-form').emit('submit');}
  n.get('.note-input').value='Draft 21';n.get('.note-export').emit('click');
  assert.equal(f.blobs.length,0);assert.equal(n.get('.note-status').textContent,copy[language].noteExportLimit);
  n.get('.sample-notes').children[0].children[2].emit('click');
  assert.equal(n.get('.note-status').textContent,copy[language].noteExportDraft);assert.equal(n.get('.note-input').value,'Draft 21');
  n.get('.note-input').value='  ';n.get('.note-input').emit('input');assert.equal(n.get('.note-status').textContent,'');
  n.get('.note-export').emit('click');assert.equal(JSON.parse(f.blobs.at(-1).parts[0]).notes.length,19);
  f.api.dispose();
 });
}
test('local draft-only export is blocked while empty sample export remains natively disabled',async()=>{
 const f=fixture(),n=f.roots[2].nodes;assert.equal(n.get('.note-export').disabled,true);
 await f.load();assert.equal(n.get('.note-export').disabled,false);n.get('.note-input').value='Only a draft';n.get('.note-export').emit('click');
 assert.equal(f.blobs.length,0);assert.equal(n.get('.note-status').textContent,copy.en.noteExportDraft);f.api.dispose();
});
test('draft export guidance follows language switching and clears when input is cleared',async()=>{
 const f=fixture();await f.load();const n=f.roots[2].nodes;n.get('.note-input').value='Draft';n.get('.note-export').emit('click');
 f.env.t=key=>copy.zh[key];f.api.translate();assert.equal(n.get('.note-status').textContent,copy.zh.noteExportDraft);
 assert.equal(n.get('.note-input').value,'Draft');n.get('.note-input').value='\n\t ';n.get('.note-input').emit('input');
 assert.equal(n.get('.note-status').textContent,'');n.get('.note-export').emit('click');assert.equal(f.blobs.length,1);f.api.dispose();
});
test('blocked re-export preserves the previous download receipt without claiming the draft was saved',async()=>{
 const f=fixture();await f.load();const n=f.roots[2].nodes;n.get('.note-input').value='Committed';n.get('.note-form').emit('submit');
 n.get('.note-export').emit('click');assert.equal(f.blobs.length,1);assert.equal(f.ids.get('reviewConfirmExport').hidden,false);
 n.get('.note-input').value='Unfinished';n.get('.note-export').emit('click');assert.equal(f.blobs.length,1);
 f.ids.get('reviewConfirmExport').emit('click');assert.equal(wouldWarn(f),true);assert.equal(n.get('.note-input').value,'Unfinished');
 f.env.window.confirm=()=>false;assert.equal(f.api.resetSource(),false);f.api.dispose();
});

// Execute mountExamples' real handlers; model native disable-induced blur only.
// Visibility/connection and focusin events are controlled, not browser acceptance.
function rangeFocusFixture(f, action, { blur = true, afterDisable = () => {} } = {}) {
 const n=f.roots[1].nodes, origin=n.get('.range-time-'+action), target=n.get('.range-time-start'), doc=f.env.document;
 for(const node of [origin,target]){node.isConnected=true;node.visible=true;node.getClientRects=()=>node.visible?[{}]:[];}
 let disabled=origin.disabled;
 Object.defineProperty(origin,'disabled',{get(){return disabled;},set(value){const changed=value&&!disabled;disabled=value;
  if(changed){if(blur&&doc.activeElement===origin)doc.activeElement=doc.body;afterDisable();}
 }});
 const focus=target.focus.bind(target);target.focus=options=>{target.focusOptions=options;focus();};
 return {n,origin,target,doc,run(){if(action==='apply')n.get('.range-time-form').emit('submit',{submitter:origin});else origin.emit('click',{detail:0});}};
}
for(const local of [false,true])for(const action of ['apply','revert'])test(`range ${action} restores disable-blurred button focus (${local?'local':'sample'})`,async()=>{
 const f=fixture();if(local)await f.load();f.api.show('range');typeRange(f,'4','8');
 const h=rangeFocusFixture(f,action);h.origin.focus();h.run();
 assert.equal(h.origin.disabled,true);assert.equal(h.doc.activeElement,h.target);assert.equal(h.target.focusOptions.preventScroll,true);
 assert.equal(Number(h.n.get('.range-start').value),action==='apply'?4:local?0:3);
 assert.equal(Number(h.n.get('.range-end').value),action==='apply'?8:local?10:6.2);
 assert.equal(h.doc.listeners.has('focusin'),false);f.api.dispose();
});
for(const action of ['apply','revert'])for(const condition of ['input','other','retain','hidden-origin','detached-origin','hidden-target','detached-target','disabled-target','new-focus','moved-blurred'])test(`range ${action} preserves focus ownership: ${condition}`,()=>{
 const f=fixture();f.api.show('range');typeRange(f,'4','8');const other=f.env.$('reviewChoose');
 let h;h=rangeFocusFixture(f,action,{blur:condition!=='retain',afterDisable(){
  if(condition==='disabled-target')h.target.disabled=true;
  if(condition==='new-focus'||condition==='moved-blurred'){
   other.focus();h.doc.emit('focusin',{target:other});if(condition==='moved-blurred')h.doc.activeElement=h.doc.body;
  }
 }});
 h.origin.focus();
 if(condition==='input')h.target.focus();if(condition==='other')other.focus();
 if(condition==='hidden-origin')h.origin.visible=false;if(condition==='detached-origin')h.origin.isConnected=false;
 if(condition==='hidden-target')h.target.visible=false;if(condition==='detached-target')h.target.isConnected=false;
 h.run();
 const expected=condition==='input'?h.target:['other','new-focus'].includes(condition)?other:condition==='retain'?h.origin:h.doc.body;
 assert.equal(h.doc.activeElement,expected);
 assert.equal(h.doc.listeners.has('focusin'),false);f.api.dispose();
});
test('range invalid submit retains existing error-field focus and Escape retains input focus',()=>{
 const f=fixture();typeRange(f,'bad','8');const h=rangeFocusFixture(f,'apply');h.origin.focus();h.run();
 assert.equal(h.doc.activeElement,h.target);assert.equal(h.origin.disabled,false);assert.equal(h.target.attrs['aria-invalid'],'true');
 h.target.emit('keydown',{key:'Escape'});assert.equal(h.doc.activeElement,h.target);assert.equal(h.target.attrs['aria-invalid'],'false');
 assert.equal(h.doc.listeners.has('focusin'),false);f.api.dispose();
});
test('range unchanged Apply restores button focus without marking local review dirty',async()=>{
 const f=fixture();await f.load();typeRange(f,'0','10');const h=rangeFocusFixture(f,'apply');h.origin.focus();h.run();
 assert.equal(h.doc.activeElement,h.target);assert.equal(wouldWarn(f),false);f.api.dispose();
});
test('range Apply while playing preserves playback and the explicit new selection',async()=>{
 const f=fixture();f.api.show('range');const n=typeRange(f,'4','8');n.get('.sample-play').emit('click');await settle();
 const h=rangeFocusFixture(f,'apply');h.origin.focus();h.run();await settle();
 assert.equal(h.doc.activeElement,h.target);assert.equal(n.get('.sample-play').attrs['aria-pressed'],'true');
 assert.equal(f.contexts[0].sources.at(-1).loopStart,4);assert.equal(f.contexts[0].sources.at(-1).loopEnd,8);f.api.dispose();
});
test('range loading and no-draft early returns do not install focus observers',async()=>{
 const f=fixture();await f.load();typeRange(f,'4','8');const h=rangeFocusFixture(f,'apply');
 const loading=f.api.selectFile({name:'other.wav',size:100});h.origin.focus();h.run();assert.equal(h.doc.activeElement,h.origin);
 assert.equal(h.doc.listeners.has('focusin'),false);f.api.cancelImport();await loading;
 h.run();h.origin.focus();h.run();assert.equal(h.doc.activeElement,h.origin);assert.equal(h.doc.listeners.has('focusin'),false);f.api.dispose();
});
test('range render exception releases its focus observer without moving focus',()=>{
 const f=fixture();typeRange(f,'4','8');const h=rangeFocusFixture(f,'apply');h.origin.focus();
 h.n.get('canvas').getBoundingClientRect=()=>{throw new Error('controlled render failure');};
 assert.throws(()=>h.run(),/controlled render failure/);assert.equal(h.doc.listeners.has('focusin'),false);
 assert.equal(h.doc.activeElement,h.doc.body);f.api.dispose();
});

// Real range handlers and local player, with controlled DOM/media events.
// These are not native keyboard default-action or operating-system IME tests.
const protectedRangeEscapes = [
  ['composition', { isComposing: true }],
  ['IME boundary', { keyCode: 229, isComposing: false }],
  ['consumed', { defaultPrevented: true }],
  ...['ctrlKey', 'metaKey', 'altKey', 'shiftKey'].map(key => [key, { [key]: true }]),
];
for (const edge of ['start', 'end']) for (const playing of [false, true]) {
  for (const [name, flags] of protectedRangeEscapes) {
    test(`local ${edge} ${name} Escape preserves draft and ${playing ? 'playing' : 'paused'} state`, async () => {
      const f = fixture(); await f.load('escape.wav', 20); const n = f.roots[1].nodes, audio = f.media[0];
      if (playing) { n.get('.sample-play').emit('click'); await settle(); }
      audio.currentTime = 2.5;
      typeRange(f, '1:', '4');
      const before = [audio.currentTime, audio.paused, n.get('.range-start').value, n.get('.range-end').value,
        n.get('.range-time-status').textContent, n.get('.sample-play').attrs['aria-pressed']];
      let prevented = false;
      n.get('.range-time-' + edge).emit('keydown', { key: 'Escape', ...flags, preventDefault() { prevented = true; } });
      assert.equal(prevented, false);
      assert.equal(n.get('.range-time-start').value, '1:'); assert.equal(n.get('.range-time-end').value, '4');
      assert.equal(wouldWarn(f), true);
      assert.deepEqual([audio.currentTime, audio.paused, n.get('.range-start').value, n.get('.range-end').value,
        n.get('.range-time-status').textContent, n.get('.sample-play').attrs['aria-pressed']], before);
      f.api.dispose();
    });
  }
  test(`ordinary ${edge} Escape restores fields without changing ${playing ? 'playing' : 'paused'} audio`, async () => {
    const f = fixture(); await f.load('escape.wav', 20); const n = f.roots[1].nodes, audio = f.media[0];
    if (playing) { n.get('.sample-play').emit('click'); await settle(); }
    audio.currentTime = 2.5;
    const fields = [n.get('.range-time-start').value, n.get('.range-time-end').value];
    const before = [audio.currentTime, audio.paused, n.get('.range-start').value, n.get('.range-end').value];
    typeRange(f, '1:', '4'); let prevented = false;
    n.get('.range-time-' + edge).emit('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual([n.get('.range-time-start').value, n.get('.range-time-end').value], fields);
    assert.deepEqual([audio.currentTime, audio.paused, n.get('.range-start').value, n.get('.range-end').value], before);
    assert.equal(wouldWarn(f), false); assert.equal(n.get('.range-time-status').textContent, copy.en.rangeInputReverted);
    f.api.dispose();
  });
}
for (const edge of ['start', 'end']) for (const composing of [false, true]) {
  test(`local ${edge} Enter retains existing composition behavior (composing=${composing})`, async () => {
    const f = fixture(); await f.load('enter.wav', 20); const n = f.roots[1].nodes;
    typeRange(f, '1', '4'); let prevented = false;
    n.get('.range-time-' + edge).emit('keydown', { key: 'Enter', isComposing: composing, preventDefault() { prevented = true; } });
    assert.equal(prevented, composing);
    assert.equal(n.get('.range-time-start').value, '1'); assert.equal(n.get('.range-time-end').value, '4');
    assert.equal(n.get('.range-start').value, 0); assert.equal(n.get('.range-end').value, 10);
    if (!prevented) {
      // Explicitly dispatch submit, rather than pretending the DOM double
      // implements the browser's Enter default action.
      n.get('.range-time-form').emit('submit');
      assert.equal(n.get('.range-start').value, 1); assert.equal(n.get('.range-end').value, 4);
    }
    f.api.dispose();
  });
}

for (const edge of ['start', 'end']) for (const playing of [false, true]) {
  test(`local ${edge} IME-boundary Enter blocks conditional submit and preserves ${playing ? 'playing' : 'paused'} draft`, async () => {
    const f = fixture(); await f.load('enter-boundary.wav', 20); const n = f.roots[1].nodes, audio = f.media[0];
    if (playing) { n.get('.sample-play').emit('click'); await settle(); }
    audio.currentTime = 2.5;
    typeRange(f, '1', '4');
    const before = [audio.currentTime, audio.paused, n.get('.range-start').value, n.get('.range-end').value,
      n.get('.sample-play').attrs['aria-pressed']];
    let prevented = false, submits = 0;
    const submit = n.get('.range-time-form').listeners.get('submit');
    n.get('.range-time-form').listeners.set('submit', event => { submits++; return submit(event); });
    n.get('.range-time-' + edge).emit('keydown', { key: 'Enter', keyCode: 229, isComposing: false,
      preventDefault() { prevented = true; } });
    // Model only a potential implicit submission when keydown was not cancelled.
    // This does not prove which native browser/IME emits that default action.
    if (!prevented) n.get('.range-time-form').emit('submit');
    assert.equal(prevented, true); assert.equal(submits, 0);
    assert.equal(n.get('.range-time-start').value, '1'); assert.equal(n.get('.range-time-end').value, '4');
    assert.equal(wouldWarn(f), true);
    assert.deepEqual([audio.currentTime, audio.paused, n.get('.range-start').value, n.get('.range-end').value,
      n.get('.sample-play').attrs['aria-pressed']], before);
    // A later ordinary Enter still permits the explicit simulated submit.
    prevented = false;
    n.get('.range-time-' + edge).emit('keydown', { key: 'Enter', keyCode: 13, isComposing: false,
      preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    if (!prevented) n.get('.range-time-form').emit('submit');
    await settle();
    assert.equal(submits, 1); assert.equal(n.get('.range-start').value, 1); assert.equal(n.get('.range-end').value, 4);
    assert.equal(audio.paused, !playing);
    f.api.dispose();
  });
}

// Exercise each real visibility callback independently. Playback is real module
// logic; observer delivery, media and frame scheduling are controlled, not native.
for (const route of ['hidden', 'offscreen']) for (const pending of [false, true]) {
  test(`bottom ${route} callback independently pauses ${pending ? 'pending synthetic' : 'playing local'} audio and frames`, async () => {
    const f = fixture({ pending }), root = f.roots[0], n = root.nodes;
    if (!pending) await f.load('visibility.wav', 20);
    n.get('.sample-play').emit('click'); await settle();
    assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'true');
    if (!pending) assert.ok(f.pendingFrames > 0);
    const intersection = f.observers.find(observer => observer.targets.includes(root));
    assert.ok(intersection, 'production code observes the actual card');
    if (route === 'hidden') { f.env.document.hidden = true; f.env.document.emit('visibilitychange'); }
    else intersection.cb([{ target: root, isIntersecting: false }]);
    assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'false');
    assert.equal(f.pendingFrames, 0);
    if (pending) {
      f.resume(); await settle();
      assert.equal(f.contexts[0].sources.length, 0, 'late resume cannot start audio');
    } else assert.equal(f.media[0].paused, true);
    const drawn = f.drawn;
    for (let i = 0; i < 10; i++) f.tick();
    assert.equal(f.drawn, drawn); assert.equal(f.pendingFrames, 0);
    if (route === 'hidden') { f.env.document.hidden = false; f.env.document.emit('visibilitychange'); }
    else intersection.cb([{ target: root, isIntersecting: true }]);
    assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'false');
    assert.equal(f.pendingFrames, 0, 'becoming visible cannot auto-resume');
    f.api.dispose();
  });
}

for (const route of ['hidden', 'offscreen']) {
  test(`bottom ${route} during local media.play pending rejects late success without auto-resuming`, async () => {
    const f = fixture(); await f.load('delayed.wav', 20);
    const root = f.roots[0], n = root.nodes, audio = f.media[0];
    let resolvePlay, pauses = 0;
    const originalPause = audio.pause.bind(audio);
    audio.pause = () => { pauses++; originalPause(); };
    // Model late native success making media active again. This tests cleanup,
    // not actual browser audio output or the timing of native play promises.
    audio.play = () => new Promise(resolve => { resolvePlay = () => { audio.paused = false; resolve(); }; });
    n.get('.sample-play').emit('click'); await settle();
    assert.equal(typeof resolvePlay, 'function', 'must reach media.play, not remain in context.resume');
    assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'true');
    const intersection = f.observers.find(observer => observer.targets.includes(root));
    assert.ok(intersection);
    if (route === 'hidden') { f.env.document.hidden = true; f.env.document.emit('visibilitychange'); }
    else intersection.cb([{ target: root, isIntersecting: false }]);
    const pausesAfterHide = pauses;
    assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'false');
    assert.equal(f.pendingFrames, 0);
    resolvePlay(); await settle();
    assert.equal(audio.paused, true); assert.ok(pauses > pausesAfterHide, 'late active media must be paused again');
    assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'false');
    assert.equal(f.pendingFrames, 0);
    if (route === 'hidden') { f.env.document.hidden = false; f.env.document.emit('visibilitychange'); }
    else intersection.cb([{ target: root, isIntersecting: true }]);
    assert.equal(audio.paused, true); assert.equal(n.get('.sample-play').attrs['aria-pressed'], 'false');
    assert.equal(f.pendingFrames, 0, 'becoming visible cannot auto-resume');
    f.api.dispose();
  });
}
