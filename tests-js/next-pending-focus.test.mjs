import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextPendingItem } from '../src/audio_review_desk/static/ui.js';

// Real selection/refresh code with a controlled scroll viewport. These tests
// verify geometry decisions and ownership, not browser layout or smoothness.
const source = readFileSync(process.env.ARD_QUEUE_WORKBENCH || new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const hasReveal = source.includes('function revealQueueSelection()');
const helper = hasReveal ? extract('function revealQueueSelection()', 'let waveStatus =') : 'function revealQueueSelection() {}';
// Production navigation handlers and full select() with controlled discard,
// media and DOM doubles; real boundary-disabled statements model native blur.
const row = key => ({ key, label: `Clip ${key}`, quality: { decoded: false, duration: 10 }, review: { status: 'pending', note: '', version: 0 } });
const makeCatalog = () => ({ workspace_id: 'queue-test', items: Array.from({ length: 30 }, (_, i) => row(String(i))) });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function setup({ initial = makeCatalog(), current = '0', remembered = null, allowDiscard = true, busy = false, mobile = false, collapsed = false, focusMode = false, confirmation = null, waveWait = null } = {}) {
  const nodes = new Map(), calls = [], reads = [], selectedRows = [], focuses = [], listeners = new Set();
  let activeRow = null, filtered = null;
  const container = { clientHeight: 200, clientTop: 2, scrollHeight: 1920, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100 }), scrollTo(options) { calls.push(options); this.scrollTop = options.top; } };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: false, open: false, value: '', textContent: '', isConnected: true, visible: true, querySelector: () => null, contains: node => node?.dialog === id, addEventListener(type, fn) { this[type] = fn; }, getClientRects() { return this.isConnected && this.visible && !this.hidden && !(id === 'nextPending' && (mobile || classes.has('focus-mode'))) ? [{}] : []; }, get disabled() { return this._disabled; }, set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; }, focus(options) { document.activeElement = this; focuses.push({ id, options }); for (const fn of listeners) fn({ target: this }); } }); return nodes.get(id); };
  $('items').parentElement = container; $('items').querySelector = () => activeRow;
  const classes = new Set([...(collapsed ? ['mobile-library-collapsed'] : []), ...(focusMode ? ['focus-mode'] : [])]);
  const focused = $('note'), document = { activeElement: focused, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn), body: { classList: {
    add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key),
  } } };
  const noop = () => {};
  const env = {
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    $, initial, current, document, nextPendingItem, initialBusy: busy, request(path) { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    notice: noop, t: key => key, errorText: error => error.message, language: 'en', discardAllowed: async () => confirmation ? await confirmation.promise : allowDiscard,
    audition: { cancel: noop }, rememberPosition: noop, waveformReader: { cancel: noop, load: () => waveWait?.promise || Promise.resolve(true) }, resumedTime: () => 0, invalidateHistory: noop,
    media: { cancel: noop, load: noop }, player: { pause: noop, removeAttribute: noop, load: noop },
    sessionStorage: { setItem: noop, getItem: () => remembered }, matchMedia: () => ({ matches: mobile }), updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop }, renderDetails: () => {
      const line = source.split('\n').find(line => line.includes('$("nextPending").disabled = busy || !state.items.some(row'));
      Function('$', 'busy', 'state', 'item', line)($, busy, initial, initial.items.find(item => item.key === selectedRows.at(-1)));
    }, renderSummary: noop,
    record(key) {
      selectedRows.push(key);
      activeRow = key !== undefined && (!filtered || filtered.includes(key)) ? { getBoundingClientRect: () => ({
        top: 102 + Number(key) * 64 - container.scrollTop, bottom: 102 + Number(key) * 64 + 64 - container.scrollTop, height: 64 }) } : null;
    },
  };
  let selection = extract('async function select(item', 'let waveStatus =');
  if (!hasReveal) selection += '\n' + helper;
  const code = [selection, extract('let refreshLoadError =', 'function setBusy(value)')].join('\n');
  const control = Function(...Object.keys(env), `
    let noticeGeneration = 0, noticeResolver = null;
    let state = initial, selected = state?.items.find(row => row.key === current) || null, busy = initialBusy, dirty = false,
      generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null, suspendedCompletion = null,
      waveStatus = null, waveNotice = null, variant = 'a', wave = {};
    const selectedKeys = new Set(), listeningMemory = { get: () => ({}) };
    function renderQueue() { record(selected?.key); }
    function visibleItems() { return state.items; }
    ${code}
    ${extract('async function goToNextPending()', 'const commandMenu =')}
    ${extract('$("nextPending").addEventListener', '$("markIn").addEventListener')}
    return { goToNextPending, select, refresh, renderQueue, revealQueueSelection,
      get current() { return { state, selected, dirty }; } };
  `)(...Object.values(env));
  return { $, container, document, focused, focuses, listeners, classes, calls, reads, selectedRows, control, setFilter(keys) { filtered = keys; }, get current() { return control.current; } };
}



