import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountWaveform } from '../src/audio_review_desk/static/waveform.js';
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const start = source.indexOf('    onView(start, end, zoom) {');
const viewBody = source.slice(start + '    onView(start, end, zoom) {'.length, source.indexOf('\n    },', start));
const handlerStart = source.indexOf('for (const [id, factor, fallbackId] of [');
const handlers = source.slice(handlerStart, source.indexOf('$("fitRange").addEventListener', handlerStart));
// Actual waveform module, onView callback and click handlers. DOM doubles
// model disable-induced blur; these tests do not verify native focus or AT.
function mounted(t, duration, startTime, endTime, onEdit = () => {}, extraView = () => {}) {
  const originals = new Map(["ResizeObserver", "getComputedStyle", "document", "devicePixelRatio"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {
    ResizeObserver: class { observe() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "#0068d1" }),
    document: { documentElement: {} }, devicePixelRatio: 1,
  });
  t.after(() => { for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const handle = () => ({
    style: {}, attributes: {}, listeners: {},
    classList: { add() {}, remove() {} }, focus() { document.activeElement = this; }, setPointerCapture() {},
    setAttribute(key, value) { this.attributes[key] = String(value); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  });
  const start = handle(), end = handle(), calls = [], views = [];
  const canvas = { clientWidth: 300, clientHeight: 100, getBoundingClientRect: () => ({ left: 0, width: 300 }), getContext: () => ({ scale() {}, beginPath() {}, roundRect() {}, fill() {} }) };
  const wave = mountWaveform(canvas, {}, { style: {} }, { style: {} }, {
    start, end, pan: {}, onView: (...args) => { views.push(args); extraView(...args); }, onEdit: (...args) => { calls.push(args); onEdit(...args); },
  });
  wave.set([], duration, startTime, endTime);
  return { start, end, calls, views, wave };
}

function setup(t) {
  const nodes = new Map(), focuses = [], listeners = new Set(); let redirect = null;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, isConnected: true, visible: true, listeners: {},
      get disabled() { return this._disabled; },
      set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      getClientRects() { return this.isConnected && this.visible ? [{}] : []; },
      focus(options) { document.activeElement = this; focuses.push({ id, options }); for (const fn of listeners) fn({ target: this }); },
    });
    return nodes.get(id);
  };
  const onView = Function('$', 'markersView', 'spectrumView', 'selected', 'precise', 'start', 'end', 'zoom', viewBody);
  const h = mounted(t, 10, 2, 8, () => {}, (...args) => {
    onView($, null, { setView() {} }, { quality: { duration: 10 } }, String, ...args);
    redirect?.();
  });
  document.body = {}; document.activeElement = document.body;
  document.addEventListener = (type, fn) => listeners.add(fn);
  document.removeEventListener = (type, fn) => listeners.delete(fn);
  Function('$', 'waveformView', handlers)($, h.wave);
  return { ...h, $, focuses, listeners, redirect(fn) { redirect = fn; },
    click(id, detail = 0) { $(id).listeners.click({ detail }); },
    focus(id) { document.activeElement = $(id); },
  };
}
for (const [id, initial, final, fallback] of [['zoomIn', 4, 8, 'zoomOut'], ['zoomOut', 2, 1, 'zoomIn']]) {
  test(`${id} keyboard boundary transfers to usable reverse action`, t => {
    const h = setup(t); h.wave.zoom(initial); h.focus(id); h.click(id);
    assert.equal(h.views.at(-1)[2], final); assert.equal(h.$(id).disabled, true);
    assert.equal(document.activeElement, h.$(fallback));
    assert.deepEqual(h.focuses, [{ id: fallback, options: { preventScroll: true } }]);
    assert.equal(h.start.attributes['aria-valuenow'], '2'); assert.equal(h.end.attributes['aria-valuenow'], '8');
    assert.deepEqual(h.calls, []); assert.equal(h.listeners.size, 0);
    h.click(fallback); assert.equal(document.activeElement, h.$(fallback));
    assert.equal(h.focuses.length, 1);
  });
  test(`${id} pointer activation retains its established behavior`, t => {
    const h = setup(t); h.wave.zoom(initial); h.focus(id); h.click(id, 1);
    assert.equal(h.views.at(-1)[2], final); assert.equal(document.activeElement, document.body);
    assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
  });
  for (const condition of ['hidden', 'disabled', 'detached']) test(`${id} avoids ${condition} reverse control`, t => {
    const h = setup(t); h.wave.zoom(initial); h.focus(id);
    if (condition === 'hidden') h.$(fallback).visible = false;
    if (condition === 'detached') h.$(fallback).isConnected = false;
    if (condition === 'disabled') h.redirect(() => { h.$(fallback).disabled = true; });
    h.click(id); assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
  });
}
for (const [id, initial, final] of [['zoomIn', 1, 2], ['zoomOut', 4, 2]]) test(`${id} middle zoom keeps focus`, t => {
  const h=setup(t); h.wave.zoom(initial); h.focus(id); h.click(id);
  assert.equal(h.views.at(-1)[2],final); assert.equal(document.activeElement,h.$(id));
  assert.equal(h.focuses.length,0);assert.equal(h.listeners.size,0);
});
for (const blur of [false,true]) test(`newer focus${blur?' then blur':''} during view update wins`,t=>{
  const h=setup(t);h.wave.zoom(4);h.focus('zoomIn');
  h.redirect(()=>{h.$('note').focus();if(blur)document.activeElement=document.body;});h.click('zoomIn');
  assert.equal(document.activeElement,blur?document.body:h.$('note'));
  assert.deepEqual(h.focuses.map(row=>row.id),['note']);assert.equal(h.listeners.size,0);
});
test('non-owning keyboard/programmatic activation does not steal focus',t=>{
  const h=setup(t);h.wave.zoom(4);h.focus('note');h.click('zoomIn');
  assert.equal(document.activeElement,h.$('note'));assert.equal(h.focuses.length,0);
});
test('detached origin cannot own recovery',t=>{
  const h=setup(t);h.wave.zoom(4);h.focus('zoomIn');h.$('zoomIn').isConnected=false;h.click('zoomIn');
  assert.equal(h.focuses.length,0);assert.equal(h.listeners.size,0);
});
test('no handoff when native disabling retains original focus',t=>{
  const h=setup(t);h.wave.zoom(4);Object.defineProperty(h.$('zoomIn'),'disabled',{value:false,writable:true});h.focus('zoomIn');h.click('zoomIn');
  assert.equal(document.activeElement,h.$('zoomIn'));assert.equal(h.focuses.length,0);
});
test('view exception removes its observer without making a fallback focus move',t=>{
  const h=setup(t);h.focus('zoomIn');h.redirect(()=>{throw new Error('synthetic paint error');});
  assert.throws(()=>h.click('zoomIn'),/synthetic paint error/);assert.equal(h.listeners.size,0);assert.equal(h.focuses.length,0);
});
test('external waveform zoom does not invoke button-specific recovery',t=>{
  const h=setup(t);h.wave.zoom(4);h.focus('note');h.wave.zoom(2);
  assert.equal(document.activeElement,h.$('note'));assert.equal(h.focuses.length,0);
  assert.equal(h.start.attributes['aria-valuenow'],'2');assert.equal(h.end.attributes['aria-valuenow'],'8');
});
test('continuous keyboard zoom in and back out keeps control access and exact trim range',t=>{
  const h=setup(t);h.focus('zoomIn');
  for(let i=0;i<3;i++)h.click('zoomIn');
  assert.equal(h.views.at(-1)[2],8);assert.equal(document.activeElement,h.$('zoomOut'));
  for(let i=0;i<3;i++)h.click('zoomOut');
  assert.equal(h.views.at(-1)[2],1);assert.equal(document.activeElement,h.$('zoomIn'));
  assert.deepEqual(h.focuses.map(row=>row.id),['zoomOut','zoomIn']);
  assert.equal(h.start.attributes['aria-valuenow'],'2');assert.equal(h.end.attributes['aria-valuenow'],'8');
  assert.deepEqual(h.calls,[]);assert.equal(h.listeners.size,0);
});
