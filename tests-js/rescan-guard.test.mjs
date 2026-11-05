import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Authored but NOT RUN. Actual handlers/discard logic with deterministic doubles;
// not a browser, transport, native modal, or backend concurrency test.
const source=readFileSync(new URL('../src/audio_review_desk/static/workbench.js',import.meta.url),'utf8');
function extract(a,b){const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x);return source.slice(x,y);}
const code=[extract('function paintRescanReceipt()','for (const name of issueNames)'),extract('let discardResolver = null;','const importing ='),
 extract('function showImportError(','function renderJob('),
 extract('async function startImport(','function markBoundary('),
 extract('async function browse(','$("chooseFiles").addEventListener'),
 extract('$("rescan").addEventListener','$("language").addEventListener')].join('\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const validRescan=(letter='a')=>({id:letter.repeat(32),state:'running',phase:'reading',done:0,total:0,label:'folder',error:null,error_code:null});
function setup({dirty=false,postImpl=async()=>validRescan()}={}){
 const nodes=new Map(),calls=[],accepted=[],notices=[],renders=[],clears=[],control={failRender:false};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{open:false,value:'',checked:true,hidden:false,dataset:{},textContent:'',focus(){},addEventListener(type,fn){this[type]=fn;}});return nodes.get(id);};
 $('importDialog').open=true;$('importKind').value='directory';$('importPath').value='/keep/new-input';
 const env={$,control,initialDirty:dirty,post:async(path,payload)=>{calls.push([path,payload]);return postImpl(path,payload);},
  t:key=>key,errorText:error=>error.code||'error',accepted,notices,renders,clears,
  openDialog:n=>{n.open=true;},closeDialog:n=>{n.open=false;}};
 const api=Function(...Object.keys(env),`let busy=false,choosing=false,language='en',noticeGeneration=0,refreshGeneration=0,job=null,dirty=initialDirty;
  const state={items:[{}],can_rescan:true},selected={};
  const importing=()=>job&&['running','cancelling'].includes(job.state);
  const draftSession={discardCurrent(){clears.push('draft');}};
  function renderDetails(restore){clears.push(['render',restore]);}
  function renderSummary(){renders.push(rescanSubmitting);if(control.failRender){control.failRender=false;throw new Error('render failed');}}
  function acceptJob(next){job=next;accepted.push(next);}
  function notice(message){noticeGeneration++;notices.push(typeof message==='function'?message():message);}
  ${code}
  return {browse,startImport,openImport,notify:notice,get locked(){return rescanSubmitting;},get dirty(){return dirty;},
    translateReceipt:paintRescanReceipt,
    confirm(value){const resolve=discardResolver;discardResolver=null;$('discardDialog').open=false;resolve(value);},
    change(kind){if(kind==='review')refreshGeneration++;if(kind==='input')importEditGeneration++;if(kind==='session')importDialogGeneration++;if(kind==='job')job={id:'other',state:'running'};},
    clearJob(){job=null;}};`)(...Object.values(env));
 return {api,$,calls,accepted,notices,renders,clears,control,rescan:()=>$('rescan').click(),submit:()=>api.startImport({preventDefault(){}})};
}
test('same-turn rescan calls share one confirmation and one POST',async()=>{
 const h=setup({dirty:true});const a=h.rescan(),b=h.rescan();assert.equal(h.api.locked,true);assert.equal(h.calls.length,0);
 h.api.confirm(true);await Promise.all([a,b]);assert.deepEqual(h.calls,[['/api/rescan',{}]]);assert.equal(h.accepted.length,1);assert.equal(h.api.locked,false);
});
test('cancel leaves draft untouched and permits an explicit later rescan',async()=>{
 const h=setup({dirty:true});const first=h.rescan();h.api.confirm(false);await first;
 assert.equal(h.calls.length,0);assert.deepEqual(h.clears,[]);assert.equal(h.api.dirty,true);assert.equal(h.api.locked,false);
 const next=h.rescan();h.api.confirm(true);await next;assert.equal(h.calls.length,1);
});
for(const kind of ['review','input','session','job'])test(`${kind} change before discard confirmation prevents cleanup and POST`,async()=>{
 const h=setup({dirty:true});const p=h.rescan();h.api.change(kind);h.api.confirm(true);await p;
 assert.deepEqual(h.clears,[]);assert.equal(h.api.dirty,true);assert.equal(h.calls.length,0);assert.equal(h.api.locked,false);
});
test('POST failure releases lock for explicit retry only',async()=>{
 let count=0;const h=setup({postImpl:async()=>{if(!count++)throw {code:'network'};return validRescan('b');}});
 await h.rescan();assert.equal(h.calls.length,1);assert.equal(h.api.locked,false);assert.deepEqual(h.notices,['rescanReceiptUnconfirmed']);
 await h.rescan();assert.equal(h.calls.length,2);assert.equal(h.accepted[0].id,'b'.repeat(32));
});
test('initial render failure still releases rescan lock',async()=>{
 const h=setup();h.control.failRender=true;await assert.rejects(h.rescan(),/render failed/);
 assert.equal(h.api.locked,false);assert.equal(h.calls.length,0);await h.rescan();assert.equal(h.calls.length,1);
});
test('rescan blocks import submit, picker and new opening without touching existing form',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.rescan();await tick();
 await h.submit();await h.api.browse('directory',true);assert.equal(await h.api.openImport(),false);
 assert.equal(h.$('importDialog').open,true);assert.equal(h.$('importPath').value,'/keep/new-input');assert.equal(h.calls.length,1);
 wait.resolve(validRescan('c'));await p;assert.equal(h.accepted[0].id,'c'.repeat(32));
});
test('manual import owns submission first and retains close/reopen behavior',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.submit();await h.rescan();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'/api/import');
 h.$('importDialog').open=false;assert.equal(await h.api.openImport(),true);
 h.$('importPath').value='/newer';h.api.change('input');wait.resolve({id:'import',state:'running'});await p;
 assert.equal(h.$('importDialog').open,true);assert.equal(h.$('importPath').value,'/newer');assert.equal(h.accepted[0].id,'import');
});
test('picker owns the lock through selection before rescan can enter',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.api.browse('directory',true);await h.rescan();await tick();
 assert.deepEqual(h.calls.map(row=>row[0]),['/api/browse']);wait.resolve({path:null});await p;assert.equal(h.api.locked,false);
});
test('opening already suspended before rescan cannot reopen a dialog after scanning starts',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});h.$('importDialog').open=false;
 const opening=h.api.openImport(),scan=h.rescan();assert.equal(await opening,false);await tick();assert.equal(h.$('importDialog').open,false);
 wait.resolve(validRescan('c'));await scan;
});
test('late accepted rescan is observed despite new edits and notifications',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.rescan();await tick();
 h.api.change('review');h.api.change('input');h.api.notify('newer');wait.resolve(validRescan('d'));await p;
 assert.equal(h.accepted[0].id,'d'.repeat(32));assert.deepEqual(h.notices,['newer']);
});
test('late rescan failure does not overwrite a newer notification',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.rescan();await tick();h.api.notify('newer');
 wait.reject({code:'network'});await p;assert.deepEqual(h.notices,['newer']);assert.equal(h.api.locked,false);
});
test('unsettled POST remains locked without timers, retry or timeout release',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.rescan();await tick();await h.rescan();await h.submit();
 assert.equal(h.api.locked,true);assert.equal(h.calls.length,1);wait.resolve(validRescan());await p;assert.equal(h.api.locked,false);
});

