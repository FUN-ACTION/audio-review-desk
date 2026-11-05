import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Real selection/refresh code with a controlled scroll viewport. These tests
// verify geometry decisions and ownership, not browser layout or smoothness.
const source = readFileSync(process.env.ARD_QUEUE_WORKBENCH || new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const hasReveal = source.includes('function revealQueueSelection()');
const helper = hasReveal ? extract('function revealQueueSelection()', 'let waveStatus =') : 'function revealQueueSelection() {}';
function geometry({ scrollTop = 300, rowTop = 400, rowHeight = 64, height = 200, border = 2, total = 2000, found = true, mounted = true } = {}) {
  const calls = [], container = { clientHeight: height, clientTop: border, scrollHeight: total, scrollTop,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo(options) { calls.push(options); this.scrollTop = options.top; },
  };
  const row = { getBoundingClientRect: () => ({ top: 100 + border + rowTop - container.scrollTop, bottom: 100 + border + rowTop + rowHeight - container.scrollTop, height: rowHeight }) };
  const items = { parentElement: mounted ? container : null, querySelector: selector => { assert.equal(selector, '.clip-row.selected'); return found ? row : null; } };
  const reveal = Function('$', `${helper}; return revealQueueSelection;`)(id => { assert.equal(id, 'items'); return items; });
  return { reveal, calls, container };
}

test('workbench owns an explicit queue reveal without using document-wide scrollIntoView', () => {
  assert.equal(hasReveal, true); assert.doesNotMatch(helper, /scrollIntoView|\.focus\(/);
  assert.match(helper, /behavior: "instant"/);
});

for (const [name, options, expected] of [
  ['fully visible row', { rowTop: 350 }, null],
  ['top-aligned row', { rowTop: 300 }, null],
  ['bottom-aligned row', { rowTop: 436 }, null],
  ['partially clipped above', { rowTop: 280 }, 280],
  ['partially clipped below', { rowTop: 470 }, 334],
  ['distant row below', { rowTop: 1200 }, 1064],
  ['distant row above', { scrollTop: 900, rowTop: 100 }, 100],
  ['tall row', { rowTop: 500, rowHeight: 300 }, 500],
  ['zero border viewport', { rowTop: 470, border: 0 }, 334],
  ['fractional positions', { rowTop: 470.25, rowHeight: 63.5 }, 333.75],
  ['upper scroll boundary', { rowTop: -20 }, 0],
  ['lower scroll boundary', { rowTop: 2200 }, 1800],
]) test(`reveal handles ${name} with the nearest required list-only movement`, () => {
  const h = geometry(options), before = h.container.scrollTop; h.reveal();
  assert.deepEqual(h.calls, expected === null ? [] : [{ top: expected, behavior: 'instant' }]);
  assert.equal(h.container.scrollTop, expected === null ? before : expected);
  if (expected !== null && !['upper scroll boundary', 'lower scroll boundary'].includes(name)) {
    h.reveal(); assert.equal(h.calls.length, 1, 'a now-visible row must not scroll on repeated requests');
  }
});

for (const [name, options] of [['collapsed library', { height: 0 }], ['filtered-out row', { found: false }],
  ['unmounted viewport', { mounted: false }], ['unrendered row', { rowHeight: 0 }]]) {
  test(`reveal leaves ${name} unchanged`, () => { const h = geometry(options); h.reveal(); assert.deepEqual(h.calls, []); });
}

const row = key => ({ key, label: `Clip ${key}`, quality: { decoded: false, duration: 10 }, review: { status: 'pending', note: '', version: 0 } });
const makeCatalog = () => ({ workspace_id: 'queue-test', items: Array.from({ length: 30 }, (_, i) => row(String(i))) });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function setup({ initial = makeCatalog(), current = '0', remembered = null, allowDiscard = true, busy = false, mobile = false, collapsed = false } = {}) {
  const nodes = new Map(), calls = [], reads = [], selectedRows = [];
  let activeRow = null, filtered = null;
  const container = { clientHeight: 200, clientTop: 2, scrollHeight: 1920, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100 }), scrollTo(options) { calls.push(options); this.scrollTop = options.top; } };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: false, open: false, value: '', textContent: '', querySelector: () => null }); return nodes.get(id); };
  $('items').parentElement = container; $('items').querySelector = () => activeRow;
  const classes = new Set(collapsed ? ['mobile-library-collapsed'] : []);
  const focused = $('note'), document = { activeElement: focused, body: { classList: {
    add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key),
  } } };
  const noop = () => {};
  const env = {
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    $, initial, current, document, initialBusy: busy, request(path) { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    notice: noop, t: key => key, errorText: error => error.message, language: 'en', discardAllowed: async () => allowDiscard,
    audition: { cancel: noop }, rememberPosition: noop, waveformReader: { cancel: noop }, invalidateHistory: noop,
    media: { cancel: noop }, player: { pause: noop, removeAttribute: noop, load: noop },
    sessionStorage: { setItem: noop, getItem: () => remembered }, matchMedia: () => ({ matches: mobile }), updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop }, renderDetails: noop, renderSummary: noop,
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
    return { select, refresh, renderQueue, revealQueueSelection,
      get current() { return { state, selected, dirty }; } };
  `)(...Object.values(env));
  return { $, container, document, focused, calls, reads, selectedRows, control, setFilter(keys) { filtered = keys; }, get current() { return control.current; } };
}

test('explicit selection reveals the active row without moving focus or touching page ancestors', async () => {
  const h = setup(); await h.control.select(h.current.state.items[15]);
  assert.equal(h.current.selected.key, '15'); assert.deepEqual(h.calls, [{ top: 824, behavior: 'instant' }]);
  assert.equal(h.document.activeElement, h.focused);
});

test('ordinary queue rerenders do not pull the list away from manual scrolling', async () => {
  const h = setup(); await h.control.select(h.current.state.items[15]); h.container.scrollTop = 0;
  h.control.renderQueue(); h.control.renderQueue(); assert.equal(h.container.scrollTop, 0); assert.equal(h.calls.length, 1);
});

test('same-clip catalog refresh preserves manually chosen queue position', async () => {
  const h = setup({ current: '15' }), pending = h.control.refresh(true); h.reads[0].resolve(makeCatalog()); await pending;
  assert.equal(h.current.selected.key, '15'); assert.equal(h.container.scrollTop, 0); assert.deepEqual(h.calls, []);
});

test('initial refresh reveals the remembered row in a long catalog', async () => {
  const h = setup({ initial: null, current: null, remembered: '15' }), pending = h.control.refresh(true);
  h.reads[0].resolve(makeCatalog()); await pending;
  assert.equal(h.current.selected.key, '15'); assert.deepEqual(h.calls, [{ top: 824, behavior: 'instant' }]);
});

test('selection outside the current filter leaves the visible queue alone', async () => {
  const h = setup(); h.setFilter(['0', '1']); await h.control.select(h.current.state.items[15]);
  assert.equal(h.current.selected.key, '15'); assert.deepEqual(h.calls, []); assert.equal(h.document.activeElement, h.focused);
});

test('rapid explicit navigation reveals each accepted selection without deferred old scrolling', async () => {
  const h = setup(); const first = h.control.select(h.current.state.items[15]), second = h.control.select(h.current.state.items[25]);
  await Promise.all([first, second]); assert.equal(h.current.selected.key, '25');
  assert.deepEqual(h.calls, [{ top: 1464, behavior: 'instant' }]);
});

for (const [reason, options] of [['discard is refused', { allowDiscard: false }], ['a write is busy', { busy: true }]]) {
  test(`a blocked selection never scrolls when ${reason}`, async () => {
    const h = setup(options); await h.control.select(h.current.state.items[15]);
    assert.equal(h.current.selected.key, '0'); assert.deepEqual(h.calls, []); assert.deepEqual(h.selectedRows, []);
    assert.equal(h.document.activeElement, h.focused);
  });
}

test('refresh reveals a replacement when the previous selected clip is no longer present', async () => {
  const h = setup({ current: '15' }); h.container.scrollTop = 900; const pending = h.control.refresh(true), next = makeCatalog();
  next.items = next.items.filter(item => item.key !== '15'); h.reads[0].resolve(next); await pending;
  assert.equal(h.current.selected.key, '0'); assert.deepEqual(h.calls, [{ top: 0, behavior: 'instant' }]);
});

for (const mobile of [true, false]) for (const collapsed of [true, false]) test(`same-item automatic refresh preserves library state (mobile=${mobile}, collapsed=${collapsed})`, async () => {
  const h = setup({ mobile, collapsed }); const pending = h.control.refresh(true);
  h.document.activeElement = h.$('search');
  h.reads[0].resolve(makeCatalog()); await pending;
  assert.equal(h.document.body.classList.contains('mobile-library-collapsed'), collapsed);
  assert.equal(h.document.activeElement, h.$('search'));
});

for (const target of ['0', '1']) test(`explicit mobile selection ${target} retains collapse behavior`, async () => {
  const h = setup({ mobile: true }); await h.control.select(h.current.state.items[Number(target)]);
  assert.equal(h.document.body.classList.contains('mobile-library-collapsed'), true);
});

test('automatic replacement of a removed mobile selection still reveals the new detail', async () => {
  const h = setup({ mobile: true, current: '15' }), pending = h.control.refresh(true), next = makeCatalog();
  next.items = next.items.filter(item => item.key !== '15'); h.reads[0].resolve(next); await pending;
  assert.equal(h.current.selected.key, '0'); assert.equal(h.document.body.classList.contains('mobile-library-collapsed'), true);
});

test('initial mobile refresh retains detail-first behavior', async () => {
  const h = setup({ mobile: true, initial: null, current: null }), pending = h.control.refresh(true);
  h.reads[0].resolve(makeCatalog()); await pending;
  assert.equal(h.document.body.classList.contains('mobile-library-collapsed'), true);
});

for (const collapseWhileReading of [true, false]) test(`same-item refresh respects a delayed user ${collapseWhileReading ? 'collapse' : 'expand'}`, async () => {
  const h = setup({ mobile: true, collapsed: !collapseWhileReading }), pending = h.control.refresh(true);
  h.document.body.classList[collapseWhileReading ? 'add' : 'remove']('mobile-library-collapsed');
  h.reads[0].resolve(makeCatalog()); await pending;
  assert.equal(h.document.body.classList.contains('mobile-library-collapsed'), collapseWhileReading);
});
