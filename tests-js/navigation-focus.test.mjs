import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: false, open: false, value: '', textContent: '', isConnected: true, visible: true, querySelector: () => null, contains: node => node?.dialog === id, addEventListener(type, fn) { this[type] = fn; }, getClientRects() { return this.isConnected && this.visible && !this.hidden ? [{}] : []; }, get disabled() { return this._disabled; }, set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; }, focus(options) { document.activeElement = this; focuses.push({ id, options }); for (const fn of listeners) fn({ target: this }); } }); return nodes.get(id); };
  $('items').parentElement = container; $('items').querySelector = () => activeRow;
  const classes = new Set([...(collapsed ? ['mobile-library-collapsed'] : []), ...(focusMode ? ['focus-mode'] : [])]);
  const focused = $('note'), document = { activeElement: focused, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn), body: { classList: {
    add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key),
  } } };
  const noop = () => {};
  const env = {
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    $, initial, current, document, initialBusy: busy, request(path) { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    notice: noop, t: key => key, errorText: error => error.message, language: 'en', discardAllowed: async () => confirmation ? await confirmation.promise : allowDiscard,
    audition: { cancel: noop }, rememberPosition: noop, waveformReader: { cancel: noop, load: () => waveWait?.promise || Promise.resolve(true) }, resumedTime: () => 0, invalidateHistory: noop,
    media: { cancel: noop, load: noop }, player: { pause: noop, removeAttribute: noop, load: noop },
    sessionStorage: { setItem: noop, getItem: () => remembered }, matchMedia: () => ({ matches: mobile }), updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop }, renderDetails: () => {
      const lines = source.split('\n').filter(line => line.includes('$("previous").disabled =') || line.includes('$("next").disabled =')).join('\n');
      Function('$', 'busy', 'index', 'list', lines)($, busy, initial.items.findIndex(item => item.key === selectedRows.at(-1)), initial.items);
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
    ${extract('for (const [id, direction] of [', '$("variantA").addEventListener')}
    return { select, refresh, renderQueue, revealQueueSelection,
      get current() { return { state, selected, dirty }; } };
  `)(...Object.values(env));
  return { $, container, document, focused, focuses, listeners, classes, calls, reads, selectedRows, control, setFilter(keys) { filtered = keys; }, get current() { return control.current; } };
}


for (const mobile of [false, true]) for (const focusMode of [false, true]) {
  for (const [button, current, target] of [['next', '28', '29'], ['previous', '1', '0']]) {
    test(`${mobile ? 'mobile' : 'desktop'} ${focusMode ? 'focus mode' : 'normal'} ${button} boundary hands off once`, async () => {
      const h = setup({ current, mobile, focusMode }); h.document.activeElement = h.$(button);
      await h.$(button).click();
      assert.equal(h.current.selected.key, target);
      assert.equal(h.document.activeElement, h.$('clipTitle'));
      assert.deepEqual(h.focuses, [{ id: 'clipTitle', options: { preventScroll: true } }]);
      assert.equal(h.classes.has('focus-mode'), focusMode);
      assert.equal(h.listeners.size, 0);
    });
  }
}
for (const button of ['previous', 'next']) test(`middle ${button} navigation keeps its enabled button focused`, async () => {
  const h = setup({ current: '15' }); h.document.activeElement = h.$(button);
  await h.$(button).click(); assert.equal(h.document.activeElement, h.$(button));
  assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
});
test('shortcut/programmatic click does not take focus from the actual active control', async () => {
  const h = setup({ current: '28' }); await h.$('next').click();
  assert.equal(h.document.activeElement, h.focused); assert.equal(h.focuses.length, 0);
});
for (const allow of [false, true]) test(`delayed discard ${allow ? 'confirm' : 'cancel'} respects navigation outcome`, async () => {
  const confirmation = deferred(), h = setup({ current: '28', confirmation });
  h.document.activeElement = h.$('next'); const navigating = h.$('next').click();
  const dialogButton = h.$('discardChanges'); dialogButton.dialog = 'discardDialog'; dialogButton.focus();
  h.document.activeElement = h.$('next'); // model native dialog focus return
  confirmation.resolve(allow); await navigating;
  assert.equal(h.current.selected.key, allow ? '29' : '28');
  assert.equal(h.document.activeElement, h.$(allow ? 'clipTitle' : 'next'));
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, Number(allow));
  assert.equal(h.listeners.size, 0);
});
for (const blur of [false, true]) test(`delayed navigation preserves newer ${blur ? 'moved then blurred' : 'active'} focus`, async () => {
  const confirmation = deferred(), h = setup({ current: '28', confirmation });
  h.document.activeElement = h.$('next'); const navigating = h.$('next').click();
  h.$('note').focus(); if (blur) h.document.activeElement = h.document.body;
  confirmation.resolve(true); await navigating;
  assert.equal(h.document.activeElement, blur ? h.document.body : h.$('note'));
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 0);
  assert.equal(h.listeners.size, 0);
});
test('superseded selection cannot hand off boundary focus', async () => {
  const confirmation = deferred(), h = setup({ current: '28', confirmation });
  h.document.activeElement = h.$('next'); const first = h.$('next').click();
  const second = h.control.select(h.current.state.items[10]);
  confirmation.resolve(true); await Promise.all([first, second]);
  assert.equal(h.current.selected.key, '10');
  assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
});
for (const unavailable of ['origin detached', 'heading detached', 'heading hidden', 'heading disabled']) test(`${unavailable} prevents unsafe handoff`, async () => {
  const h = setup({ current: '28' }); h.document.activeElement = h.$('next');
  if (unavailable === 'origin detached') h.$('next').isConnected = false;
  if (unavailable === 'heading detached') h.$('clipTitle').isConnected = false;
  if (unavailable === 'heading hidden') h.$('clipTitle').visible = false;
  if (unavailable === 'heading disabled') h.$('clipTitle').disabled = true;
  await h.$('next').click(); assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
});
test('boundary handoff happens before waveform completion and never steals later focus', async () => {
  const waveWait = deferred(), initial = makeCatalog(); initial.items[29].quality.decoded = true;
  const h = setup({ current: '28', initial, waveWait }); h.document.activeElement = h.$('next');
  const navigating = h.$('next').click(); for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(h.document.activeElement, h.$('clipTitle')); assert.equal(h.listeners.size, 0);
  h.$('note').focus(); waveWait.resolve(true); await navigating;
  assert.equal(h.document.activeElement, h.$('note'));
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 1);
});
test('no target performs no selection and installs no focus observer', async () => {
  const h = setup({ current: '29' }); h.document.activeElement = h.$('next');
  await h.$('next').click(); assert.equal(h.current.selected.key, '29');
  assert.equal(h.document.activeElement, h.$('next')); assert.equal(h.listeners.size, 0);
});
test('retained native focus is not moved merely because the button is disabled', async () => {
  const h = setup({ current: '28' });
  Object.defineProperty(h.$('next'), 'disabled', { value: false, writable: true });
  h.document.activeElement = h.$('next'); await h.$('next').click();
  assert.equal(h.$('next').disabled, true); assert.equal(h.document.activeElement, h.$('next'));
  assert.equal(h.focuses.length, 0);
});
test('busy selection early return removes the navigation focus observer', async () => {
  const h = setup({ current: '28', busy: true });
  h.document.activeElement = h.$('next');
  await h.$('next').click();
  assert.equal(h.current.selected.key, '28');
  assert.equal(h.listeners.size, 0);
  assert.equal(h.document.activeElement, h.$('next'));
  assert.equal(h.focuses.length, 0);
});
test('discard-gate exception rejects navigation and removes its focus observer', async () => {
  let reject;
  const confirmation = { promise: new Promise((_, fail) => { reject = fail; }) };
  const h = setup({ current: '28', confirmation });
  h.document.activeElement = h.$('next');
  const navigating = h.$('next').click();
  assert.equal(h.listeners.size, 1);
  const rejected = assert.rejects(navigating, /synthetic discard failure/);
  reject(new Error('synthetic discard failure')); await rejected;
  assert.equal(h.current.selected.key, '28');
  assert.equal(h.listeners.size, 0);
  assert.equal(h.document.activeElement, h.$('next'));
  assert.equal(h.focuses.length, 0);
});
test('waveform exception after handoff leaves no observer or second focus move', async () => {
  let reject;
  const waveWait = { promise: new Promise((_, fail) => { reject = fail; }) };
  const initial = makeCatalog(); initial.items[29].quality.decoded = true;
  const h = setup({ current: '28', initial, waveWait });
  h.document.activeElement = h.$('next'); const navigating = h.$('next').click();
  const rejected = assert.rejects(navigating, /synthetic waveform failure/);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(h.document.activeElement, h.$('clipTitle'));
  assert.equal(h.listeners.size, 0);
  h.$('note').focus(); reject(new Error('synthetic waveform failure')); await rejected;
  assert.equal(h.document.activeElement, h.$('note'));
  assert.equal(h.listeners.size, 0);
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 1);
});
test('origin detached during confirmation cannot claim a later focus handoff', async () => {
  const confirmation = deferred(), h = setup({ current: '28', confirmation });
  h.document.activeElement = h.$('next'); const navigating = h.$('next').click();
  h.$('next').isConnected = false; h.document.activeElement = h.document.body;
  confirmation.resolve(true); await navigating;
  assert.equal(h.current.selected.key, '29');
  assert.equal(h.document.activeElement, h.document.body);
  assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
});
test('hidden origin invoked without owning focus never claims keyboard focus', async () => {
  const h = setup({ current: '28' }); h.$('next').visible = false;
  // A CSS-hidden button cannot be natively focused/clicked; invoke its handler
  // only as a defensive programmatic path, leaving the real active control alone.
  await h.$('next').click();
  assert.equal(h.current.selected.key, '29');
  assert.equal(h.document.activeElement, h.focused);
  assert.equal(h.focuses.length, 0); assert.equal(h.listeners.size, 0);
});
