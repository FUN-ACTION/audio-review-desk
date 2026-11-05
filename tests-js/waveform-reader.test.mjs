import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaveformReader } from '../src/audio_review_desk/static/waveform-reader.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0; const timers = new Map();
  return { AbortController, setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; }, clearTimeout(key) { timers.delete(key); }, get count() { return timers.size; },
    async tick(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!next) break; now=next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); } now=end; await flush(); } };
}
function setup(read, onChange = () => {}) {
  const runtime = clock(), reads = [], changes = [];
  const reader = createWaveformReader({ read: read || ((key, options) => { const wait=deferred(); reads.push({key,...options,...wait}); return wait.promise; }), onChange: value => { changes.push(value); onChange(value); } }, runtime);
  return {reader,runtime,reads,changes};
}
const owner = (key='A',selection=1) => ({key,selection});
const peaks = {a:[0,0.2,1],b:[]};
test('successful waveform read has a bounded timer and a single ready snapshot',async()=>{
  const h=setup(),promise=h.reader.load(owner()); assert.equal(h.runtime.count,1);
  assert.deepEqual(h.changes,[{...owner(),phase:'loading'}]);
  assert.deepEqual(Object.keys(h.reads[0]).sort(),['key','promise','reject','resolve','signal']);
  h.reads[0].resolve(peaks);assert.equal(await promise,true);
  assert.equal(h.runtime.count,0);assert.deepEqual(h.changes.at(-1),{...owner(),phase:'ready',data:peaks});
});
test('duplicate pending retries return one promise and issue one GET',async()=>{
  const h=setup(),first=h.reader.load(owner()),second=h.reader.load(owner());
  assert.equal(first,second);assert.equal(h.reads.length,1);assert.equal(h.changes.length,1);
  h.reads[0].resolve(peaks);await first;
});
for(const stage of ['fetch','body']) test(`eight-second waveform deadline includes a hanging ${stage}`,async()=>{
  const pending=deferred();let signal;
  const h=setup(async(key,options)=>{signal=options.signal;return stage==='fetch'?pending.promise:(await Promise.resolve({json:()=>pending.promise})).json();});
  const result=h.reader.load(owner());await flush();await h.runtime.tick(7999);assert.equal(h.changes.at(-1).phase,'loading');
  await h.runtime.tick(1);assert.equal(await result,false);assert.equal(h.changes.at(-1).phase,'error');assert.equal(h.changes.at(-1).error.code,'network');assert.equal(signal.aborted,true);assert.equal(h.runtime.count,0);
  pending.resolve(peaks);await flush();assert.equal(h.changes.length,2);
});
test('network failure remains actionable without any automatic retry',async()=>{
  const h=setup(),result=h.reader.load(owner());const error=Object.assign(new Error('offline'),{code:'network'});
  h.reads[0].reject(error);assert.equal(await result,false);await h.runtime.tick(60000);
  assert.equal(h.reads.length,1);assert.equal(h.changes.at(-1).error,error);assert.equal(h.runtime.count,0);
  const retry=h.reader.load(owner());assert.equal(h.reads.length,2);h.reads[1].resolve(peaks);assert.equal(await retry,true);
});
for(const mode of ['throw','reject']) test(`a synchronous read ${mode} terminates once without leaving a timer`,async()=>{
  const error=new Error('read failure'),h=setup(()=>{if(mode==='throw')throw error;return Promise.reject(error);});
  assert.equal(await h.reader.load(owner()),false);assert.equal(h.changes.at(-1).error,error);assert.equal(h.runtime.count,0);
});
for(const late of ['resolve','reject']) test(`cancel settles independently of abort and ignores a late ${late}`,async()=>{
  const h=setup(),result=h.reader.load(owner());h.reader.cancel();assert.equal(await result,false);
  assert.equal(h.reads[0].signal.aborted,true);assert.equal(h.runtime.count,0);assert.equal(h.changes.at(-1).phase,'interrupted');
  h.reads[0][late](late==='resolve'?peaks:new Error('late'));await flush();assert.equal(h.changes.length,2);
  h.reader.cancel();assert.equal(h.changes.length,2);
});
test('a new selection cancels the old read, including A-to-B-to-A',async()=>{
  const h=setup(),a=h.reader.load(owner()),b=h.reader.load(owner('B',2)),again=h.reader.load(owner('A',3));
  assert.equal(await a,false);assert.equal(await b,false);assert.equal(h.runtime.count,1);
  h.reads[2].resolve(peaks);assert.equal(await again,true);
  h.reads[0].resolve({a:[0.9],b:[]});h.reads[1].reject(new Error('obsolete'));await flush();
  assert.deepEqual(h.changes.map(row=>row.phase),['loading','loading','loading','ready']);assert.equal(h.changes.at(-1).selection,3);assert.equal(h.runtime.count,0);
});
test('timed-out earlier attempt cannot replace a manually retried result',async()=>{
  const h=setup(),first=h.reader.load(owner());await h.runtime.tick(8000);assert.equal(await first,false);
  const retry=h.reader.load(owner());h.reads[1].resolve(peaks);assert.equal(await retry,true);
  h.reads[0].resolve({a:[0.99],b:[]});await flush();assert.equal(h.changes.at(-1).data,peaks);assert.equal(h.changes.length,4);
});
test('valid empty arrays are a successful read, distinct from malformed payloads',async()=>{
  for(const data of [{a:[],b:[]},{a:[0],b:[]}]) { const h=setup(()=>data);assert.equal(await h.reader.load(owner()),true);assert.equal(h.changes.at(-1).data,data); }
  for(const data of [null,{},[],{a:[],b:null},{a:[NaN],b:[]},{a:[Infinity],b:[]},{a:['0.5'],b:[]}]) { const h=setup(()=>data);assert.equal(await h.reader.load(owner()),false);assert.equal(h.changes.at(-1).phase,'error');assert.equal(h.runtime.count,0); }
});
test('cancelling a settled read does not discard ready peaks or publish an interruption',async()=>{
  const h=setup(()=>peaks);await h.reader.load(owner());h.reader.cancel();assert.equal(h.changes.length,2);assert.equal(h.changes.at(-1).phase,'ready');
});

