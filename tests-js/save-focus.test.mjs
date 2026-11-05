import test from 'node:test';
import assert from 'node:assert/strict';
import { readOnce } from "../src/audio_review_desk/static/read-once.js";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Focus-policy regression suite for actual workbench save/select/completion code.
// DOM doubles model a focused native control blurring when disabled. These are
// deterministic ownership tests, not native-browser or screen-reader acceptance.
// Run with ARD_FOCUS_WORKBENCH=/absolute/path/to/workbench.js node --test FILE.
const file = process.env.ARD_FOCUS_WORKBENCH || fileURLToPath(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url));
const source = readFileSync(file, 'utf8');
const html = readFileSync(process.env.ARD_FOCUS_HTML || resolve(dirname(file), 'workbench.html'), 'utf8');
const { continueQueue } = await import(pathToFileURL(resolve(dirname(file), 'ui.js')));
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Source boundary missing: ${start} / ${end}`);
  return source.slice(a, b);
}
const code = [
  extract('async function select(item', 'async function refresh('),
  extract('function setBusy(value)', 'async function batch()'),
  extract('function translate()', 'for (const name of issueNames)'),
].join('\n');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const item = (key, { decoded = false, status = 'pending' } = {}) => ({ key, label: `Clip ${key}`, quality: { duration: 10, decoded }, review: { version: 1, status, note: `Saved ${key}`, markers: [] } });
const catalog = (keys = ['A', 'B'], { decoded = false, pending = keys.length } = {}) => ({ workspace_id: 'focus-test', items: keys.map(key => item(key, { decoded })), stats: { files: keys.length, review_counts: { pending, pass: 0 }, human_approved_seconds: 0 } });

function setup({ decoded = false, keys = ['A', 'B'], visibleKeys = null, selectionGate = null, focus = 'saveNext', detachMarker = false, valid = true, flush = true, boundedReads = false, shortcuts = false, mobile = false } = {}) {
  const nodes = new Map(), reads = [], writes = [], notices = [], focuses = [], renders = [], docListeners = new Map();
  let historyCalls = 0, fallbackCalls = 0, dropMarker = detachMarker, renderHook = null;
  let now = 0, nextTimer = 0;
  const timers = new Map();
  const runtime = {
    AbortController,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    get count() { return timers.size; },
    async tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await tick();
    },
  };
  const actualRequest = Function("fetch", "errorText", "language", "readOnce", `${extract("async function request(", "const post =")}; return request;`)(
    (path, options) => { const wait = deferred(); reads.push({ path, signal: options?.signal, ...wait }); return wait.promise; },
    error => error.code, "en", args => readOnce(args, runtime));
  const document = { body: null, activeElement: null, documentElement: {}, querySelectorAll: () => [],
    addEventListener(type, handler) { docListeners.set(type, [...(docListeners.get(type) || []), handler]); },
    removeEventListener(type, handler) { docListeners.set(type, (docListeners.get(type) || []).filter(row => row !== handler)); },
  };
  const emitDocument = (type, target, relatedTarget = null) => {
    for (const fn of [...(docListeners.get(type) || [])]) fn({ type, target, relatedTarget });
  };
  class Element {
    constructor(id) { this.id = id; this.dataset = {}; this.isConnected = true; this._hidden = false; this._disabled = false; this.value = ''; this.textContent = ''; this.open = false; this.elements = []; this.parentElement = null; this.attributes = new Map(); this.listeners = new Map(); this.classes = new Set(); this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x), contains: x => this.classes.has(x), toggle: (x, forced) => { const enabled = forced ?? !this.classes.has(x); enabled ? this.classes.add(x) : this.classes.delete(x); return enabled; } }; }
    get hidden() { return this._hidden; }
    set hidden(value) { this._hidden = value; if (value && this.contains(document.activeElement)) document.activeElement = document.body; }
    get disabled() { return this._disabled; }
    set disabled(value) { this._disabled = value; if (value && document.activeElement === this) this.blur(); }
    contains(node) { return this === node || (node?.parentElement ? this.contains(node.parentElement) : false); }
    closest(selector) { return selector === '#reviewForm' && $('reviewForm').contains(this) ? $('reviewForm') : null; }
    getClientRects() { return this.hidden || !this.isConnected || (this.parentElement && !this.parentElement.getClientRects().length) || (mobile && this.id === 'search' && document.body.classList.contains('mobile-library-collapsed')) ? [] : [{}]; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === 'tabindex') this.tabIndex = Number(value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
    focus(options) { if (this.disabled || !this.getClientRects().length) return; const previous = document.activeElement; document.activeElement = this; focuses.push({ id: this.id, options }); for (const fn of this.listeners.get('focus') || []) fn({ target: this, relatedTarget: previous }); emitDocument('focusin', this, previous); }
    blur() { if (document.activeElement !== this) return; document.activeElement = document.body; emitDocument('focusout', this, document.body); }
    reportValidity() { return valid; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); };
  document.body = $('body'); document.activeElement = document.body;
  $('reviewForm').elements = ['save', 'saveNext', 'note', 'score', 'trimStart', 'trimEnd'].map(id => $(id));
  for (const node of $('reviewForm').elements) node.parentElement = $('reviewForm');
  // These controls belong to the form through HTML's form attribute, not ancestry.
  for (const id of ['trimStart', 'trimEnd']) $(id).parentElement = $('rangeEditor');
  $('markerEdit').parentElement = $('markerList');
  for (const id of ['reviewForm', 'rangeEditor', 'markerList', 'play']) $(id).parentElement = $('detailPanel');
  for (const id of ['queueCompleteTitle', 'reopenLast']) $(id).parentElement = $('queueComplete');
  $('detailPanel').hidden = false; $('queueComplete').hidden = true;
  const noop = () => {};
  const env = { validateNote: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    createWaveformReader,
    $, document, initial: catalog(keys, { decoded }), continueQueue,
    filterVisible: items => visibleKeys ? items.filter(row => visibleKeys.includes(row.key)) : items,
    request(path, options) { if (boundedReads) return actualRequest(path, options); const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post(path, payload) { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => notices.push(args), t: key => key, errorText: error => error.message, language: 'en',
    markersView: { refresh: noop, captureFocus: () => document.activeElement === $('markerEdit') ? () => { fallbackCalls++; $('markerReplacement').focus({ preventScroll: true }); } : null, flush: () => flush },
    draftValues: () => ({ note: $('note').value }), reviewPayload: (target, values) => ({ ...target.review, note: values.note }),
    discardAllowed: () => selectionGate ? selectionGate.promise : Promise.resolve(true), invalidateHistory: noop,
    renderSummary: noop, renderQueue: noop,
    afterRender(restore, current, busy) {
      renders.push({ restore, key: current?.key, busy });
      if (dropMarker && busy) { const old = $('markerEdit'); old.blur(); old.isConnected = false; dropMarker = false; }
      if (current) { $('clipTitle').textContent = current.label; $('detailPanel').hidden = false; $('queueComplete').hidden = true; }
      if (restore && current) $('note').value = current.review.note;
      renderHook?.();
    },
    loadHistory: () => { historyCalls++; },
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: mobile }),
    audition: { cancel: noop }, rememberPosition: noop, media: { cancel: noop, load: noop, pause: noop },
    player: { pause: noop, load: noop, removeAttribute: noop }, updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop, setLanguage: noop }, waveformView: { cancelDrag() {}, reset: noop }, drawWave: noop,
    resumedTime: () => 0, formatTime: value => String(value), transport: { refresh: noop }, commandMenu: { refresh: noop }, renderJob: noop,
  };
  const control = Function(...Object.keys(env), `

    function notice(message = '', ...args) {
      noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null;
      if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice();
    }

    let spectrumVisible = false, job = null, noticeResolver = null;
    let state = initial, selected = state.items[0], busy = false, dirty = true, visibleCache = null,
      generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      pendingCompletion = null, suspendedCompletion = null, variant = 'a', wave = {};
    const savedThisSession = new Set();
    const listeningMemory = { get: () => ({}) };
    function visibleItems() { return filterVisible(state.items); }
    function renderDetails(restore = true) { afterRender(restore, selected, busy); }
    ${code}
    ${shortcuts ? extract('document.addEventListener("keydown", (event) => {', 'let theme =') : ''}
    $('note').value = 'Unsaved draft';
    return { save, select, showCompletion, translateTo(value) { language = value; translate(); }, supersedeSelection: invalidateRefresh, edit(note) { $('note').value = note; dirty = true; }, get current() { return { state, selected, busy, dirty, generation }; } };
  `)(...Object.values(env));
  $(focus).focus(); focuses.length = 0;
  return { $, document, focuses, reads, writes, notices, renders, control, runtime, onRender(fn) { renderHook = fn; },
    get historyCalls() { return historyCalls; }, get fallbackCalls() { return fallbackCalls; },
    get focusListeners() { return (docListeners.get('focusin') || []).length; },
    get current() { return control.current; },
    save: advance => control.save(advance),
    shortcut(flags = {}) {
      const event = { key: 'Enter', target: document.activeElement, repeat: false, ctrlKey: false, metaKey: false,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...flags };
      for (const listener of docListeners.get('keydown') || []) listener(event);
      return event;
    },
  };
}
async function commit(h, next = catalog(['A', 'B'])) {
  assert.equal(h.writes.length, 1);
  h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2, status: 'pass' } });
  await tick(); assert.equal(h.reads[0]?.path, '/api/state');
  const saved = next.items.find(row => row.key === h.current.selected.key);
  if (saved) saved.review = { ...saved.review, version: 2, status: 'pass' };
  next.stats.review_counts.pending = next.items.filter(row => row.review.status === 'pending').length;
  next.stats.review_counts.pass = next.items.filter(row => row.review.status === 'pass').length;
  h.reads[0].resolve(next); await tick();
}

// clipTitle should be focusable programmatically without becoming an extra Tab stop.
test('next-clip heading accepts programmatic focus without entering the tab sequence', () => {
  const heading = html.match(/<h2\b[^>]*\bid="clipTitle"[^>]*>/)?.[0];
  assert.ok(heading, 'clip heading exists'); assert.match(heading, /\btabindex="-1"/i);
});

test('failed Save and continue restores the submit control and retains the draft', async () => {
  const h = setup(); const saving = h.save(true);
  assert.equal(h.document.activeElement, h.document.body);
  h.writes[0].reject(new Error('offline')); await saving;
  assert.equal(h.document.activeElement, h.$('saveNext'));
  assert.equal(h.focuses.at(-1)?.options?.preventScroll, true, 'restoration should avoid a needless page jump');
  assert.equal(h.current.selected.key, 'A'); assert.equal(h.current.dirty, true);
  assert.equal(h.$('note').value, 'Unsaved draft'); assert.equal(h.notices.at(-1)[0], 'offline');
  assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 0);
});

test('successful Save and continue moves focus to the newly selected clip heading', async () => {
  const h = setup(); const saving = h.save(true); await commit(h); await saving;
  assert.equal(h.current.selected.key, 'B'); assert.equal(h.$('clipTitle').textContent, 'Clip B');
  assert.equal(h.document.activeElement, h.$('clipTitle')); assert.equal(h.current.dirty, false);
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 1);
  assert.notEqual(h.focuses.find(row => row.id === 'clipTitle').options?.preventScroll, true, 'new clip heading should be revealed in a stacked layout');
});

test('advance with no next visible clip restores the original submit control', async () => {
  const h = setup({ visibleKeys: ['A'] }); const saving = h.save(true);
  await commit(h, catalog(['A', 'B'], { pending: 1 })); await saving;
  assert.equal(h.current.selected.key, 'A'); assert.equal(h.document.activeElement, h.$('saveNext'));
  assert.equal(h.$('queueComplete').hidden, true); assert.equal(h.historyCalls, 1);
});

test('queue completion retains its existing completion-heading destination', async () => {
  const h = setup({ keys: ['A'] }); const saving = h.save(true);
  await commit(h, catalog(['A'], { pending: 0 })); await saving;
  assert.equal(h.document.activeElement, h.$('queueCompleteTitle'));
  assert.equal(h.$('detailPanel').hidden, true); assert.equal(h.$('queueComplete').hidden, false);
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 0);
});

for (const phase of ['review POST', 'catalog GET']) {
  test(`newer user focus during ${phase} survives successful advancement`, async () => {
    const h = setup(); const saving = h.save(true);
    if (phase === 'review POST') h.$('search').focus();
    h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2, status: 'pass' } }); await tick();
    if (phase === 'catalog GET') h.$('search').focus();
    h.reads[0].resolve(catalog()); await saving;
    assert.equal(h.current.selected.key, 'B'); assert.equal(h.document.activeElement, h.$('search'));
    assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 0);
  });
}

test('a failed advance never steals focus from a control used during the request', async () => {
  const h = setup(); const saving = h.save(true); h.$('search').focus();
  h.writes[0].reject(new Error('offline')); await saving;
  assert.equal(h.document.activeElement, h.$('search')); assert.equal(h.current.dirty, true);
});

test('next-clip focus is established while its waveform is still loading', async () => {
  const h = setup({ decoded: true }); const saving = h.save(true);
  await commit(h, catalog(['A', 'B'], { decoded: true }));
  assert.equal(h.reads[1]?.path, '/api/wave/B');
  assert.equal(h.focusListeners, 0, 'a hung waveform read must not retain focus observation');
  const focusedDuringLoad = h.document.activeElement;
  h.reads[1].resolve({ a: [], b: [] }); await saving;
  assert.equal(focusedDuringLoad, h.$('clipTitle')); assert.equal(h.document.activeElement, h.$('clipTitle'));
});

test('late waveform completion does not reclaim focus moved after the next clip appears', async () => {
  const h = setup({ decoded: true }); const saving = h.save(true);
  await commit(h, catalog(['A', 'B'], { decoded: true }));
  assert.equal(h.current.selected.key, 'B'); h.$('play').focus();
  h.reads[1].resolve({ a: [], b: [] }); await saving;
  assert.equal(h.document.activeElement, h.$('play'));
});

test('waveform failure does not undo the next-clip focus destination or the saved review', async () => {
  const h = setup({ decoded: true }); const saving = h.save(true);
  await commit(h, catalog(['A', 'B'], { decoded: true }));
  h.reads[1].reject(new Error('waveform offline')); await saving;
  assert.equal(h.document.activeElement, h.$('clipTitle')); assert.equal(h.current.selected.key, 'B');
  assert.equal(h.current.dirty, false); assert.equal(h.notices.at(-1)[0], 'waveform offline');
});

for (const success of [false, true]) {
  test(`ordinary Save still restores its source control after ${success ? 'success' : 'failure'}`, async () => {
    const h = setup({ focus: 'save' }); const saving = h.save(false);
    if (success) await commit(h); else h.writes[0].reject(new Error('offline'));
    await saving; assert.equal(h.document.activeElement, h.$('save')); assert.equal(h.current.selected.key, 'A');
    assert.equal(h.focusListeners, 0);
  });
}

test('ordinary Save retains its detached-marker focus fallback', async () => {
  const h = setup({ focus: 'markerEdit', detachMarker: true }); const saving = h.save(false);
  h.writes[0].reject(new Error('offline')); await saving;
  assert.equal(h.document.activeElement, h.$('markerReplacement')); assert.equal(h.fallbackCalls, 1);
});

test('no-next advancement restores an external form-associated trim control', async () => {
  const h = setup({ visibleKeys: ['A'], focus: 'trimStart' }); const saving = h.save(true);
  await commit(h, catalog(['A', 'B'], { pending: 1 })); await saving;
  assert.equal(h.document.activeElement, h.$('trimStart')); assert.equal(h.current.selected.key, 'A');
});

test('failed post-save catalog read still advances with a visible focus destination', async () => {
  const h = setup(); const saving = h.save(true);
  h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2, status: 'pass' } }); await tick();
  h.reads[0].reject(new Error('state offline')); await saving;
  assert.equal(h.current.selected.key, 'B'); assert.equal(h.document.activeElement, h.$('clipTitle'));
  assert.equal(h.writes.length, 1); assert.equal(h.current.dirty, false);
});

for (const [name, options] of [['native form invalidity', { valid: false }], ['invalid pending marker', { flush: false }]]) {
  test(`${name} prevents save without taking focus or writing data`, async () => {
    const h = setup(options); await h.save(true);
    assert.equal(h.document.activeElement, h.$('saveNext')); assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0);
  });
}


test('a newer focus choice remains revoked even when that control later blurs', async () => {
  const h = setup(); const saving = h.save(true);
  h.$('search').focus(); h.$('search').blur();
  await commit(h); await saving;
  assert.equal(h.current.selected.key, 'B');
  assert.equal(h.document.activeElement, h.document.body);
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 0);
});

for (const outcome of ['failure', 'next', 'no-next', 'completion']) {
  test(`focus observation is released after ${outcome}`, async () => {
    const h = setup(outcome === 'completion' ? { keys: ['A'] } : outcome === 'no-next' ? { visibleKeys: ['A'] } : {});
    const saving = h.save(true);
    if (outcome === 'failure') h.writes[0].reject(new Error('offline'));
    else await commit(h, catalog(outcome === 'completion' ? ['A'] : ['A', 'B']));
    await saving;
    assert.equal(h.focusListeners, 0);
  });
}

test('ordinary selection does not acquire save-specific focus ownership', async () => {
  const h = setup({ focus: 'search' });
  await h.control.select(item('B'));
  assert.equal(h.current.selected.key, 'B'); assert.equal(h.document.activeElement, h.$('search'));
  assert.equal(h.focusListeners, 0);
});


test('superseded selection does not call the save focus hook or leave an observer behind', async () => {
  const selectionGate = deferred(), h = setup({ selectionGate });
  const saving = h.save(true); await commit(h);
  assert.equal(h.current.selected.key, 'A', 'selection is waiting at its existing intent check');
  h.$('search').focus(); h.control.supersedeSelection();
  selectionGate.resolve(true); await saving;
  assert.equal(h.current.selected.key, 'A'); assert.equal(h.document.activeElement, h.$('search'));
  assert.equal(h.focuses.filter(row => row.id === 'clipTitle').length, 0); assert.equal(h.focusListeners, 0);
});


for (const advance of [false, true]) for (const stage of ['fetch', 'body']) {
  test(`acknowledged ${advance ? 'Save and continue' : 'Save'} unlocks after a hung catalog ${stage}`, async () => {
    const h = setup({ boundedReads: true, focus: advance ? 'saveNext' : 'save' }), saving = h.save(advance), body = deferred();
    const committed = { ...h.current.selected.review, version: 2, status: 'pass', note: 'Committed note' };
    h.writes[0].resolve({ review: committed }); await tick();
    if (stage === 'body') { h.reads[0].resolve({ ok: true, json: () => body.promise }); await tick(); }
    assert.equal(h.current.busy, true); assert.equal(h.current.dirty, false);
    await h.runtime.tick(7999); assert.equal(h.$('note').disabled, true);
    await h.runtime.tick(1);
    assert.equal(h.current.busy, false, 'deadline releases review controls even if fetch/body ignores abort');
    await saving;
    assert.equal(h.$('note').disabled, false); assert.equal(h.$('save').disabled, false);
    assert.deepEqual(h.notices.at(-1), ['savedRefresh'], 'saved-but-totals warning must not auto-dismiss');
    assert.equal(h.writes.length, 1); assert.equal(h.current.state.items[0].review, committed);
    assert.equal(h.current.state.stats.review_counts.pending, 2, 'never guess server-derived totals');
    assert.equal(h.current.selected.key, advance ? 'B' : 'A');
    assert.equal(h.document.activeElement, h.$(advance ? 'clipTitle' : 'save'));
    assert.equal(h.focusListeners, 0); assert.equal(h.runtime.count, 0); assert.equal(h.reads[0].signal.aborted, true);
    // A transport that ignores abort must not apply its stale result after editing resumes.
    h.control.edit('New draft'); h.$('search').focus(); const state = h.current.state;
    const stale = catalog(['old']);
    if (stage === 'fetch') h.reads[0].resolve({ ok: true, json: async () => stale }); else body.resolve(stale);
    await tick(); assert.equal(h.current.state, state); assert.equal(h.current.dirty, true);
    assert.equal(h.$('note').value, 'New draft'); assert.equal(h.document.activeElement, h.$('search'));
  });
}

test('timed-out catalog retains the committed version for the next explicit Save', async () => {
  const h = setup({ boundedReads: true, focus: 'save' }), first = h.save(false);
  h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2 } }); await tick();
  await h.runtime.tick(8000); assert.equal(h.current.busy, false); await first;
  h.control.edit('Next draft'); const second = h.save(false);
  assert.equal(h.writes.length, 2); assert.equal(h.writes[1].payload.version, 2);
  assert.equal(h.writes[1].payload.note, 'Next draft');
  h.writes[1].resolve({ review: { ...h.current.selected.review, version: 3, note: 'Next draft' } }); await tick();
  h.reads[1].resolve({ ok: true, json: async () => catalog() }); await second;
  assert.equal(h.current.selected.review.version, 3); assert.equal(h.current.dirty, false);
  assert.deepEqual(h.notices.at(-1), ['saved', true]); assert.equal(h.runtime.count, 0);
  h.reads[0].reject(new Error('late rejected read')); await tick();
  assert.equal(h.current.selected.review.version, 3); assert.deepEqual(h.notices.at(-1), ['saved', true]);
});

test('catalog timeout never steals focus chosen while the acknowledged Save was waiting', async () => {
  const h = setup({ boundedReads: true }), saving = h.save(true);
  h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2 } }); await tick(); h.$('search').focus();
  await h.runtime.tick(8000); assert.equal(h.current.busy, false); await saving;
  assert.equal(h.current.selected.key, 'B'); assert.equal(h.document.activeElement, h.$('search'));
  assert.equal(h.focusListeners, 0); h.reads[0].reject(new Error('late')); await tick();
});

test('missing post-save totals cannot announce completion from stale zero-pending counts', async () => {
  const h = setup({ keys: ['A'], boundedReads: true }); h.current.state.stats.review_counts.pending = 0;
  const saving = h.save(true);
  h.writes[0].resolve({ review: { ...h.current.selected.review, status: 'pending', version: 2 } }); await tick();
  await h.runtime.tick(8000); assert.equal(h.current.busy, false); await saving;
  assert.equal(h.$('queueComplete').hidden, true); assert.equal(h.$('detailPanel').hidden, false);
  assert.equal(h.document.activeElement, h.$('saveNext')); assert.deepEqual(h.notices.at(-1), ['savedRefresh']);
  h.reads[0].reject(new Error('late')); await tick();
});

for (const modifier of ['ctrlKey', 'metaKey']) test(`${modifier}+Enter repeat cannot send another POST after the actual save completes`, async () => {
  const h = setup({ shortcuts: true, focus: 'note' });
  assert.equal(h.shortcut({ [modifier]: true }).defaultPrevented, true); assert.equal(h.writes.length, 1);
  h.shortcut({ [modifier]: true, repeat: true }); assert.equal(h.writes.length, 1);
  await commit(h); await tick(); assert.equal(h.current.busy, false); assert.equal(h.current.selected.review.version, 2);
  for (let i = 0; i < 3; i++) assert.equal(h.shortcut({ [modifier]: true, repeat: true }).defaultPrevented, true);
  assert.equal(h.writes.length, 1, 'a held shortcut is not a new save after the busy guard unlocks');
  assert.equal(h.current.dirty, false);
  h.shortcut({ [modifier]: true }); assert.equal(h.writes.length, 2, 'a new press remains an explicit save');
  h.writes[1].resolve({ review: { ...h.current.selected.review, version: 3 } }); await tick();
  const next = catalog(); next.items[0].review = { ...next.items[0].review, version: 3, status: 'pass' };
  h.reads[1].resolve(next); await tick(); assert.equal(h.current.busy, false); assert.equal(h.current.selected.review.version, 3);
});

// Authored after the launcher restriction; NOT RUN. These model focus ownership,
// not native focus relocation on hidden ancestors or screen-reader delivery.
function reopenFixture({ focus = 'reopenLast', blurOnHide = true, selected = {}, redirect = false } = {}) {
  let click; const calls = [], document = { body: {}, activeElement: null };
  const nodes = {
    reopenLast: { addEventListener(type, handler) { assert.equal(type, 'click'); click = handler; } },
    clipTitle: { focus() { document.activeElement = this; calls.push('heading'); } },
    other: {}, queueComplete: { hidden: false }, detailPanel: { hidden: true },
  };
  document.activeElement = focus === 'body' ? document.body : nodes[focus];
  const $ = id => nodes[id];
  const renderDetails = restore => {
    calls.push(['render', restore]); nodes.queueComplete.hidden = true; nodes.detailPanel.hidden = false;
    if (blurOnHide && document.activeElement === nodes.reopenLast) document.activeElement = document.body;
    if (redirect) document.activeElement = nodes.other;
  };
  const handler = source.match(/\$\("reopenLast"\)\.addEventListener\("click", \(\) => \{[\s\S]*?\n\}\);/)[0];
  new Function('$', 'document', 'selected', 'renderDetails', handler)($, document, selected, renderDetails);
  return { click: () => click(), document, nodes, calls };
}
for (const blurOnHide of [true, false]) test(`reopen last transfers owned focus to visible detail heading (blur=${blurOnHide})`, () => {
  const h = reopenFixture({ blurOnHide }); h.click();
  assert.equal(h.nodes.queueComplete.hidden, true); assert.equal(h.nodes.detailPanel.hidden, false);
  assert.equal(h.document.activeElement, h.nodes.clipTitle);
  assert.deepEqual(h.calls, [['render', false], 'heading']);
});
for (const focus of ['other', 'body']) test(`reopen last does not claim ${focus} focus from programmatic activation`, () => {
  const h = reopenFixture({ focus }), previous = h.document.activeElement; h.click();
  assert.equal(h.document.activeElement, previous); assert.deepEqual(h.calls, [['render', false]]);
});
test('reopen last with no selection keeps completion and focus unchanged', () => {
  const h = reopenFixture({ selected: null }); h.click();
  assert.equal(h.document.activeElement, h.nodes.reopenLast); assert.equal(h.nodes.queueComplete.hidden, false);
  assert.deepEqual(h.calls, []);
});
test('reopen last respects another control focused during rendering', () => {
  const h = reopenFixture({ redirect: true }); h.click();
  assert.equal(h.document.activeElement, h.nodes.other); assert.deepEqual(h.calls, [['render', false]]);
});

for (const mobile of [false, true]) for (const phase of ['review POST', 'catalog GET']) for (const blur of [false, true]) {
  test(`completion respects newer outside focus (mobile=${mobile}, ${phase}, later blur=${blur})`, async () => {
    const h = setup({ keys: ['A'], mobile }); const saving = h.save(true);
    if (phase === 'catalog GET') {
      h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2, status: 'pass' } }); await tick();
    }
    h.$('search').focus(); if (blur) h.$('search').blur();
    await commit(h, catalog(['A'], { pending: 0 })); await saving;
    assert.equal(h.$('queueComplete').hidden, false); assert.equal(h.$('detailPanel').hidden, true);
    assert.equal(h.document.activeElement, blur ? h.document.body : h.$('search'));
    assert.equal(h.focuses.filter(row => row.id === 'queueCompleteTitle').length, 0);
    if (!blur) assert.ok(h.$('search').getClientRects().length);
  });
}

for (const mobile of [false, true]) for (const phase of ['review POST', 'catalog GET']) {
  test(`completion safely transfers newer audio-control focus before hiding details (mobile=${mobile}, ${phase})`, async () => {
    const h = setup({ keys: ['A'], mobile }); const saving = h.save(true);
    if (phase === 'catalog GET') {
      h.writes[0].resolve({ review: { ...h.current.selected.review, version: 2, status: 'pass' } }); await tick();
    }
    h.$('play').focus(); await commit(h, catalog(['A'], { pending: 0 })); await saving;
    assert.equal(h.document.activeElement, h.$('queueCompleteTitle'));
    assert.ok(h.$('queueCompleteTitle').getClientRects().length);
    assert.equal(h.focuses.filter(row => row.id === 'queueCompleteTitle').length, 1);
  });
}

test('normal mobile completion retains a visible completion-heading destination', async () => {
  const h = setup({ keys: ['A'], mobile: true }); const saving = h.save(true);
  await commit(h, catalog(['A'], { pending: 0 })); await saving;
  assert.equal(h.document.activeElement, h.$('queueCompleteTitle')); assert.ok(h.$('queueCompleteTitle').getClientRects().length);
});

for (const id of ['search', 'language', 'reopenLast', 'queueCompleteTitle']) for (const mobile of [false, true]) test(`full completion translation preserves ${id} focus (mobile=${mobile})`, () => {
  const h = setup({ keys: ['A'], mobile }); h.control.showCompletion({ focus: true }); h.$(id).focus();
  const before = h.focuses.length, rendersBefore = h.renders.length;
  h.control.translateTo('zh');
  assert.equal(h.document.documentElement.lang, 'zh-CN');
  assert.equal(h.renders.length, rendersBefore + 1, 'detail translation still runs');
  assert.equal(h.renders.at(-1).restore, false); assert.equal(h.$('note').value, 'Unsaved draft');
  assert.equal(h.$('queueComplete').hidden, false); assert.equal(h.$('detailPanel').hidden, true);
  assert.equal(h.document.activeElement, h.$(id)); assert.ok(h.$(id).getClientRects().length);
  assert.equal(h.focuses.length, before + (['reopenLast', 'queueCompleteTitle'].includes(id) ? 1 : 0));
  h.control.translateTo('en'); assert.equal(h.document.activeElement, h.$(id));
});

test('completion translation preserves a different focus target chosen during rendering', () => {
  const h = setup({ keys: ['A'] }); h.control.showCompletion({ focus: true }); h.$('reopenLast').focus();
  h.onRender(() => h.$('search').focus()); h.control.translateTo('zh');
  assert.equal(h.document.activeElement, h.$('search'));
});

test('completion translation never restores a detached completion control', () => {
  const h = setup({ keys: ['A'] }); h.control.showCompletion({ focus: true }); h.$('reopenLast').focus();
  h.onRender(() => { h.$('reopenLast').isConnected = false; }); h.control.translateTo('zh');
  assert.equal(h.document.activeElement, h.document.body);
});
