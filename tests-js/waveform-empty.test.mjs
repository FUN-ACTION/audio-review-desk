import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.ARD_WAVEFORM_MODULE ? pathToFileURL(process.env.ARD_WAVEFORM_MODULE) : new URL('../src/audio_review_desk/static/waveform.js', import.meta.url);
const workbenchURL = process.env.ARD_WORKBENCH_SOURCE ? pathToFileURL(process.env.ARD_WORKBENCH_SOURCE) : new URL('../src/audio_review_desk/static/workbench.js', import.meta.url);
const { mountWaveform } = await import(moduleURL);
function mount(t) {
  const globals = ['ResizeObserver','getComputedStyle','document','devicePixelRatio'];
  const originals = new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.assign(globalThis,{ResizeObserver:class {observe(){}},getComputedStyle:()=>({getPropertyValue:()=> '#0068d1'}),document:{documentElement:{}},devicePixelRatio:1});
  t.after(()=>{for(const [key,value] of originals) value ? Object.defineProperty(globalThis,key,value) : delete globalThis[key]});
  const bars=[],views=[];
  const ctx={scale(){},beginPath(){},fill(){},roundRect(...args){bars.push(args)}};
  const canvas={clientWidth:300,clientHeight:100,getContext:()=>ctx};
  const handle=()=>({style:{},attributes:{},addEventListener(){},setAttribute(key,value){this.attributes[key]=String(value)}});
  const start=handle(),end=handle(),seek={},selection={style:{}},playhead={style:{}},pan={};
  const wave=mountWaveform(canvas,seek,selection,playhead,{start,end,pan,onEdit(){},onView:(...args)=>views.push(args)});
  return {wave,bars,views,start,end,seek,selection,playhead,pan,
    paint(action){bars.length=0;action();},
    timeline(){return structuredClone({view:views.at(-1),start:start.attributes,end:end.attributes,seek,selection,playhead,pan});}};
}
test('REGRESSION: absent peaks must not draw the identical bars used for genuine silence',t=>{
  const h=mount(t); h.wave.set([],10,2,8); const missing=structuredClone(h.bars);
  h.paint(()=>h.wave.set([0,0,0],10,2,8));
  t.diagnostic(JSON.stringify({missingBars:missing.length,silenceBars:h.bars.length,identical:JSON.stringify(missing)===JSON.stringify(h.bars)}));
  assert.equal(missing.length,0,'No samples must render no peak bars. Baseline renders 100 two-pixel bars, identical to true silence.');
  assert.ok(h.bars.length>0); assert.notDeepEqual(h.bars,missing);
});
test('CONTROL: genuine zero-valued samples retain their visible quiet baseline',t=>{
  const h=mount(t);h.wave.set([0,0,0],10,2,8);
  assert.equal(h.bars.length,100);assert.ok(h.bars.every(bar=>bar[3]===2));
});
test('CONTROL: missing peaks still expose accurate timeline, selection, trim and playhead',t=>{
  const h=mount(t);h.wave.set([],10,2,8);h.wave.position(4);
  assert.deepEqual(h.views.at(-1),[0,10,1]);assert.equal(h.seek.min,'0');assert.equal(h.seek.max,'10');assert.equal(h.seek.value,'4');
  assert.equal(h.selection.style.left,'20%');assert.ok(Math.abs(parseFloat(h.selection.style.width)-60)<1e-10);
  assert.equal(h.start.attributes['aria-valuenow'],'2');assert.equal(h.end.attributes['aria-valuenow'],'8');
  assert.equal(h.playhead.style.transform,'translateX(120px)');assert.equal(h.playhead.hidden,false);
});
test('CONTROL: recovered peaks retain zoom, pan, exact trim boundaries and playhead',t=>{
  const h=mount(t);h.wave.set([],10,5.00000001,8.00000002);h.wave.position(7);h.wave.zoom(4,7);h.wave.pan(0.75);
  const before=h.timeline();assert.deepEqual(before.view,[5.625,8.125,4]);
  h.paint(()=>h.wave.set([0.1,0.6,0.2],10,5.00000001,8.00000002));
  assert.deepEqual(h.timeline(),before);assert.ok(h.bars.some(bar=>bar[3]>2));
});
test('CONTROL: missing peaks do not collapse precise submillisecond trim handles',t=>{
  const h=mount(t);const duration=1/44100;h.wave.set([],duration,0,duration);
  assert.equal(Number(h.start.attributes['aria-valuemax']),0);
  assert.equal(Number(h.end.attributes['aria-valuemin']),duration);
  assert.equal(Number(h.end.attributes['aria-valuemax']),duration);
  assert.equal(Number(h.end.attributes['aria-valuenow']),duration);
});
test('CONTROL: actual workbench draw handler uses current B data, draft range and media time',()=>{
  const source=readFileSync(workbenchURL,'utf8'),body=source.match(/function drawWave\(\) \{([\s\S]*?)\n\}/)?.[1];assert.ok(body);
  const calls=[],sample={a:[0.2],b:[0.4]},currentRange=[2.00000001,7.99999999];
  const execute=Function('range','wave','variant','selected','waveformView','media',body);
  execute(()=>currentRange,sample,'b',{quality:{duration:10},reference_quality:{duration:9.96}},
    {set:(...args)=>calls.push(['set',...args]),position:(...args)=>calls.push(['position',...args]),reset(){throw Error('must not reset viewport')}},
    {currentTime:5.5,load(){throw Error('must not reload media')},pause(){throw Error('must not pause media')}});
  assert.deepEqual(calls,[['set',sample.b,10,...currentRange,9.96],['position',5.5]]);
});
