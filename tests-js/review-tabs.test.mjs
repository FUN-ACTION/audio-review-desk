import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountReviewTabs, serializeSampleNotes } from '../src/audio_review_desk/static/tour/review-tabs.js';

function fixture() {
  const make = (kind, key) => ({ dataset: { [key]: kind }, attrs: {}, hidden: false, tabIndex: null, focused: false,
    setAttribute(name, value) { this.attrs[name] = value; }, focus() { this.focused = true; }, closest() { return this; } });
  const tabs = ['compare','range','notes'].map(kind => make(kind, 'panel'));
  const panels = ['compare','range','notes'].map(kind => make(kind, 'example'));
  const listeners = new Map();
  const list = { hidden: true, attrs: {}, querySelectorAll: () => tabs,
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); } };
  const root = { dataset: {}, querySelector: () => list, querySelectorAll: () => panels };
  const selected = []; const controller = mountReviewTabs(root, kind => selected.push(kind));
  const key = (index, name, extra = {}) => { let prevented = false; listeners.get('keydown')({ target: tabs[index], key: name, preventDefault() { prevented = true; }, ...extra }); return prevented; };
  const click = index => listeners.get('click')({ target: tabs[index] });
  return { tabs, panels, list, root, selected, key, click, listeners, controller };
}

test('progressive tabs expose one labelled panel and one tab stop', () => {
  const f = fixture();
  assert.equal(f.list.hidden, false); assert.equal(f.list.attrs.role, 'tablist');
  assert.equal(f.root.dataset.tabbed, 'true');
  assert.deepEqual(f.panels.map(p => p.hidden), [false,true,true]);
  assert.deepEqual(f.tabs.map(t => t.tabIndex), [0,-1,-1]);
  for (let i=0;i<3;i++) {
    assert.equal(f.tabs[i].attrs.role, 'tab'); assert.equal(f.panels[i].attrs.role, 'tabpanel');
    assert.equal(f.tabs[i].attrs['aria-controls'], `panel-${f.panels[i].dataset.example}`);
    assert.equal(f.panels[i].attrs['aria-labelledby'], `tab-${f.tabs[i].dataset.panel}`);
  }
  assert.deepEqual(f.selected, ['compare']);
});
test('switching and returning preserves panels and pauses the prior audio owner', () => {
  const f=fixture(); const notes=f.panels[2]; notes.savedDraft='kept';
  f.click(2); assert.deepEqual(f.panels.map(p=>p.hidden),[true,true,false]);
  f.click(1); f.click(2);
  assert.equal(f.panels[2],notes); assert.equal(notes.savedDraft,'kept');
  assert.deepEqual(f.selected,['compare','notes','range','notes']);
  assert.deepEqual(f.tabs.map(t=>t.attrs['aria-selected']),['false','false','true']);
});
test('arrow keys wrap, Home and End focus the selected tab, modifiers are left alone', () => {
  const f=fixture(); assert.equal(f.key(0,'ArrowLeft'),true); assert.equal(f.tabs[2].focused,true);
  assert.equal(f.key(2,'ArrowRight'),true); assert.equal(f.tabs[0].focused,true);
  f.key(0,'End'); assert.deepEqual(f.panels.map(p=>p.hidden),[true,true,false]);
  f.key(2,'Home'); assert.deepEqual(f.panels.map(p=>p.hidden),[false,true,true]);
  const count=f.selected.length;
  assert.equal(f.key(0,'ArrowRight',{ctrlKey:true}),false); assert.equal(f.key(0,'ArrowRight',{isComposing:true}),false); assert.equal(f.key(0,'ArrowRight',{keyCode:229}),false); assert.equal(f.key(0,'ArrowDown'),false);
  assert.equal(f.selected.length,count);
});
test('disposed tabs remove their event listeners', () => {
  const f=fixture(); f.controller.dispose(); f.controller.dispose(); assert.equal(f.listeners.size,0);
});
test('activating the current tab does not interrupt playback or reset its panel', () => {
  const f=fixture(); f.click(0); f.key(0,'Home');
  assert.deepEqual(f.selected,['compare']);
  f.click(2); f.click(2); f.key(2,'End');
  assert.deepEqual(f.selected,['compare','notes']);
  assert.equal(f.tabs[2].focused,true);
});
test('sample note exports are bounded, sorted, precise and contain no file or workspace identity', () => {
  const notes=[{at:9.123456,text:'Keep the ending',file:'/secret/path'},{at:0,text:'Start'}];
  const data=JSON.parse(serializeSampleNotes(notes));
  assert.equal(data.format,'audio-review-desk-sample-notes'); assert.equal(data.duration_seconds,12);
  assert.deepEqual(data.notes,[{seconds:0,text:'Start'},{seconds:9.123,text:'Keep the ending'}]);
  assert.equal(notes[0].at,9.123456); assert.equal(JSON.stringify(data).includes('/secret'),false);
  assert.deepEqual(JSON.parse(serializeSampleNotes([])).notes,[]);
});
test('malformed notes and bounds are rejected instead of silently exporting invalid data', () => {
  for (const notes of [null,{},Array(21).fill({at:1,text:'x'}),[{at:-1,text:'x'}],[{at:12.1,text:'x'}],
    [{at:NaN,text:'x'}],[{at:Infinity,text:'x'}],[{at:1,text:''}],[{at:1,text:' '.repeat(4)}],[{at:1,text:'x'.repeat(121)}],[{at:1,text:1}]])
    assert.throws(()=>serializeSampleNotes(notes));
  assert.equal(JSON.parse(serializeSampleNotes([{at:12,text:'末尾'}])).notes[0].seconds,12);
});
test('the shipped page preserves readable no-script panels and native download links', () => {
  const html=readFileSync(new URL('../src/audio_review_desk/static/tour/index.html',import.meta.url),'utf8');
  assert.equal([...html.matchAll(/data-example="(?:compare|range|notes)"/g)].length,3);
  assert.doesNotMatch(html,/<article[^>]*\bhidden\b/);
  assert.match(html,/<div class="feature-tabs"[^>]* hidden>/);
  assert.equal([...html.matchAll(/\bdata-open\b/g)].length,3);
  assert.doesNotMatch(html,/[▶Ⅱ↗↓]/u);
});
