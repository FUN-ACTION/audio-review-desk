import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAudition, auditionBounds } from "../src/audio_review_desk/static/audition.js";
import { playbackRange } from "../src/audio_review_desk/static/ui.js";
import { words } from "../src/audio_review_desk/static/copy.js";
import { errorText } from "../src/audio_review_desk/static/errors.js";
// Actual workbench parser, duration readout, audition wiring and button handlers.
// The native player and number-input badInput state are deterministic doubles.
const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (a,b) => { const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end); };
const kinds = { start:"auditionStart", end:"auditionEnd", selection:"auditionSelection" };
function setup({start="2",end="6",badStart=false,badEnd=false,duration=10,activeDuration=10,state="paused",language="en",busy=false,decoded=true}={}) {
 const nodes=new Map(),notices=[];let seeks=0,position=5;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:"",textContent:"",validity:{badInput:false},checked:false,attrs:{},listeners:new Map(),setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.listeners.set(k,v);}});return nodes.get(id);};
 $("trimStart").value=start;$("trimEnd").value=end;$("trimStart").validity.badInput=badStart;$("trimEnd").validity.badInput=badEnd;$("loop").checked=true;
 const player=new EventTarget();Object.assign(player,{src:"synthetic",readyState:1,duration:activeDuration,paused:state!=="playing",plays:[],pauses:0});
 Object.defineProperty(player,"currentTime",{get:()=>position,set:value=>{position=value;seeks++;}});
 player.play=()=>{player.paused=false;let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});player.plays.push({resolve,reject});if(state!=="pending")resolve();return promise;};
 player.pause=()=>{player.pauses++;player.paused=true;player.dispatchEvent(new Event("pause"));};
 const env={$,player,createAudition,auditionBounds,playbackRange,errorText,words,language,busy,selected:{quality:{decoded,duration}},number:value=>value.trim()===""?null:Number(value),notice:message=>notices.push(message)};
 const api=Function(...Object.keys(env),`const t=key=>words[language][key];\n${extract('const audition = createAudition({','// A manual transport action')}\n${extract('function selectedDraftRange()','function updateTime(')}\n${extract('for (const [id, kind] of [["auditionStart"','$("suggestRange").addEventListener')}\nreturn {audition,renderSelectedDuration,range,language(value){language=value;renderSelectedDuration();}};`)(...Object.values(env));
 if(state==="audition"||state==="pending")api.audition.start([1,3],"selection");
 api.renderSelectedDuration();
 return {api,$,player,notices,click:kind=>$(kinds[kind]).listeners.get("click")(),message:()=>typeof notices.at(-1)==="function"?notices.at(-1)():notices.at(-1),snapshot:()=>({position,seeks,plays:player.plays.length,pauses:player.pauses,paused:player.paused,loop:$("loop").checked,pressed:Object.values(kinds).map(id=>$(id).attrs["aria-pressed"]),fields:[$("trimStart").value,$("trimEnd").value]}),dispose:()=>api.audition.dispose()};
}
const invalid = [
 {start:"8",end:"2"},{start:"2",end:"2"},{start:"-1",end:"4"},{start:"0",end:"11"},
 {start:"10",end:""},{start:"",end:"-1"},{start:"",badStart:true},{end:"",badEnd:true},
 {start:"Infinity"},{end:"NaN"},{start:"abc"},{duration:0},{duration:NaN},{duration:Infinity},
];
for(const [index,values] of invalid.entries())for(const kind of Object.keys(kinds))for(const state of ["paused","playing","audition","pending"])test(`invalid editor ${index} ${kind} preserves ${state}`,async()=>{
 const h=setup({...values,state}),before=h.snapshot();assert.equal(h.$("selectedDuration").textContent,words.en.selectedDurationUnavailable);
 h.click(kind);assert.deepEqual(h.snapshot(),before);assert.equal(h.message(),errorText({code:"trim_invalid"},"en"));
 if(state==="pending"){h.player.plays[0].resolve();await Promise.resolve();assert.deepEqual(h.snapshot(),before);}
 if(state==="audition"||state==="pending"){h.api.audition.check(2.99);assert.equal(h.player.pauses,0);h.api.audition.check(3);assert.equal(h.player.pauses,1);assert.equal(h.$("loop").checked,true);}
 h.dispose();
});
for(const values of [{start:"",end:""},{start:"",end:"5"},{start:"5",end:""},{start:"0.000001",end:"0.000002"},{start:"0",end:"10"}])for(const kind of Object.keys(kinds))test(`valid ${JSON.stringify(values)} ${kind} retains exact fields and window`,()=>{
 const h=setup(values),fields=h.snapshot().fields;const start=values.start===""?0:Number(values.start),end=values.end===""?10:Number(values.end);
 const expected=auditionBounds(10,start,end,kind);h.click(kind);
 assert.equal(h.player.currentTime,expected[0]);assert.equal(h.player.plays.length,1);assert.deepEqual(h.snapshot().fields,fields);assert.equal(h.notices.length,0);
 assert.equal(h.$(kinds[kind]).attrs["aria-pressed"],"true");assert.equal(h.$("loop").checked,false);
 h.api.audition.check(expected[1]);assert.equal(h.player.pauses,1);assert.equal(h.$("loop").checked,true);h.dispose();
});
for(const kind of Object.keys(kinds))test(`short B preserves established ${kind} overlap policy`,()=>{
 const h=setup({start:"8",end:"9",activeDuration:7.5}),before=h.snapshot();h.click(kind);
 if(kind==="start") {assert.equal(h.player.currentTime,6.75);assert.equal(h.player.plays.length,1);h.api.audition.check(7.5);assert.equal(h.player.pauses,1);}
 else {assert.deepEqual(h.snapshot(),before);assert.equal(h.message(),words.en.auditionUnavailable);}
 assert.deepEqual(h.snapshot().fields,["8","9"]);h.dispose();
});
for(const activeDuration of [0,NaN,Infinity,-1])for(const state of ["paused","audition","pending"] )test(`unknown active duration ${activeDuration} preserves ${state}`,()=>{
 const h=setup({state});h.player.duration=activeDuration;const before=h.snapshot();h.click("selection");
 assert.deepEqual(h.snapshot(),before);assert.equal(h.message(),words.en.auditionUnavailable);h.dispose();
});
test("long B does not expand blank review bounds beyond A",()=>{
 const h=setup({start:"",end:"",activeDuration:15});h.click("selection");assert.equal(h.player.currentTime,0);
 h.api.audition.check(10);assert.equal(h.player.pauses,1);assert.deepEqual(h.snapshot().fields,["",""]);h.dispose();
});
for(const language of ["en","zh"])test(`invalid-editor notice remains localized from ${language}`,()=>{
 const h=setup({start:"8",end:"2",language});h.click("selection");assert.equal(h.message(),errorText({code:"trim_invalid"},language));
 const next=language==="en"?"zh":"en";h.api.language(next);assert.equal(h.message(),errorText({code:"trim_invalid"},next));h.dispose();
});
for(const flags of [{busy:true},{decoded:false}])test(`existing unavailable guard ${JSON.stringify(flags)} stays silent`,()=>{
 const h=setup(flags),before=h.snapshot();h.click("selection");assert.deepEqual(h.snapshot(),before);assert.equal(h.notices.length,0);h.dispose();
});
test("ordinary range still uses its existing forgiving playback fallback",()=>{
 const h=setup({start:"8",end:"2"});assert.deepEqual(h.api.range(),[8,10]);assert.equal(h.$("selectedDuration").textContent,words.en.selectedDurationUnavailable);h.dispose();
});
for(const kind of Object.keys(kinds))for(const state of ["audition","pending"])test(`B with no ${kind} window overlap retains existing ${state}`,async()=>{
 const h=setup({start:"8",end:"9",activeDuration:5,state}),before=h.snapshot();h.click(kind);
 assert.deepEqual(h.snapshot(),before);assert.equal(h.message(),words.en.auditionUnavailable);
 if(state==="pending"){h.player.plays[0].resolve();await Promise.resolve();assert.deepEqual(h.snapshot(),before);}
 h.api.audition.check(3);assert.equal(h.player.pauses,1);assert.equal(h.$("loop").checked,true);h.dispose();
});
