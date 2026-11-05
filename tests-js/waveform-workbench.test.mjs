import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOnce } from '../src/audio_review_desk/static/read-once.js';
import { createWaveformReader } from '../src/audio_review_desk/static/waveform-reader.js';
import { words } from '../src/audio_review_desk/static/copy.js';
import { playbackRange } from '../src/audio_review_desk/static/ui.js';

// Actual request, notice, select/refresh, waveform status/retry, view-switch,
// translation and page lifecycle code. DOM/media/time doubles are not native QA.
const file = process.env.ARD_WAVE_WORKBENCH || fileURLToPath(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url));
const source = readFileSync(file,'utf8'), html=readFileSync(resolve(dirname(file),'workbench.html'),'utf8');
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`${start} / ${end}`);return source.slice(a,b);}
const code=[
  extract('function notice(', 'const post ='),
  extract('let discardResolver =','function translate()'),
  extract('function translate()','for (const name of issueNames)'),
  extract('function markDirty()','function range()'),
  extract('function range()','function syncGlider('),
  extract('async function select(item','async function save('),
  extract('function showCompletion(','async function batch()'),
  extract('async function switchVariant(next)','function showImportError('),
  source.includes('$("retryWave").addEventListener') ? extract('$("retryWave").addEventListener','$("keepEditing").addEventListener') : '',
  extract('for (const [id, visible]','for (const [id, kind]'),
  extract('window.addEventListener("pagehide", (event)','document.addEventListener("visibilitychange", () => {\n  spectrumView'),
].join('\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve()};
function clock(){let now=0,id=0;const timers=new Map();return {AbortController,setTimeout(fn,delay){const key=++id;timers.set(key,{fn,at:now+delay});return key},clearTimeout(key){timers.delete(key)},get count(){return timers.size},async tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await tick()}now=end;await tick()}}}
const item=(key,decoded=true)=>({key,label:`Clip ${key}`,quality:{decoded,duration:10},reference_quality:{decoded:true,duration:9.96},review:{note:`Saved ${key}`,score:0,trim_start:null,trim_end:null,markers:[],issues:[],version:1}});
const catalog=(items=[item('A'),item('B')])=>({workspace_id:'wave-test',items,stats:{files:items.length,review_counts:{pending:items.length,pass:0},human_approved_seconds:0}});
const peaks={a:[0,0.2,0.1],b:[0.5,0,0.3]};
function setup(){
  const runtime=clock(),nodes=new Map(),reads=[],effects=[],renders=[],draws=[],focuses=[],listeners={};
  const document={documentElement:{},body:null,activeElement:null,querySelectorAll(){return []}};
  const $=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',hidden:false,disabled:false,style:{},dataset:{},attributes:{},elements:[],listeners:{},classList:{add(){},toggle(){}},
    addEventListener(type,fn){this.listeners[type]=[...(this.listeners[type]||[]),fn]},fire(type){let result;for(const fn of this.listeners[type]||[])result=fn({target:this});return result},setCustomValidity(){},setAttribute(key,value){this.attributes[key]=String(value)},
    contains(node){return node===this||Boolean(node?.parentElement&&this.contains(node.parentElement))},
    focus(options){document.activeElement=this;focuses.push({id,options})},querySelector(){return null},querySelectorAll(){return []},reportValidity(){return true}});return nodes.get(id)};
  document.body=$('body');document.activeElement=document.body;
  $('detailPanel').hidden=false;$('queueComplete').hidden=true;$('reviewForm').elements=[$('note'),$('score'),$('trimStart'),$('trimEnd')];
  const media={currentTime:0,paused:true,src:'',cancel(){effects.push('media.cancel')},pause(){this.paused=true;effects.push('media.pause')},load(options){this.src=options.url;this.currentTime=options.time??this.currentTime;effects.push(['media.load',options])}};
  const waveformView={cancelDrag(){},zoom:1,center:0,reset(){this.zoom=1;this.center=0;effects.push('wave.reset')},set(...args){draws.push(args)},position(value){effects.push(['wave.position',value])}};
  const noop=()=>{};
  const env={
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    $,document,words,initial:catalog(),runtime,AbortController,playbackRange,
    readOnce:options=>readOnce(options,runtime),createWaveformReader:options=>createWaveformReader(options,runtime),setTimeout:runtime.setTimeout,clearTimeout:runtime.clearTimeout,
    fetch(path,options){const wait=deferred(),body=deferred();reads.push({path,signal:options?.signal,reject:wait.reject,resolve(value,ok=true){wait.resolve({ok,json:()=>Promise.resolve(value)})},headers(){wait.resolve({ok:true,json:()=>body.promise})},body});return wait.promise},
    reveal:noop,errorText:error=>error.message||error.code||'operation_failed',
    sessionStorage:{getItem:()=>null,setItem:noop},localStorage:{getItem:()=>null,setItem:noop},matchMedia:()=>({matches:false}),
    audition:{check:noop,cancel(){effects.push('audition.cancel')}},rememberPosition:noop,media,
    player:{pause(){effects.push('player.pause')},removeAttribute:noop,load(){effects.push('player.load')}},waveformView,
    spectrumView:{setSource(...args){effects.push(['spectrum.source',...args])},setVisible:noop,setLanguage:noop,dispose:noop},
    renderSummary:noop,renderQueue:noop,updateLibraryToggle:noop,invalidateHistory:noop,updateIssueCount:noop,
    markersView:{hasChanges:()=>false,refresh:noop},transport:{refresh:noop},openDialog(){effects.push('discard.dialog')},
    sameReview:(a,b)=>a.note===b.note,reviewPayload:(target,values)=>({...target.review,...values}),
    resumedTime:()=>1.5,precise:value=>String(value),formatTime:value=>String(value),renderJob:noop,
    window:{addEventListener(type,fn){listeners[type]=fn}},jobPoller:{stop:noop,start:noop},
    afterRender(restore,selected){renders.push({restore,key:selected?.key});if(!selected)return;$('detailPanel').hidden=false;$('queueComplete').hidden=true;if(restore){$('note').value=selected.review.note;$('score').value=String(selected.review.score??'');$('trimStart').value=selected.review.trim_start??'';$('trimEnd').value=selected.review.trim_end??''}},
  };
  const control=Function(...Object.keys(env),`
    let state=initial,selected=state.items[0],dirty=false,busy=false,variant='a',wave={a:[],b:[]},generation=0,
      refreshGeneration=0,refreshController=null,refreshRead=null,pendingCompletion=null,suspendedCompletion=null,
      spectrumVisible=false,noticeTimer=null,language='en',job=null;
    const selectedKeys=new Set(); let listeningMemory={get:()=>({})};
    const t=key=>words[language][key]||key; const number=value=>String(value).trim()===''?null:Number(value);
    function visibleItems(){return state.items} function draftValues(){return {note:$('note').value}}
    function renderDetails(restore=true){afterRender(restore,selected);drawWave();if(typeof renderWaveStatus==='function')renderWaveStatus()}
    ${code}
    return {select,refresh,showCompletion,switchVariant,renderDetails,setBusy,
      translate(next){language=next;translate()},notice,
      edit(note){$('note').value=note;markDirty()},answerDiscard(allowed){const resolve=discardResolver;discardResolver=null;resolve(allowed)},
      get current(){return {selected,dirty,busy,variant,wave,generation,phase:typeof waveStatus==='undefined'?null:waveStatus?.phase}},
      repaint(){drawWave();if(typeof renderWaveStatus==='function')renderWaveStatus()}
    };
  `)(...Object.values(env));
  return {$,document,runtime,reads,effects,renders,draws,focuses,listeners,media,waveformView,...control,get current(){return control.current},
    retry:()=>$('retryWave').fire('click'),start:()=>control.select(control.current.selected),
    protectedState:()=>({note:$('note').value,score:$('score').value,trimStart:$('trimStart').value,trimEnd:$('trimEnd').value,markers:$('markerText').value,issues:$('issues').value,
      selected:control.current.selected,dirty:control.current.dirty,variant:control.current.variant,src:media.src,time:media.currentTime,paused:media.paused,zoom:waveformView.zoom,center:waveformView.center})};
}
async function failInitial(h){const pending=h.start();await tick();h.reads[0].reject(new Error('offline'));assert.equal(await pending,false);return h}
function assertRetry(h){const result=h.retry();assert.equal(h.reads.at(-1).path,`/api/wave/${h.current.selected.key}`);return result}