// Receipt regressions are authored but NOT RUN. The source endpoint returns its
// initial reading/0 snapshot under the same lock used by progress().
test('late network outcome is retained in both receipt views without replacing newer notice',async()=>{
 const wait=deferred(),h=setup({postImpl:()=>wait.promise});const p=h.rescan();await tick();h.api.notify('newer');
 wait.reject({code:'network',message:'/private/path and raw exception'});await p;
 const canonical=h.$('rescanSubmissionReceipt');assert.equal(canonical.dataset.outcome,'unconfirmed');
 assert.deepEqual(Object.keys(canonical.dataset),['outcome']);assert.deepEqual(h.notices,['newer']);
 for(const id of ['rescanSubmissionReceipt','rescanSubmissionReceiptDialog']){
  assert.equal(h.$(id).hidden,false);assert.equal(h.$(id+'Text').textContent,'rescanReceiptUnconfirmed');
 }
 assert.equal(h.$('importPath').value,'/keep/new-input');assert.equal(h.$('importDialog').open,true);
 assert.deepEqual(h.accepted,[]);
});
for(const value of [null,{},[],{id:'not-a-job',state:'running'}, {...validRescan(),state:'succeeded'}, {...validRescan(),error_code:'unexpected'}]){
 test(`malformed/unexpected rescan body stays unconfirmed: ${JSON.stringify(value)}`,async()=>{
  const h=setup({postImpl:async()=>value});await h.rescan();
  assert.equal(h.$('rescanSubmissionReceipt').dataset.outcome,'unconfirmed');assert.deepEqual(h.accepted,[]);
  assert.equal(h.calls.length,1);assert.equal(h.api.locked,false);
 });
}
test('valid rescan response is accepted and receipt does not retain its ID or label',async()=>{
 const next=validRescan(),h=setup({postImpl:async()=>next});await h.rescan();
 assert.equal(h.accepted[0],next);assert.deepEqual(h.$('rescanSubmissionReceipt').dataset,{outcome:'accepted'});
 assert.equal(h.$('rescanSubmissionReceiptText').textContent,'rescanReceiptAccepted');
});
test('next pending rescan and cancelled confirmation do not erase earlier returned receipt',async()=>{
 const h=setup({dirty:true});h.$('rescanSubmissionReceipt').dataset.outcome='unconfirmed';h.api.translateReceipt();
 const pending=h.rescan();assert.equal(h.$('rescanSubmissionReceipt').dataset.outcome,'unconfirmed');
 h.api.confirm(false);await pending;assert.equal(h.calls.length,0);assert.equal(h.$('rescanSubmissionReceipt').dataset.outcome,'unconfirmed');
});

for(const phase of ['decoding','saving'])test(`synthetic ${phase} snapshot is accepted for compatibility, not a current-server response claim`,async()=>{
 const next={...validRescan(),phase,done:1,total:2},h=setup({postImpl:async()=>next});await h.rescan();
 assert.equal(h.accepted[0],next);assert.equal(h.$('rescanSubmissionReceipt').dataset.outcome,'accepted');
});
