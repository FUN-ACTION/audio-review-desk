import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
// Production waveform/trim modules and actual workbench lifecycle/keyboard/save code.
// Deterministic pointer/canvas/media doubles are not native-browser acceptance.
const root=process.env.ARD_TRIM_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url));
const moduleURL=name=>pathToFileURL(resolve(root,'src/audio_review_desk/static',name));
const { mountWaveform }=await import(moduleURL('waveform.js'));
const { createTrimEditor }=await import(moduleURL('trim.js'));
const { playbackRange, reviewPayload, sameReview }=await import(moduleURL('ui.js'));
const { quietRange }=await import(moduleURL('audition.js'));
const source=readFileSync(moduleURL('workbench.js'),'utf8');
const extract=(a,b)=>{ const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end); };
const noop=()=>{};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const item=(key,duration,start,end)=>({key,id:key,label:key,source_id:'synthetic',source_start:0,source_end:duration,eligible:true,
 quality:{decoded:true,duration,flags:[],sample_rate:48000,channels:1,rms_dbfs:-12,peak:.5,leading_quiet_seconds:0,trailing_quiet_seconds:0},
 review:{version:1,status:'pending',score:null,trim_start:start,trim_end:end,note:'',issues:[],markers:[]}});
function setup(t,{echo=false}={}){
 const nodes=new Map(),docListeners=new Map(),writes=[],reads=[],events=[],editCalls=[];
 const document={documentElement:{},body:null,activeElement:null,
  addEventListener(type,fn){docListeners.set(type,[...(docListeners.get(type)||[]),fn]);},
  removeEventListener(type,fn){docListeners.set(type,(docListeners.get(type)||[]).filter(x=>x!==fn));},
  querySelector(selector){return selector==='input[name=decision]:checked'?radios.find(x=>x.checked):null;},
  querySelectorAll(selector){return selector==='input[name=decision]'?radios:[];},
  createElement(tag){return new Element(tag);}};
 class Element {
  constructor(id){this.id=id;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.style={};this.dataset={};this.attributes={};this.listeners={};this.children=[];this.elements=[];this.isConnected=true;this.textContent='';this.validity={badInput:false};this.captures=new Set();this.releases=[];this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,value)=>{const yes=value??!this.classes.has(k);yes?this.classes.add(k):this.classes.delete(k);return yes;},contains:k=>this.classes.has(k)};}
  get value(){return this._value;}set value(v){this._value=String(v);}
  setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}emit(k,props={}){const e={type:k,target:this,pointerId:1,clientX:0,preventDefault(){this.defaultPrevented=true;},...props};for(const fn of this.listeners[k]||[])fn(e);return e;}
  closest(){return null;}click(){if(!this.disabled)this.emit('click');}
  focus(){document.activeElement=this;if(this.onFocus)this.onFocus();}
  setPointerCapture(id){if(this.captureError)throw this.captureError;this.captures.add(id);if(this.onCapture)this.onCapture();}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){if(!this.captures.has(id))return;this.captures.delete(id);this.releases.push(id);this.emit('lostpointercapture',{pointerId:id});if(this.onRelease)this.onRelease();}
  getBoundingClientRect(){return {left:0,top:0,width:1000,height:100};}getClientRects(){return this.hidden?[]:[{}];}
  contains(node){return node===this;}querySelectorAll(){return [];}querySelector(){return null;}
  replaceChildren(...children){this.children=children;}append(...children){this.children.push(...children);}setCustomValidity(message){this.validationMessage=message;}reportValidity(){return true;}
 }
 const $=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
 const radios=['pending','pass','fix','exclude'].map(value=>Object.assign(new Element(value),{value,checked:value==='pending'}));
 document.body=$('body');document.activeElement=document.body;
 const canvas=$('waveform');canvas.clientWidth=1000;canvas.clientHeight=100;canvas.getContext=()=>({scale:noop,beginPath:noop,roundRect:noop,fill:noop});
 const globals=['document','ResizeObserver','devicePixelRatio','getComputedStyle'];const previous=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const [key,descriptor] of previous)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 globalThis.document=document;globalThis.ResizeObserver=class{observe(){}};globalThis.devicePixelRatio=1;globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});
 $('reviewForm').elements=['score','trimStart','trimEnd','note','save','saveNext'].map($);
 const initial={workspace_id:'synthetic',items:[item('A',10,2,8),item('B',20,4,18)],stats:{review_counts:{pending:2}}};
 let mounted,productionOnEdit;
 const productionMount=(...args)=>{const onEdit=args[4].onEdit;productionOnEdit=onEdit;args[4].onEdit=(...change)=>{editCalls.push(change);onEdit(...change);if(echo)mounted.set([],10,change[0],change[1]);};mounted=mountWaveform(...args);return mounted;};
 const env={$,document,initial,mountWaveform:productionMount,createTrimEditor,playbackRange,reviewPayload,sameReview,quietRange,
  t:key=>key,language:'en',formatTime:String,precise:String,number:value=>String(value).trim()===''?null:Number(value),
  player:{readyState:1,pause:noop,removeAttribute:noop,load:noop},media:{currentTime:0,cancel:noop,load:noop},
  audition:{cancel(){events.push({kind:'audition-cancel'});},check:noop},spectrumView:{setVisible:noop,setView:noop,setSource:noop},
  markersView:{view:noop,set:noop,refresh:noop,get:()=>[],hasChanges:()=>false,captureFocus:()=>null,flush:()=>true},
  waveformReader:{cancel:noop,load:async()=>true},draftSession:null,transport:{refresh:noop},
  renderSummary:noop,renderQueue:noop,renderExportScope:noop,renderWaveStatus:noop,syncGlider:noop,updateLibraryToggle:noop,
  rememberPosition:noop,invalidateHistory:noop,revealQueueSelection:noop,notice:noop,loadHistory:noop,
  sessionStorage:{setItem:noop},matchMedia:()=>({matches:false}),resumedTime:()=>0,
  createFeedbackOwner:()=>({publish:noop}),errorText:e=>e.message,
  post(path,payload){const wait=deferred();writes.push({path,payload,...wait});return wait.promise;},
  request(path){const wait=deferred();reads.push({path,...wait});return wait.promise;},
  events,
 };
 const code=`let state=initial,selected=state.items[0],busy=false,dirty=false,generation=0,refreshGeneration=0,variant='a',wave={a:[],b:[]},waveStatus=null,waveNotice=null,spectrumVisible=false,visibleCache=null,listeningMemory=null;
 const savedThisSession=new Set();
 function visibleItems(){return state.items;}
 function invalidateRefresh(){return ++refreshGeneration;}
 async function discardAllowed(current=()=>true){events.push({kind:'discard-check',dirty});return current()&&!dirty;}
 ${extract('function draftValues()','function canApplyReloadDraft(')}
 ${extract('function markDirty()','function syncGlider(')}
 const trimEditor=createTrimEditor({start:$('trimStart'),end:$('trimEnd'),duration:()=>selected?.quality.duration||0,onChange:markDirty});
 ${extract('const waveformView = mountWaveform(','const moveGlider =')}
 ${extract('function renderDetails(restore = true)','function revealQueueSelection()')}
 ${extract('function setBusy(value)','function showCompletion(')}
 ${extract('for (const [id, direction] of [','$("variantA").addEventListener')}
 ${extract('document.addEventListener("keydown", (event) => {','let theme =')}
 renderDetails(true);
 return {select,save,setBusy,view:waveformView,clearCatalogSelection(){${extract('      $("rememberPosition").checked = preferences.remember;','    for (const key of selectedKeys)').split('    }\n')[1]}},get current(){return {selected,busy,dirty,refreshGeneration,form:draftValues(),saved:selected?.review,saveState:$('saveState').textContent};},markDirty};`;
 const api=Function(...Object.keys(env),code)(...Object.values(env));
 return {$,document,api,writes,reads,events,initial,editCalls,directEdit:(...args)=>productionOnEdit(...args),key(key,flags={}){const event={key,code:key,target:document.activeElement,preventDefault(){this.defaultPrevented=true;},...flags};for(const fn of docListeners.get('keydown')||[])fn(event);return event;},gesture(side='start'){const handle=$(side==='start'?'trimStartHandle':'trimEndHandle');return {down:x=>handle.emit('pointerdown',{clientX:x}),move:x=>handle.emit('pointermove',{clientX:x}),up:()=>handle.emit('pointerup'),cancel:()=>handle.emit('pointercancel'),lost:()=>{handle.captures.delete(1);handle.emit('lostpointercapture');},handle};}};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

