import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJobPoller } from '../src/audio_review_desk/static/job-poller.js';
import { errorText } from '../src/audio_review_desk/static/errors.js';
import { words } from '../src/audio_review_desk/static/copy.js';
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const extract = (a,b) => source.slice(source.indexOf(a),source.indexOf(b));
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const flush = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
function clock(){let now=0,id=0;const timers=new Map();return {AbortController,
 setTimeout(fn,delay){timers.set(++id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},
 async tick(ms=0){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}};}
const running=(id='old')=>({id,state:'running',phase:'decoding',done:1,total:5,label:'synthetic.wav'});
// Real poller, notice, language handler and job callbacks; controlled reads/timers,
// no network, native rendering or assistive-technology acceptance.
function setup(){const runtime=clock(),reads=[],nodes=new Map();let renders=0;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:true,classList:{toggle(){}},addEventListener(type,fn){this[type]=fn;}});return nodes.get(id);};
 const env={$,errorText,words,createJobPoller:options=>createJobPoller(options,runtime),
 request:()=>{const d=deferred();reads.push(d);return d.promise;},renderJob:()=>renders++,invalidateRefresh(){},
 clearTimeout:runtime.clearTimeout,setTimeout:runtime.setTimeout,reveal(){},localStorage:{setItem(){}},loadHistory(){}};
 const h=Function(...Object.keys(env),`let language='en',noticeGeneration=0,noticeResolver=null,noticeTimer=null;
 let job=null,suspendedCompletion=null,refreshGeneration=0,dirty=false,handledJob=null,pendingCompletion=null;
 const t=key=>words[language][key];const importing=()=>job&&['running','cancelling'].includes(job.state);
 function translate(){if(noticeResolver)$('notice').textContent=noticeResolver();}
 ${extract('function notice(', 'async function request(')}
 ${extract('function createFeedbackOwner()', 'function invalidateRefresh()')}
 async function refresh(_force, {feedback}) { feedback.owner = createFeedbackOwner(); return true; }
 ${extract('let jobPollError =', 'async function startImport(')}
 ${extract('$("language").addEventListener', '$("refresh").addEventListener')}
 return {notice,acceptJob,start:options=>jobPoller.start(options),stop:()=>jobPoller.stop(),get job(){return job;},language(value){$('language').value=value;$('language').change();}};`)(...Object.values(env));
 return {...h,get job(){return h.job;},$,runtime,reads,get renders(){return renders;}};}
async function fail(h){h.start();await h.runtime.tick();h.reads.at(-1).reject({code:'network'});await flush();assert.equal(h.$('notice').hidden,false);}
async function recover(h,snapshot=running()){await h.runtime.tick(700);h.reads.at(-1).resolve(snapshot);await flush();}
for(const state of ['running','cancelling','idle'])test(`successful ${state} observation retires owned outage notice`,async()=>{
 const h=setup();await fail(h);await recover(h,{...running(),state});assert.equal(h.$('notice').hidden,true);h.stop();});
for(const newer of ['Saved later','Cancellation failed','Other warning'])test(`recovery preserves newer message: ${newer}`,async()=>{
 const h=setup();await fail(h);h.notice(newer);await recover(h);assert.equal(h.$('notice').textContent,newer);assert.equal(h.$('notice').hidden,false);h.stop();});
test('recovery preserves a newer localized message, even with identical text',async()=>{
 const h=setup();await fail(h);h.notice(()=>errorText({code:'network'},'en'));await recover(h);assert.equal(h.$('notice').hidden,false);h.stop();});
for(const state of ['succeeded','cancelled','failed'])test(`terminal ${state} replaces outage with its own outcome`,async()=>{
 const h=setup();await fail(h);await recover(h,{...running(),state,error_code:'no_audio'});
 assert.equal(h.$('notice').textContent,state==='succeeded'?words.en.jobDone:state==='cancelled'?words.en.jobCancelled:errorText({code:'no_audio'},'en'));h.stop();});
test('language changes translate the outage and preserve recovery ownership',async()=>{
 const h=setup();await fail(h);h.language('zh');assert.equal(h.$('notice').textContent,errorText({code:'network'},'zh'));await recover(h);assert.equal(h.$('notice').hidden,true);h.stop();});
test('language change of a newer message cannot restore old outage ownership',async()=>{
 const h=setup();await fail(h);h.notice(()=>words.zh.saved);h.language('zh');await recover(h);assert.equal(h.$('notice').textContent,words.zh.saved);h.stop();});
test('accepted new job clears old owned outage; old read cannot clear a newer outage',async()=>{
 const h=setup();await fail(h);await h.runtime.tick(700);const old=h.reads.at(-1);
 h.acceptJob(running('new'));assert.equal(h.$('notice').hidden,true);await h.runtime.tick(200);
 h.reads.at(-1).reject({code:'network'});await flush();old.resolve(running('old'));await flush();
 assert.equal(h.job.id,'new');assert.equal(h.$('notice').hidden,false);await recover(h,running('new'));assert.equal(h.$('notice').hidden,true);h.stop();});
test('accepted new job does not clear a later unrelated message',async()=>{
 const h=setup();await fail(h);h.notice('Saved later');h.acceptJob(running('new'));assert.equal(h.$('notice').textContent,'Saved later');await h.runtime.tick(200);h.reads.at(-1).resolve(running('new'));await flush();assert.equal(h.$('notice').textContent,'Saved later');h.stop();});
test('a second outage after recovery owns a fresh message',async()=>{
 const h=setup();await fail(h);await recover(h);await h.runtime.tick(700);h.reads.at(-1).reject({code:'network'});await flush();assert.equal(h.$('notice').hidden,false);await recover(h);assert.equal(h.$('notice').hidden,true);h.stop();});
