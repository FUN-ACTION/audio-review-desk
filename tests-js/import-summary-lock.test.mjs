import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// NOT RUN. Actual submit/summary/translation/language-event code with DOM doubles.
const source=readFileSync(new URL('../src/audio_review_desk/static/workbench.js',import.meta.url),'utf8');
function extract(a,b){const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x);return source.slice(x,y);}
const code=[extract('function translate()','for (const name of issueNames)'),
 extract('function renderSummary()','function visibleItems()'),
 extract('function showImportError(','function renderJob('),
 extract('async function startImport(','function markBoundary('),
 extract('$("language").addEventListener','$("refresh").addEventListener')].join('\n');
function fixture({failRender=false}={}){
 let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;});const nodes=new Map(),posts=[];
 const control={failRender};const element=()=>({value:'',dataset:{},textContent:'',hidden:true,disabled:false,open:false,checked:true,
  classList:{remove(){},toggle(){}},setAttribute(){},removeAttribute(){},querySelectorAll(){return[];},focus(){},addEventListener(type,fn){this[type]=fn;}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const main=element();main.removeAttribute=()=>{if(control.failRender){control.failRender=false;throw new Error('render failed');}};
 const document={body:element(),documentElement:{},querySelector:()=>main,querySelectorAll:()=>[]};
 $('importDialog').open=true;$('importPath').value='/audio';$('importKind').value='directory';
 const env={validateNote:()=>{},savingReview:null,dirty:false,$,document,control,post:async(path,payload)=>{posts.push([path,payload]);return pending;},
  localStorage:{setItem(){}},clearTimeout(){},errorText:error=>error.code||'error',formatTime:String,
  spectrumView:{setLanguage(){}},transport:{refresh(){}},renderQueue(){},renderDetails(){},showCompletion(){},renderJob(){},updateLibraryToggle(){},loadHistory(){},
  openDialog:node=>{node.open=true;},closeDialog:node=>{node.open=false;},discardAllowed:async()=>true};
 const api=Function(...Object.keys(env),`let choosing=false,busy=false,language='en',noticeGeneration=0,noticeResolver=null,noticeTimer=null,job=null;
 const selected=null,markersView=null,draftSession={refresh(){}},savedThisSession=new Set();
 const state={can_rescan:true,items:[{key:'a',review:{status:'pending'}}],stats:{files:1,review_counts:{pending:1,pass:0},human_approved_seconds:0,candidate_seconds:1,warnings:0,errors:0,duplicate_groups:[]}};
 const t=key=>language+':'+key;const importing=()=>job&&['running','cancelling'].includes(job.state);
 function notice(message){noticeGeneration++;$('notice').textContent=typeof message==='function'?message():message;}
 function acceptJob(next){job=next;renderSummary();}
 ${code}
 return {submit:()=>startImport({preventDefault(){}}),close:dismissImportDialog,translate,
 get locked(){return importSubmitting;},get job(){return job;}};`)(...Object.values(env));
 return {api,$,posts,control,resolve,reject};
}
const buttons=['chooseFiles','chooseFolder','chooseManifest','browsePath','rescan'];
for(const [first,next] of [['en','zh'],['zh','en']])for(const outcome of ['failure','success'])test(`manual ${outcome}: closing and switching ${first} to ${next} keeps summary lock UI synchronized`,async()=>{
 const f=fixture();f.$('language').value=first;f.$('language').change();
 const p=f.api.submit();assert.equal(f.api.locked,true);
 for(const id of buttons)assert.equal(f.$(id).disabled,true,`pending ${id}`);
 f.api.close();f.$('language').value=next;f.$('language').change();
 assert.equal(f.$('importDialog').open,false);assert.equal(f.api.locked,true);
 for(const id of buttons)assert.equal(f.$(id).disabled,true,`translated pending ${id}`);
 if(outcome==='failure')f.reject({code:'network'});else f.resolve({id:'accepted',state:'running'});
 await p;assert.equal(f.api.locked,false);assert.equal(f.posts.length,1);
 for(const id of buttons)assert.equal(f.$(id).disabled,outcome==='success',`settled ${id}`);
 if(outcome==='success')assert.equal(f.api.job.id,'accepted');
});
test('initial summary render failure releases manual lock before final summary repaint',async()=>{
 const f=fixture({failRender:true});await f.api.submit();assert.equal(f.api.locked,false);assert.equal(f.posts.length,0);
 for(const id of buttons)assert.equal(f.$(id).disabled,false);
});
test('lock is already released even when final summary repaint throws',async()=>{
 const f=fixture();const p=f.api.submit();f.control.failRender=true;f.reject({code:'network'});
 await assert.rejects(p,/render failed/);assert.equal(f.api.locked,false);
});