for (const phase of ['loading','ready','error','interrupted']) test(`a throwing ${phase} callback cannot strand a read or its timer`, async () => {
  const h=setup(null,snapshot=>{if(snapshot.phase===phase)throw new Error('render failed')});
  const promise=h.reader.load(owner());
  if(phase==='ready')h.reads[0].resolve(peaks);
  if(phase==='error')h.reads[0].reject(new Error('network'));
  if(phase==='interrupted')assert.doesNotThrow(()=>h.reader.cancel());
  await flush();
  assert.equal(await Promise.race([promise,Promise.resolve('still pending')]),false);
  assert.equal(h.runtime.count,0);
  if(phase==='loading')assert.equal(h.reads.length,0);
  else assert.equal(h.reads[0].signal.aborted,true);
  if(phase==='interrupted'){h.reads[0].reject(new Error('late'));await flush();}
});

test('a ready render failure exposes one error snapshot and permits a clean manual retry', async () => {
  let broken=true;
  const h=setup(null,snapshot=>{if(snapshot.phase==='ready'&&broken)throw new Error('canvas unavailable')});
  const pending=h.reader.load(owner());h.reads[0].resolve(peaks);assert.equal(await pending,false);
  assert.deepEqual(h.changes.map(row=>row.phase),['loading','ready','error']);
  assert.equal(h.changes.at(-1).error.message,'canvas unavailable');assert.equal(h.runtime.count,0);
  broken=false;const retry=h.reader.load(owner());h.reads[1].resolve(peaks);assert.equal(await retry,true);assert.equal(h.changes.at(-1).phase,'ready');
});
test('a broken error renderer is attempted at most once after loading fails', async () => {
  const h=setup(null,()=>{throw new Error('DOM unavailable')});
  assert.equal(await h.reader.load(owner()),false);assert.deepEqual(h.changes.map(row=>row.phase),['loading','error']);assert.equal(h.reads.length,0);assert.equal(h.runtime.count,0);
});