for(const side of ['start','end'])for(const sameGeometry of [false,true])test(`old ${side} gesture cannot cross actual J navigation; same geometry ${sameGeometry}`,async t=>{
 const h=setup(t),g=h.gesture(side);if(sameGeometry){Object.assign(h.initial.items[1].quality,{duration:10});Object.assign(h.initial.items[1].review,{trim_start:2,trim_end:8});}
 g.down(side==='start'?200:800);assert.equal(h.api.current.dirty,false);
 h.key('j');await tick();assert.equal(h.api.current.selected.key,'B');
 const before=structuredClone(h.api.current.form);g.move(side==='start'?500:700);
 assert.deepEqual(h.api.current.form,before);assert.equal(h.api.current.dirty,false);assert.equal(h.editCalls.length,0);
 assert.equal(g.handle.hasPointerCapture(1),false);assert.deepEqual(g.handle.releases,[1]);
});
for(const side of ['start','end'])for(const outcome of ['success','post-failure','catalog-failure'])test(`${side} gesture cancelled through Save ${outcome}`,async t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);const pending=h.api.save(false);
 assert.equal(h.writes.length,1);assert.equal(h.api.current.busy,true);assert.equal(g.handle.disabled,true);
 const submitted=structuredClone(h.writes[0].payload),before=structuredClone(h.api.current.form);
 g.move(side==='start'?500:600);assert.deepEqual(h.api.current.form,before);
 if(outcome==='post-failure')h.writes[0].reject(new Error('synthetic POST failure'));
 else{const saved={...h.initial.items[0].review,...submitted,version:2};h.writes[0].resolve({review:saved});await tick();assert.equal(h.reads.length,1);
  if(outcome==='catalog-failure')h.reads[0].reject(new Error('synthetic catalog failure'));
  else h.reads[0].resolve({...h.initial,items:[{...h.initial.items[0],review:saved},h.initial.items[1]]});}
 await pending;assert.equal(h.api.current.busy,false);assert.deepEqual(h.api.current.form,before);
 assert.equal(h.api.current.dirty,outcome==='post-failure');assert.equal(h.api.current.saveState,outcome==='post-failure'?'unsaved':'saved');
 if(outcome!=='post-failure')assert.equal(sameReview(reviewPayload(h.api.current.selected,h.api.current.form),h.api.current.saved),true);
 g.move(side==='start'?400:700);g.up();assert.deepEqual(h.api.current.form,before,'old gesture stays revoked after unlock');
 assert.equal(h.editCalls.length,0);assert.deepEqual(g.handle.releases,[1]);
});
for(const side of ['start','end'])test(`${side} empty catalog ownership cleanup cancels without editing/focus`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);const before=structuredClone(h.api.current.form),focus=h.document.activeElement;
 h.api.clearCatalogSelection();assert.equal(h.api.current.selected,null);assert.equal(g.handle.hasPointerCapture(1),false);
 g.move(500);assert.deepEqual(h.api.current.form,before);assert.equal(h.editCalls.length,0);assert.equal(h.document.activeElement,focus);
});
for(const side of ['start','end'])for(const action of ['cancelDrag','reset','duration','start','end'])test(`${side} ${action} revokes capture without a synthetic edit`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);g.move(side==='start'?300:700);
 const before=structuredClone(h.api.current.form),count=h.editCalls.length,focus=h.document.activeElement;
 if(action==='cancelDrag'||action==='reset')h.api.view[action]();
 else{const values=[10,Number(before.trimStart),Number(before.trimEnd)];values[{duration:0,start:1,end:2}[action]]+=.25;h.api.view.set([],...values);}
 assert.equal(h.editCalls.length,count);assert.deepEqual(h.api.current.form,before);assert.equal(h.document.activeElement,focus);
 assert.equal(g.handle.hasPointerCapture(1),false);assert.equal(g.handle.classes.has('dragging'),false);
 g.move(500);g.up();g.cancel();g.lost();assert.deepEqual(h.api.current.form,before);assert.equal(h.editCalls.length,count);assert.deepEqual(g.handle.releases,[1]);
});
for(const side of ['start','end'])for(const action of ['samples','reference-duration','position','repaint','echo'])test(`${side} same-geometry ${action} preserves ordinary dragging`,t=>{
 const h=setup(t,{echo:action==='echo'}),g=h.gesture(side);g.down(side==='start'?200:800);
 if(action==='samples')h.api.view.set([0,.5,0],10,2,8);
 if(action==='reference-duration')h.api.view.set([0,.5,0],10,2,8,30);
 if(action==='position')h.api.view.position(4);
 if(action==='repaint')h.api.view.repaint();
 g.move(side==='start'?300:700);g.move(side==='start'?400:600);
 assert.equal(h.editCalls.length,2);assert.equal(h.api.current.form[side==='start'?'trimStart':'trimEnd'],side==='start'?'4':'6');
 assert.equal(g.handle.hasPointerCapture(1),true);assert.equal(g.handle.classes.has('dragging'),true);g.up();assert.deepEqual(g.handle.releases,[1]);
});
for(const side of ['start','end'])test(`${side} wrong-pointer events do not edit or end the active gesture`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);
 for(const type of ['pointermove','pointerup','pointercancel','lostpointercapture'])g.handle.emit(type,{pointerId:2,clientX:500});
 assert.equal(h.editCalls.length,0);assert.equal(g.handle.hasPointerCapture(1),true);
 g.move(side==='start'?300:700);assert.equal(h.editCalls.length,1);g.up();
});
for(const side of ['start','end'])for(const pointerId of [undefined,null,-1,NaN,1.5])test(`${side} invalid pointer ID ${String(pointerId)} cannot begin editing`,t=>{
 const h=setup(t),g=h.gesture(side);g.handle.emit('pointerdown',{pointerId,clientX:side==='start'?200:800});g.handle.emit('pointermove',{pointerId,clientX:500});
 assert.equal(h.editCalls.length,0);assert.equal(g.handle.captures.size,0);assert.equal(g.handle.classes.has('dragging'),false);
});
for(const side of ['start','end'])for(const finish of ['up','cancel','lost'])test(`${side} ordinary ${finish} terminates only its current gesture`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);g.move(side==='start'?300:700);g[finish]();
 const before=structuredClone(h.api.current.form);g.move(500);assert.deepEqual(h.api.current.form,before);assert.equal(h.editCalls.length,1);
 assert.equal(g.handle.classes.has('dragging'),false);assert.equal(g.handle.captures.size,0);
});
for(const side of ['start','end'])test(`${side} capture failure leaves no ghost and next gesture succeeds`,t=>{
 const h=setup(t),g=h.gesture(side);g.handle.captureError=new DOMException('no active pointer','NotFoundError');g.down(side==='start'?200:800);g.move(500);
 assert.equal(h.editCalls.length,0);assert.equal(g.handle.classes.has('dragging'),false);assert.equal(g.handle.captures.size,0);
 g.handle.captureError=null;g.down(side==='start'?200:800);g.move(side==='start'?300:700);assert.equal(h.editCalls.length,1);g.up();
});
for(const side of ['start','end'])for(const during of ['onFocus','onCapture'])test(`${side} synchronous ${during} reset cannot reactivate cancelled drag`,t=>{
 const h=setup(t),g=h.gesture(side);g.handle[during]=()=>h.api.view.reset();g.down(side==='start'?200:800);g.move(500);
 assert.equal(h.editCalls.length,0);assert.equal(g.handle.classes.has('dragging'),false);assert.equal(g.handle.captures.size,0);assert.deepEqual(g.handle.releases,[1]);
});
for(const side of ['start','end'])test(`${side} stale loss event cannot cancel newly reacquired same pointer ID`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);h.api.view.cancelDrag();g.down(side==='start'?200:800);
 g.handle.emit('lostpointercapture',{pointerId:1});g.move(side==='start'?300:700);assert.equal(h.editCalls.length,1);assert.equal(g.handle.hasPointerCapture(1),true);g.up();
});
test('both handles clear before any synchronous release callback can edit',t=>{
 const h=setup(t),start=h.gesture('start'),end=h.gesture('end');start.down(200);end.handle.emit('pointerdown',{pointerId:2,clientX:800});
 start.handle.onRelease=()=>{end.handle.emit('pointermove',{pointerId:2,clientX:600});h.api.view.cancelDrag();};
 const before=structuredClone(h.api.current.form),focus=h.document.activeElement;h.api.view.cancelDrag();h.api.view.cancelDrag();
 assert.deepEqual(h.api.current.form,before);assert.equal(h.editCalls.length,0);assert.equal(h.document.activeElement,focus);
 assert.deepEqual(start.handle.releases,[1]);assert.deepEqual(end.handle.releases,[2]);
});
test('two active handle pointers remain independent and support subsequent ordinary drags',t=>{
 const h=setup(t),start=h.gesture('start'),end=h.gesture('end');start.down(200);end.handle.emit('pointerdown',{pointerId:2,clientX:800});
 start.move(300);end.handle.emit('pointermove',{pointerId:2,clientX:700});start.up();
 end.handle.emit('pointermove',{pointerId:2,clientX:600});assert.equal(h.api.current.form.trimStart,'3');assert.equal(h.api.current.form.trimEnd,'6');
 end.handle.emit('pointerup',{pointerId:2});start.down(300);start.move(400);start.up();assert.equal(h.api.current.form.trimStart,'4');
 assert.deepEqual(start.handle.releases,[1,1]);assert.deepEqual(end.handle.releases,[2]);
});
for(const side of ['start','end'])test(`${side} disable during active drag and keyboard events stay inert`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);g.handle.disabled=true;
 g.move(500);const e=g.handle.emit('keydown',{key:'ArrowRight'});assert.equal(h.editCalls.length,0);assert.equal(e.defaultPrevented,undefined);
 assert.equal(g.handle.captures.size,0);g.handle.disabled=false;g.move(500);assert.equal(h.editCalls.length,0);
});
for(const side of ['start','end'])test(`${side} already disabled rejects a fresh pointerdown`,t=>{
 const h=setup(t),g=h.gesture(side);g.handle.disabled=true;g.down(side==='start'?200:800);g.move(500);assert.equal(h.editCalls.length,0);assert.equal(g.handle.captures.size,0);
});
for(const side of ['start','end'])for(const blocked of ['busy','empty'])test(`${side} actual onEdit boundary ignores ${blocked} before form/audio effects`,t=>{
 const h=setup(t);if(blocked==='busy')h.api.setBusy(true);else h.api.clearCatalogSelection();
 const before=structuredClone(h.api.current.form),events=h.events.length,turn=h.api.current.refreshGeneration;
 h.directEdit(5,7,side);assert.deepEqual(h.api.current.form,before);assert.equal(h.events.length,events);assert.equal(h.api.current.refreshGeneration,turn);
});
for(const side of ['start','end'])test(`${side} old ID cannot edit or terminate a different newer pointer`,t=>{
 const h=setup(t),g=h.gesture(side);g.down(side==='start'?200:800);h.api.view.cancelDrag();
 g.handle.emit('pointerdown',{pointerId:2,clientX:side==='start'?200:800});
 for(const type of ['pointermove','pointerup','pointercancel','lostpointercapture'])g.handle.emit(type,{pointerId:1,clientX:500});
 assert.equal(h.editCalls.length,0);assert.equal(g.handle.hasPointerCapture(2),true);
 g.handle.emit('pointermove',{pointerId:2,clientX:side==='start'?300:700});assert.equal(h.editCalls.length,1);
});
test('capture release cannot synchronously begin another gesture during global cancellation',t=>{
 const h=setup(t),start=h.gesture('start'),end=h.gesture('end');start.down(200);
 start.handle.onRelease=()=>end.handle.emit('pointerdown',{pointerId:2,clientX:800});h.api.view.cancelDrag();
 assert.equal(end.handle.captures.size,0);assert.equal(end.handle.classes.has('dragging'),false);assert.equal(h.editCalls.length,0);
 end.handle.emit('pointerdown',{pointerId:2,clientX:800});end.handle.emit('pointermove',{pointerId:2,clientX:700});assert.equal(h.editCalls.length,1);
});
for(const side of ['start','end'])test(`${side} synchronous focus disable clears capture and class`,t=>{
 const h=setup(t),g=h.gesture(side);g.handle.onFocus=()=>{g.handle.disabled=true;};g.down(side==='start'?200:800);g.move(500);
 assert.equal(g.handle.captures.size,0);assert.equal(g.handle.classes.has('dragging'),false);assert.equal(h.editCalls.length,0);
});
