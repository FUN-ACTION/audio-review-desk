import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { words } from '../src/audio_review_desk/static/copy.js';
import { filterItems, hasItemWarnings, sortItems, queueStamp, formatTime, searchTerms, reviewSearchContext } from '../src/audio_review_desk/static/ui.js';
import { formatMarkerTime } from '../src/audio_review_desk/static/markers.js';

// Actual filtering, selection-summary, clear-selection and queue rendering.
// Small DOM doubles verify state and focus rules, not browser geometry or AT.
const file = process.env.ARD_SELECTION_WORKBENCH || fileURLToPath(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url));
const source = readFileSync(file, 'utf8'), html = readFileSync(resolve(dirname(file), 'workbench.html'), 'utf8');
const css = readFileSync(resolve(dirname(file), 'workbench.css'), 'utf8');
const code = source.slice(source.indexOf('function visibleItems()'), source.indexOf('function draftValues()')) + '\n' +
  source.slice(source.indexOf('for (const id of ["search", "filter", "sort"])'), source.indexOf('for (const [id, direction]'));
const item = key => ({ key, id: key, label: `Clip ${key}`, quality: { duration: 10, flags: [] }, review: { version: 0, status: 'pending', note: '', markers: [] } });
function setup({ keys = ['A', 'B', 'C'], language = 'en', mobile = false, collapsed = false, focusMode = false } = {}) {
  const elements = new Map(), focuses = [], selections = [], detailCalls = [], moves = [], reads = [], listeners = new Set(), document = { activeElement: null, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn) }; let redirect = null;
  class Element {
    constructor(id = '') { this.isConnected = true; this.visible = true; this.id = id; this.tagName = id; this.children = []; this.value = ''; this.textContent = ''; this.checked = false; this.hidden = false; this.disabled = false; this.indeterminate = false; this.attributes = new Map(); this.style = {}; this.events = new Map(); const classes = new Set(); this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) }; }
    append(...nodes) { nodes.forEach(node => { node.parentElement = this; }); this.children.push(...nodes); }
    replaceChildren(...nodes) {
      let active = document.activeElement;
      while (active) { if (this.children.includes(active)) { document.activeElement = document.body; break; } active = active.parentElement; }
      const disconnect = node => { node.isConnected = false; node.children.forEach(disconnect); };
      this.children.forEach(disconnect); this.children = []; this.append(...nodes);
      if (this.id === 'items' && redirect) redirect();
    }
    set innerHTML(_) { assert.fail('Queue content must use textContent, not HTML'); }
    get offsetHeight() { return this.classList.contains('has-search-context') ? 100 : 66; }
    get offsetTop() { return (this.parentElement?.children || []).slice(0, this.parentElement.children.indexOf(this)).reduce((total, row) => total + row.offsetHeight, 0); }
    querySelector(query) { return this.children.find(node => query === 'input' ? node.tagName === 'input' : query === '.clip' ? node.className === 'clip' : false) || null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(name, fn) { this.events.set(name, fn); }
    closest(selector) {
      const queueControl = this.className === 'clip' || (this.tagName === 'input' && this.parentElement?.className === 'clip-row');
      return selector === '.library' && (queueControl || ['search', 'selectAll', 'toggleLibrary'].includes(this.id)) ? $('library') : null;
    }
    getClientRects() {
      const queueChild = this.className === 'clip' || (this.tagName === 'input' && this.parentElement?.className === 'clip-row');
      const libraryHidden = document.body?.classList.contains('focus-mode') || (mobile && document.body?.classList.contains('mobile-library-collapsed'));
      return this.isConnected && this.visible && !this.hidden && !((queueChild || this.id === 'search') && libraryHidden) ? [{}] : [];
    }
    focus(options) { if (this.disabled || !this.getClientRects().length) return; document.activeElement = this; focuses.push({ id: this.id, node: this, options }); for (const fn of listeners) fn({ target: this }); }
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  document.body = $('body'); document.activeElement = document.body; if (collapsed) document.body.classList.add('mobile-library-collapsed'); if (focusMode) document.body.classList.add('focus-mode');
  document.createElement = tag => new Element(tag); document.querySelectorAll = () => [];
  $('search').value = ''; $('filter').value = 'all'; $('sort').value = 'name';
  $('note').value = 'Unsaved review draft'; $('score').value = '0'; $('trimStart').value = '0.123456';
  const initial = { workspace_id: 'focus-test', items: keys.map(item), stats: { duplicate_groups: [] } };
  const noop = () => {};
  const env = { $, document, initial, draftSession: null, renderSummary: noop, discardAllowed: async () => true,
    request: () => { let resolve; const promise = new Promise(yes => resolve = yes); reads.push({ resolve }); return promise; },
    notice: noop, errorText: error => error.message, audition: { cancel: noop }, rememberPosition: noop,
    waveformReader: { cancel: noop }, invalidateHistory: noop, media: { cancel: noop },
    player: { pause: noop, removeAttribute: noop, load: noop }, updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop },
    sessionStorage: { setItem: noop, getItem: () => null }, matchMedia: () => ({ matches: mobile }),
     filterItems, hasItemWarnings, sortItems, queueStamp, formatTime, searchTerms, reviewSearchContext, formatMarkerTime, words, language, moveQueue: (...args) => moves.push(args), renderDetails: restore => detailCalls.push(restore), onSelection: row => selections.push(row.key) };
  const control = Function(...Object.keys(env), `
    let noticeGeneration = 0, noticeResolver = null;
    let state = initial, selected = state.items[0], busy = false, dirty = true, visibleCache = null,
      renderedQueueStamp = '', highlightedKey = null, queueHasPosition = false, generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null, suspendedCompletion = null, waveStatus = null, waveNotice = null, variant = 'a', wave = {}; const listeningMemory = { get: () => ({}) };
    const queueRows = new Map(), selectedKeys = new Set(), t = key => words[language][key] || key;
    ${code}
    ${source.slice(source.indexOf('async function select(item'), source.indexOf('let waveStatus ='))}
    ${source.slice(source.indexOf('let refreshLoadError ='), source.indexOf('function setBusy(value)'))}
    renderQueue();
    return { renderQueue, renderSelection, selectedKeys, queueRows, refresh, select, setDirty(value) { dirty = value; },
      clear: typeof clearSelection === 'function' ? clearSelection : null,
      setBusy(value) { busy = value; renderQueue(); },
      setLanguage(value) { language = value; renderQueue(); },
      replaceItems(items) { state = { ...state, items }; renderQueue(); },
      chooseKey(key) { selected = state.items.find(row => row.key === key); renderQueue(); },
      get current() { return { state, selected, busy, dirty }; } };
  `)(...Object.values(env));
  return { $, document, focuses, reads, listeners, redirect(fn) { redirect = fn; }, selections, detailCalls, moves, ...control, get current() { return control.current; },
    check(...keys) { keys.forEach(key => control.selectedKeys.add(key)); control.renderQueue(); },
    search(query) { $('search').value = query; control.renderQueue(); },
    inputSearch(query, isComposing = false) { $('search').value = query; $('search').events.get('input')({ isComposing }); },
    filter(value) { $('filter').value = value; control.renderQueue(); },
  };
}