test('waveform status has its own live text and native non-submit retry control',()=>{
  assert.match(html,/<p\b[^>]*id="waveStatusText"[^>]*role="status"[^>]*tabindex="-1"/);
  assert.match(html,/<button\b[^>]*id="retryWave"[^>]*type="button"/);
  assert.match(html,/<p\b[^>]*id="analysisStatus"[^>]*role="status"/);
});
test('selection shows loading, then a local error and the existing global failure',async()=>{
  const h=setup(),pending=h.start();await tick();assert.equal(h.$('waveStatusText').textContent,words.en.waveLoading);
  assert.equal(h.$('retryWave').attributes['aria-disabled'],'true');
  h.reads[0].reject(new Error('offline'));assert.equal(await pending,false);assert.equal(h.current.phase,'error');
  assert.equal(h.$('waveStatusText').textContent,words.en.waveError);assert.equal(h.$('notice').textContent,'network');assert.equal(h.$('retryWave').attributes['aria-disabled'],'false');
});
test('retry keeps dirty form values, A/B media intent and zoom while updating current peaks',async()=>{
  for(const paused of [false,true]){
    const h=await failInitial(setup());await h.switchVariant('b');h.edit('Unsent draft');
    Object.assign(h.$('score'),{value:'0'});h.$('trimStart').value='2.00000001';h.$('trimEnd').value='';h.$('markerText').value='Uncommitted note';h.$('issues').value='noise';
    Object.assign(h.media,{paused,currentTime:5.4321});Object.assign(h.waveformView,{zoom:4,center:6.2});
    const before=h.protectedState(),renderCount=h.renders.length,effects=h.effects.length,pending=assertRetry(h);
    assert.equal(h.reads.length,2,'retry performs one independent GET');h.reads[1].resolve(peaks);assert.equal(await pending,true);
    assert.deepEqual(h.protectedState(),before);assert.equal(h.renders.length,renderCount);
    assert.deepEqual(h.effects.slice(effects),[['wave.position',5.4321]]);assert.deepEqual(h.draws.at(-1),[peaks.b,10,2.00000001,10,9.96]);
    assert.equal(h.$('notice').textContent,'');assert.equal(h.$('waveStatusText').textContent,words.en.waveReady);
  }
});
test('retry does not clear failure at start and ignores duplicate clicks while loading',async()=>{
  const h=await failInitial(setup()),pending=assertRetry(h);assert.equal(h.reads.length,2);assert.equal(h.$('notice').textContent,'network');h.retry();h.retry();assert.equal(h.reads.length,2);
  h.reads[1].reject(new Error('offline again'));assert.equal(await pending,false);assert.equal(h.$('retryWave').attributes['aria-disabled'],'false');assert.equal(h.$('notice').textContent,'network');
  const again=h.retry();assert.equal(h.reads.length,3);h.reads[2].resolve(peaks);assert.equal(await again,true);
});
for(const feedback of ['Saved newest review','network'])test(`successful retry preserves a newer ${feedback==='network'?'identical-text':'different'} notice`,async()=>{
  const h=await failInitial(setup()),pending=assertRetry(h);assert.equal(h.reads.length,2);h.notice(feedback);h.reads[1].resolve(peaks);await pending;assert.equal(h.$('notice').textContent,feedback);
});
test('retry success moves only its still-focused button to the persistent status text',async()=>{
  const h=await failInitial(setup());h.$('retryWave').focus();const pending=assertRetry(h);assert.equal(h.reads.length,2);
  assert.equal(h.document.activeElement,h.$('retryWave'));assert.equal(h.$('retryWave').disabled,false);
  h.reads[1].resolve(peaks);await pending;assert.equal(h.document.activeElement,h.$('waveStatusText'));assert.equal(h.$('retryWave').hidden,true);assert.equal(h.$('waveStatus').hidden,false);assert.deepEqual(h.focuses.at(-1).options,{preventScroll:true});
});
test('background success never steals newer focus, and a failed retry retains button focus',async()=>{
  const h=await failInitial(setup());h.$('retryWave').focus();const first=assertRetry(h);assert.equal(h.reads.length,2);h.reads[1].reject(new Error('again'));await first;assert.equal(h.document.activeElement,h.$('retryWave'));
  const retry=h.retry();h.$('note').focus();h.reads[2].resolve(peaks);await retry;assert.equal(h.document.activeElement,h.$('note'));
});
test('language and analysis-view switches retain wave recovery state and the draft',async()=>{
  const h=await failInitial(setup());h.edit('keep me');h.translate('zh');assert.equal(h.$('waveStatusText').textContent,words.zh.waveError);
  h.$('showSpectrogram').fire('click');assert.equal(h.$('waveStatus').hidden,true);h.$('showWaveform').fire('click');assert.equal(h.$('waveStatus').hidden,false);
  const pending=assertRetry(h);assert.equal(h.reads.length,2);h.translate('en');assert.equal(h.$('waveStatusText').textContent,words.en.waveLoading);h.reads[1].resolve(peaks);await pending;assert.equal(h.$('note').value,'keep me');
});
test('valid empty arrays have their own status and do not change successful selection semantics',async()=>{
  const h=setup(),pending=h.start();await tick();h.reads[0].resolve({a:[],b:[]});assert.equal(await pending,true);
  assert.equal(h.$('waveStatusText').textContent,words.en.waveEmpty);assert.equal(h.$('retryWave').hidden,false);assert.equal(h.$('retryWave').attributes['aria-disabled'],'false');
});
test('nondecoded selection hides retry and issues no waveform read',async()=>{
  const h=setup();await h.select(item('broken',false));assert.equal(h.$('waveStatus').hidden,true);h.retry();assert.equal(h.reads.length,0);
});
test('an A/B switch during loading draws the current variant after success',async()=>{
  const h=setup(),pending=h.start();await tick();await h.switchVariant('b');h.reads[0].resolve(peaks);await pending;
  assert.equal(h.current.variant,'b');assert.deepEqual(h.draws.at(-1),[peaks.b,10,0,10,9.96]);
});
test('late A-to-B-to-A outcomes cannot replace the current selection peaks or status',async()=>{
  const h=setup(),a=h.start();await tick();const b=h.select(item('B'));await tick();const again=h.select(item('A'));await tick();
  assert.equal(h.reads[0].signal?.aborted,true);assert.equal(h.reads[1].signal?.aborted,true);h.reads[2].resolve(peaks);await again;
  h.reads[0].resolve({a:[1],b:[1]});h.reads[1].reject(new Error('late'));await a;await b;assert.deepEqual(h.current.wave,peaks);assert.equal(h.$('waveStatusText').textContent,words.en.waveReady);
});
test('cancelled discard keeps the active waveform read and current draft',async()=>{
  const h=setup(),pending=h.start();await tick();h.edit('keep');const changed=h.select(item('B'));await tick();h.answerDiscard(false);await changed;
  assert.equal(h.reads[0].signal?.aborted,false);h.reads[0].resolve(peaks);assert.equal(await pending,true);assert.equal(h.$('note').value,'keep');assert.equal(h.current.dirty,true);
});
test('refresh waveform failure still returns false without replacing newer feedback after an edit',async()=>{
  const h=setup(),pending=h.refresh(true);h.reads[0].resolve(catalog());await tick();assert.equal(h.reads[1].path,'/api/wave/A');h.edit('new draft');h.notice('new save error');h.reads[1].reject(new Error('old wave'));assert.equal(await pending,false);
  assert.equal(h.$('notice').textContent,'new save error');assert.equal(h.$('note').value,'new draft');assert.equal(h.$('waveStatusText').textContent,words.en.waveError);
});
test('queue completion cancels the pending read; reopening offers retry without reselection',async()=>{
  const h=setup(),pending=h.start();await tick();h.showCompletion();assert.equal(h.reads[0].signal?.aborted,true);assert.equal(await pending,false);h.reads[0].resolve(peaks);await tick();assert.deepEqual(h.current.wave,{a:[],b:[]});
  h.renderDetails(false);assert.equal(h.$('waveStatusText').textContent,words.en.waveInterrupted);const retry=assertRetry(h);assert.equal(h.reads.length,2);h.reads[1].resolve(peaks);await retry;
});
test('empty refreshed catalog cancels a pending waveform even without another selection generation',async()=>{
  const h=setup(),pending=h.start();await tick();const refresh=h.refresh(true);h.reads[1].resolve(catalog([]));await refresh;assert.equal(h.reads[0].signal?.aborted,true);assert.equal(await pending,false);h.reads[0].resolve(peaks);await tick();assert.equal(h.current.selected,null);
});
test('pagehide settles and aborts the read; BFCache return retains actionable recovery',async()=>{
  const h=setup(),pending=h.start();await tick();h.listeners.pagehide({persisted:true});assert.equal(h.reads[0].signal?.aborted,true);assert.equal(await pending,false);assert.equal(h.runtime.count,0);
  h.listeners.pageshow({persisted:true});assert.equal(h.$('waveStatusText').textContent,words.en.waveInterrupted);const effects=h.effects.length,retry=assertRetry(h);assert.equal(h.reads.length,2);h.reads[1].resolve(peaks);await retry;assert.deepEqual(h.effects.slice(effects),[['wave.position',h.media.currentTime]]);
});
for(const stage of ['fetch','body'])test(`actual workbench request deadline recovers a hung ${stage} without media reload`,async()=>{
  const h=setup(),pending=h.start();await tick();if(stage==='body'){h.reads[0].headers();await tick()}
  await h.runtime.tick(8000);assert.equal(h.current.phase,'error');assert.equal(await pending,false);const effects=h.effects.length,retry=assertRetry(h);assert.equal(h.reads.length,2);h.reads[1].resolve(peaks);await retry;assert.deepEqual(h.effects.slice(effects),[['wave.position',h.media.currentTime]]);
  if(stage==='body')h.reads[0].body.resolve({a:[1],b:[]});else h.reads[0].resolve({a:[1],b:[]});await tick();assert.deepEqual(h.current.wave,peaks);
});

test('a failed peak renderer leaves an actionable status and can recover on retry',async()=>{
  const h=setup(),pending=h.start();await tick();const set=h.waveformView.set;
  h.waveformView.set=()=>{throw new Error('canvas unavailable')};h.reads[0].resolve(peaks);
  assert.equal(await pending,false);assert.equal(h.current.phase,'error');assert.equal(h.$('waveStatusText').textContent,words.en.waveError);assert.equal(h.$('retryWave').attributes['aria-disabled'],'false');
  h.waveformView.set=set;const retry=assertRetry(h);assert.equal(h.reads.length,2);h.reads[1].resolve(peaks);assert.equal(await retry,true);assert.equal(h.current.phase,'ready');
});