const catalog = (pending = ['1']) => ({ workspace_id: 'pending-focus', items: ['0','1','2'].map(key => ({ ...row(key), review: { ...row(key).review, status: pending.includes(key) ? 'pending' : 'pass' } })) });
const run = h => h.$('nextPending').click();
const own = h => { h.document.activeElement = h.$('nextPending'); };
test('last pending sidebar action hands off to the heading before waveform settlement', async () => {
  const initial=catalog(), waveWait=deferred();initial.items[1].quality.decoded=true;
  const h=setup({initial,waveWait});own(h);const navigating=run(h);
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(h.current.selected.key,'1');assert.equal(h.document.activeElement,h.$('clipTitle'));
  assert.deepEqual(h.focuses,[{id:'clipTitle',options:{preventScroll:true}}]);assert.equal(h.listeners.size,0);
  h.$('note').focus();waveWait.resolve(true);await navigating;assert.equal(h.document.activeElement,h.$('note'));
});
test('another pending item leaves the enabled initiating button focused',async()=>{
  const h=setup({initial:catalog(['1','2'])});own(h);await run(h);
  assert.equal(h.current.selected.key,'1');assert.equal(h.$('nextPending').disabled,false);
  assert.equal(h.document.activeElement,h.$('nextPending'));assert.equal(h.focuses.length,0);assert.equal(h.listeners.size,0);
});
for(const allowed of [false,true])test(`delayed discard ${allowed?'confirm':'cancel'} respects focus ownership`,async()=>{
  const confirmation=deferred(),h=setup({initial:catalog(),confirmation});own(h);const navigating=run(h);
  const confirm=h.$('discardChanges');confirm.dialog='discardDialog';confirm.focus();
  h.document.activeElement=h.$('nextPending');confirmation.resolve(allowed);await navigating;
  assert.equal(h.current.selected.key,allowed?'1':'0');assert.equal(h.document.activeElement,h.$(allowed?'clipTitle':'nextPending'));
  assert.equal(h.listeners.size,0);
});
for(const blur of [false,true])test(`newer focus${blur?' then blur':''} is preserved`,async()=>{
  const confirmation=deferred(),h=setup({initial:catalog(),confirmation});own(h);const navigating=run(h);
  h.$('note').focus();if(blur)h.document.activeElement=h.document.body;
  confirmation.resolve(true);await navigating;
  assert.equal(h.document.activeElement,blur?h.document.body:h.$('note'));
  assert.equal(h.focuses.filter(x=>x.id==='clipTitle').length,0);assert.equal(h.listeners.size,0);
});
for(const options of [{},{mobile:true},{focusMode:true}])test(`non-sidebar command invocation preserves focus ${JSON.stringify(options)}`,async()=>{
  const h=setup({initial:catalog(),...options});h.$('openCommands').focus();h.focuses.length=0;
  await h.control.goToNextPending();assert.equal(h.current.selected.key,'1');
  assert.equal(h.document.activeElement,h.$('openCommands'));assert.equal(h.focuses.length,0);assert.equal(h.listeners.size,0);
});
for(const unavailable of ['origin detached','heading hidden','heading detached','heading disabled'])test(`${unavailable} prevents invalid handoff`,async()=>{
  const confirmation=deferred(),h=setup({initial:catalog(),confirmation});own(h);const navigating=run(h);
  if(unavailable==='origin detached')h.$('nextPending').isConnected=false;
  if(unavailable==='heading hidden')h.$('clipTitle').visible=false;
  if(unavailable==='heading detached')h.$('clipTitle').isConnected=false;
  if(unavailable==='heading disabled')h.$('clipTitle').disabled=true;
  confirmation.resolve(true);await navigating;assert.equal(h.focuses.length,0);assert.equal(h.listeners.size,0);
});
test('superseding navigation prevents the old pending action from taking focus',async()=>{
  const confirmation=deferred(),h=setup({initial:catalog(),confirmation});own(h);
  const first=run(h),second=h.control.select(h.current.state.items[2]);confirmation.resolve(true);await Promise.all([first,second]);
  assert.equal(h.current.selected.key,'2');assert.equal(h.focuses.length,0);assert.equal(h.listeners.size,0);
});
test('busy and no-target returns do not install focus listeners',async()=>{
  for(const options of [{initial:catalog(),busy:true},{initial:catalog([])}]){
    const h=setup(options);own(h);await run(h);assert.equal(h.listeners.size,0);assert.equal(h.focuses.length,0);
  }
});
test('exception in confirmation removes the focus observer',async()=>{
  let reject;const confirmation={promise:new Promise((_,fail)=>reject=fail)},h=setup({initial:catalog(),confirmation});own(h);
  const navigating=run(h),rejected=assert.rejects(navigating,/synthetic failure/);reject(new Error('synthetic failure'));await rejected;
  assert.equal(h.listeners.size,0);assert.equal(h.focuses.length,0);
});
test('retained native focus on disabled origin is not forcibly moved',async()=>{
  const h=setup({initial:catalog()});Object.defineProperty(h.$('nextPending'),'disabled',{value:false,writable:true});own(h);await run(h);
  assert.equal(h.$('nextPending').disabled,true);assert.equal(h.document.activeElement,h.$('nextPending'));assert.equal(h.focuses.length,0);
});
test('origin hidden during confirmation hands off if navigation still owns displaced focus',async()=>{
  const confirmation=deferred(),h=setup({initial:catalog(['1','2']),confirmation});own(h);const navigating=run(h);
  // Model a layout transition while the dialog is open: the former trigger is
  // no longer focusable when the dialog returns, but no newer control owns focus.
  h.$('nextPending').visible=false;h.document.activeElement=h.document.body;
  confirmation.resolve(true);await navigating;
  assert.equal(h.$('nextPending').disabled,false);assert.equal(h.document.activeElement,h.$('clipTitle'));
  assert.equal(h.listeners.size,0);
});