const focusControl = (h, key, selector) => { const node = h.queueRows.get(key).querySelector(selector); node.focus(); h.focuses.length = 0; return node; };
const changed = (key, kind) => { const row = item(key); if (kind === 'status') row.review.status = 'pass'; else row.reference_quality = { flags: ['ogg_check_incomplete'] }; return row; };
for (const selector of ['.clip', 'input']) for (const kind of ['status', 'advisory']) {
  test(`${selector} keeps key/type across ${kind} rebuild`, () => {
    const h = setup(); const old = focusControl(h, 'B', selector);
    h.replaceItems([item('A'), changed('B', kind), item('C')]);
    const next = h.queueRows.get('B').querySelector(selector);
    assert.notEqual(old, next); assert.equal(old.isConnected, false);
    assert.equal(h.document.activeElement, next); assert.equal(h.focuses.length, 1);
    assert.deepEqual(h.focuses[0].options, { preventScroll: true });
    assert.equal(h.current.selected.key, 'A'); assert.equal(h.selectedKeys.size, 0);
    assert.equal(h.listeners.size, 0);
  });
}
for (const mobile of [false, true]) for (const selector of ['.clip', 'input']) test(`actual ${mobile ? 'mobile expanded' : 'desktop'} delayed refresh restores ${selector} focused during GET`, async () => {
  const h = setup({ mobile }); h.setDirty(false); const loading = h.refresh(true);
  const old = focusControl(h, 'B', selector);
  h.reads[0].resolve({ workspace_id: 'focus-test', items: [item('A'), changed('B', 'advisory'), item('C')], stats: { duplicate_groups: [] } });
  assert.equal(await loading, true);
  const next = h.queueRows.get('B').querySelector(selector);
  assert.notEqual(old, next); assert.equal(h.document.activeElement, next);
  assert.equal(h.current.selected.key, 'A'); assert.equal(h.listeners.size, 0);
});
test('identical data retains row identity and never calls focus', () => {
  const h = setup(); const original = focusControl(h, 'B', '.clip');
  h.replaceItems(['A','B','C'].map(item));
  assert.equal(h.queueRows.get('B').querySelector('.clip'), original);
  assert.equal(h.document.activeElement, original); assert.equal(h.focuses.length, 0);
});
for (const selector of ['.clip', 'input']) test(`removed ${selector} falls back to Search and reappearance does not steal it`, () => {
  const h = setup(); focusControl(h, 'B', selector);
  h.replaceItems([item('A')]); assert.equal(h.document.activeElement, h.$('search'));
  h.replaceItems([item('A'), item('B')]); assert.equal(h.document.activeElement, h.$('search'));
  assert.equal(h.focuses.length, 1);
});
// Defensive hidden-destination guard: real CSS may already blur the old control
// when the layout changes, before rendering can capture it.
for (const layout of ['mobile', 'focus']) test(`${layout} hidden queue falls back to persistent command control`, () => {
  const h = setup({ mobile: layout === 'mobile' }); focusControl(h, 'B', '.clip');
  h.document.body.classList.add(layout === 'mobile' ? 'mobile-library-collapsed' : 'focus-mode');
  h.replaceItems([item('A'), changed('B','status')]);
  assert.equal(h.document.activeElement, h.$('openCommands')); assert.equal(h.listeners.size, 0);
});
for (const condition of ['hidden', 'disabled', 'detached']) test(`${condition} fallbacks do not receive focus`, () => {
  const h = setup(); focusControl(h, 'B', '.clip');
  for (const id of ['search','openCommands']) {
    if (condition === 'hidden') h.$(id).visible = false;
    if (condition === 'disabled') h.$(id).disabled = true;
    if (condition === 'detached') h.$(id).isConnected = false;
  }
  h.replaceItems([item('A')]); assert.equal(h.document.activeElement, h.document.body); assert.equal(h.focuses.length, 0);
});
for (const blur of [false, true]) test(`synchronous newer focus${blur ? ' then blur' : ''} wins over rebuild recovery`, () => {
  const h = setup(); focusControl(h,'B','.clip');
  h.redirect(() => { h.$('note').focus(); if (blur) h.document.activeElement = h.document.body; });
  h.replaceItems([item('A'), changed('B','status')]);
  assert.equal(h.document.activeElement, blur ? h.document.body : h.$('note'));
  assert.equal(h.focuses.length, 1); assert.equal(h.listeners.size, 0);
});
for (const target of ['search','language','note']) test(`rebuild never steals existing ${target} focus`, () => {
  const h = setup(); h.$(target).focus(); h.focuses.length = 0;
  h.replaceItems([item('A'), changed('B','status')]); h.setLanguage('zh');
  assert.equal(h.document.activeElement,h.$(target)); assert.equal(h.focuses.length,0);
});
test('actual live search keeps typed value and focus without changing selected clip/draft', () => {
  const h=setup();h.$('search').focus();h.focuses.length=0;h.inputSearch('Clip B');
  assert.equal(h.document.activeElement,h.$('search'));assert.equal(h.$('search').value,'Clip B');
  assert.equal(h.current.selected.key,'A');assert.equal(h.current.dirty,true);assert.equal(h.$('note').value,'Unsaved review draft');
});
test('actual selection without queue content changes retains focus and checkbox selection', async () => {
  const h=setup();h.check('B');const original=focusControl(h,'B','input');
  await h.select(h.current.state.items[1]);
  assert.equal(h.current.selected.key,'B');assert.equal(h.document.activeElement,original);
  assert.equal(h.selectedKeys.has('B'),true);assert.equal(original.checked,true);assert.equal(h.focuses.length,0);
});
test('new user edit invalidates pending refresh without rebuilding focused queue', async () => {
  const h=setup();h.setDirty(false);const loading=h.refresh(true);const original=focusControl(h,'B','.clip');
  h.setDirty(true);h.reads[0].resolve({workspace_id:'focus-test',items:[changed('B','status')],stats:{duplicate_groups:[]}});
  assert.equal(await loading,false);assert.equal(h.document.activeElement,original);assert.equal(h.focuses.length,0);
});
for (const blur of [false,true]) test(`actual delayed refresh preserves newer note focus${blur?' then blur':''}`,async()=>{
  const h=setup();h.setDirty(false);const loading=h.refresh(true);focusControl(h,'B','.clip');
  h.$('note').focus();if(blur)h.document.activeElement=h.document.body;h.focuses.length=0;
  h.reads[0].resolve({workspace_id:'focus-test',items:[item('A'),changed('B','status')],stats:{duplicate_groups:[]}});
  assert.equal(await loading,true);assert.equal(h.document.activeElement,blur?h.document.body:h.$('note'));assert.equal(h.focuses.length,0);
});
test('actual refresh removes a filtered-out focused row and uses persistent Search',async()=>{
  const h=setup();h.filter('pending');h.setDirty(false);const loading=h.refresh(true);focusControl(h,'B','.clip');
  h.reads[0].resolve({workspace_id:'focus-test',items:[item('A'),changed('B','status')],stats:{duplicate_groups:[]}});
  assert.equal(await loading,true);assert.equal(h.queueRows.has('B'),false);assert.equal(h.document.activeElement,h.$('search'));
  assert.equal(h.current.selected.key,'A');
});
test('checked row keeps its checked state during same-key advisory replacement',()=>{
  const h=setup();h.check('B');focusControl(h,'B','input');h.replaceItems([item('A'),changed('B','advisory')]);
  assert.equal(h.queueRows.get('B').querySelector('input').checked,true);
  assert.deepEqual([...h.selectedKeys],['B']);assert.equal(h.current.selected.key,'A');
});

for (const target of ['row', 'search', 'removed row']) test(`mobile replacement refresh preserves visible ${target} focus`,async()=>{
  const h=setup({mobile:true});h.setDirty(false);const loading=h.refresh(true);
  if(target==='search')h.$('search').focus();else focusControl(h,'B','.clip');
  const items=target==='removed row'?[item('C')]:[changed('B','status'),item('C')];
  h.reads[0].resolve({workspace_id:'focus-test',items,stats:{duplicate_groups:[]}});
  assert.equal(await loading,true);
  assert.equal(h.current.selected.key,target==='removed row'?'C':'B');
  assert.equal(h.document.body.classList.contains('mobile-library-collapsed'),false);
  const expected=target==='row'?h.queueRows.get('B').querySelector('.clip'):h.$('search');
  assert.equal(h.document.activeElement,expected);assert.ok(expected.getClientRects().length);
});
test('mobile replacement preserves a collapsed library when focus stays on its visible toggle',async()=>{
  const h=setup({mobile:true,collapsed:true});h.setDirty(false);const loading=h.refresh(true);h.$('toggleLibrary').focus();
  h.reads[0].resolve({workspace_id:'focus-test',items:[item('B')],stats:{duplicate_groups:[]}});
  assert.equal(await loading,true);assert.equal(h.current.selected.key,'B');
  assert.equal(h.document.body.classList.contains('mobile-library-collapsed'),true);
  assert.equal(h.document.activeElement,h.$('toggleLibrary'));
});
test('explicit mobile selection still collapses library instead of adopting refresh preservation',async()=>{
  const h=setup({mobile:true});h.$('search').focus();await h.select(h.current.state.items[1]);
  assert.equal(h.current.selected.key,'B');assert.equal(h.document.body.classList.contains('mobile-library-collapsed'),true);
});
