import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountMarkers } from '../src/audio_review_desk/static/markers.js';
import { reviewPayload, continueQueue } from '../src/audio_review_desk/static/ui.js';

// Real save/select handlers, marker editor and payload builder. Only DOM,
// network and unrelated media/rendering services are doubled. This is not a
// native-browser focus or assistive-technology acceptance test.
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing production boundary: ${start}`);
  return source.slice(a, b);
}
const handlers = [
  extract('async function select(item', 'function revealQueueSelection()'),
  extract('function createFeedbackOwner()', 'async function refresh('),
  extract('function setBusy(value)', 'async function batch()'),
].join('\n');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const duplicate = () => ({ time: 5, text: 'same' });
const clip = (key, markers = []) => ({ key, label: `Clip ${key}`, quality: { duration: 20, decoded: true }, review: { version: 1, status: 'pending', markers } });

function setup(t, rows) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Map(), nodes = new Map(), writes = [], reads = [], notices = [], refreshes = [];
  const document = {
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(row => row !== fn)); },
  };
  class Element {
    constructor(id = '') { Object.assign(this, { id, children: [], parentElement: null, className: '', value: '', style: {}, attributes: {}, listeners: new Map(), hidden: false }); }
    get classList() { return { contains: key => this.className.split(' ').includes(key), add: key => { this.className += ` ${key}`; } }; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    get disabled() { return this._disabled; }
    set disabled(value) { this._disabled = value; if (value && document.activeElement === this) this.blur(); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) {
      if (this.children.some(child => child.contains(document.activeElement))) document.activeElement.blur();
      for (const child of this.children) child.parentElement = null;
      this.children = []; this.append(...children);
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.startsWith('.') && this.classList.contains(selector.slice(1)); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    emit(type) { for (const fn of this.listeners.get(type) || []) fn({ target: this }); }
    click() { if (!this.disabled) this.emit('click'); }
    focus(options) {
      if (this.disabled || !this.isConnected) return;
      document.activeElement = this; this.focusOptions = options;
      for (const fn of listeners.get('focusin') || []) fn({ target: this });
    }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
    reportValidity() { return true; }
  }
  document.body = new Element('body'); document.activeElement = document.body;
  document.createElement = () => new Element(); globalThis.document = document;
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const $ = id => { if (!nodes.has(id)) { const node = new Element(id); nodes.set(id, node); document.body.append(node); } return nodes.get(id); };
  $('reviewForm').elements = ['save', 'saveNext', 'note'].map($);
  const player = { currentTime: 5, pause() {}, load() {}, removeAttribute() {} };
  const markersView = mountMarkers({ input: $('markerText'), add: $('addMarker'), list: $('markerList'), ticks: $('markerTicks'), player, duration: () => 20, t: key => key, onChange() {}, onError: error => notices.push(error) });
  markersView.set(rows, false);
  const initial = { workspace_id: 'identity', items: [clip('A', rows), clip('B')], stats: { files: 2, review_counts: { pending: 2, pass: 0 } } };
  const noop = () => {};
  const env = { $, document, markersView, initial, reviewPayload, continueQueue,
    draftValues: () => ({ status: 'pass', score: '', trimStart: '', trimEnd: '', issues: [], note: '', markers: markersView.get() }),
    post(path, payload) { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    request(path) { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    captureNotice: value => notices.push(value), t: key => key, errorText: error => error.message, language: 'en',
    validateNote: noop, invalidateHistory: noop, renderSummary: noop, renderQueue: noop, loadHistory: noop,
    afterRender(restore, selected, busy) {
      refreshes.push({ restore, busy });
      $('clipTitle').textContent = selected.label;
      if (restore) markersView.set(selected.review.markers, busy || !selected.quality.decoded);
      else markersView.refresh(busy || !selected.quality.decoded);
    },
    discardAllowed: async () => true, audition: { cancel: noop }, rememberPosition: noop,
    waveformReader: { cancel: noop, load: async () => true }, media: { cancel: noop, load: noop, pause: noop }, player,
    sessionStorage: { setItem: noop }, matchMedia: () => ({ matches: false }), updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop }, revealQueueSelection: noop,
    resumedTime: () => 0, formatTime: String,
  };
  const control = Function(...Object.keys(env), `
    let state = initial, selected = state.items[0], busy = false, dirty = true, visibleCache = null,
      generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      suspendedCompletion = null, variant = 'a', wave = {}, waveStatus = null, waveNotice = null,
      noticeGeneration = 0, noticeResolver = null;
    const draftSession = null, listeningMemory = null, savedThisSession = new Set();
    function notice(message) { noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null; captureNotice(noticeResolver ? noticeResolver() : message); }
    function visibleItems() { return state.items; }
    function renderDetails(restore = true) { afterRender(restore, selected, busy); }
    ${handlers}
    return { save, get current() { return { selected, busy, dirty }; } };
  `)(...Object.values(env));
  return { $, document, markersView, player, writes, reads, notices, refreshes, control,
    note(index) { return $('markerList').children[index].querySelector('.marker-note'); },
    edit(index, field, value) {
      this.note(index).click();
      const input = $('markerList').querySelector(`.marker-edit-${field}`);
      if (value !== undefined) { input.value = value; input.emit('input'); }
      input.focus(); return input;
    },
    get focusListeners() { return (listeners.get('focusin') || []).length; },
  };
}
async function settle(h, saving, outcome) {
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].path, '/api/review');
  if (outcome === 'POST rejection') h.writes[0].reject(new Error('post offline'));
  else {
    const review = { ...h.control.current.selected.review, ...h.writes[0].payload, version: 2 };
    h.writes[0].resolve({ review }); await tick();
    assert.equal(h.reads[0]?.path, '/api/state');
    if (outcome === 'catalog rejection') h.reads[0].reject(new Error('catalog offline'));
    else h.reads[0].resolve({ items: [{ ...clip('A'), review }, clip('B')], stats: { review_counts: { pending: 1 } } });
  }
  await saving;
  assert.equal(h.control.current.busy, false);
  assert.equal(h.control.current.dirty, outcome === 'POST rejection');
  assert.equal(h.focusListeners, 0);
  assert.ok(h.refreshes.some(row => row.busy && !row.restore));
  assert.ok(h.refreshes.some(row => !row.busy && !row.restore));
}

const scenarios = [
  { name: 'second duplicate unchanged', index: 1, field: 'text', expected: 1 },
  { name: 'last duplicate unchanged', index: 2, field: 'text', expected: 2 },
  { name: 'last duplicate moves earlier', index: 2, field: 'time', value: '1', expected: 0 },
  { name: 'second duplicate moves later', index: 1, field: 'time', value: '9', expected: 2 },
  { name: 'last row time edit collides with duplicate values', index: 2, field: 'time', value: '5', times: [5, 5, 9], expected: 2 },
  { name: 'last duplicate edited to the same value', index: 2, field: 'text', value: ' same ', expected: 2 },
  { name: 'last duplicate with simultaneous identical pending add', index: 2, field: 'text', pending: true, expected: 2 },
  { name: 'reordered last duplicate with earlier pending add', index: 2, field: 'time', value: '9', pending: true, expected: 3 },
];
for (const scenario of scenarios) for (const outcome of ['success', 'POST rejection', 'catalog rejection']) {
  test(`${scenario.name}: real Save restores its row after ${outcome}`, async t => {
    const rows = (scenario.times || [5, 5, 5]).map(time => ({ time, text: 'same' })), h = setup(t, rows);
    const original = h.edit(scenario.index, scenario.field, scenario.value);
    if (scenario.pending) h.$('markerText').value = 'same';
    const saving = h.control.save(false);
    assert.equal(original.isConnected, false);
    assert.equal(h.document.activeElement, h.document.body);
    const expected = rows.map((row, index) => ({ ...row, time: index === scenario.index && scenario.field === 'time' ? Number(scenario.value) : row.time }));
    if (scenario.pending) expected.push(duplicate());
    expected.sort((a, b) => a.time - b.time);
    const payload = h.writes[0].payload;
    assert.deepEqual(payload.markers, expected);
    for (const row of payload.markers) assert.deepEqual(Reflect.ownKeys(row).sort(), ['text', 'time'], 'no private identity in payload, including Symbols');
    assert.deepEqual(JSON.parse(JSON.stringify(payload)).markers, expected);
    await settle(h, saving, outcome);
    assert.equal(h.document.activeElement, h.note(scenario.expected));
    assert.deepEqual(h.document.activeElement.focusOptions, { preventScroll: true });
    assert.deepEqual(h.markersView.get(), expected);
    if (scenario.pending) assert.equal(h.$('markerText').value, '');
    if (outcome === 'catalog rejection') assert.equal(h.notices.at(-1), 'savedRefresh');
    if (outcome === 'POST rejection') assert.equal(h.notices.at(-1), 'post offline');
  });
}

for (const outcome of ['success', 'POST rejection', 'catalog rejection']) for (const blur of [false, true]) {
  test(`newer focus is never stolen after ${outcome}, subsequently blurred=${blur}`, async t => {
    const h = setup(t, [duplicate(), duplicate(), duplicate()]); h.edit(2, 'text');
    const saving = h.control.save(false); h.$('search').focus(); if (blur) h.$('search').blur();
    await settle(h, saving, outcome);
    assert.equal(h.document.activeElement, blur ? h.document.body : h.$('search'));
  });
}
for (const outcome of ['success', 'catalog rejection']) for (const newerFocus of [false, true]) {
  test(`Save and continue from last duplicate keeps next-clip heading policy: ${outcome}, newer focus=${newerFocus}`, async t => {
    const h = setup(t, [duplicate(), duplicate(), duplicate()]); h.edit(2, 'time', '1');
    const saving = h.control.save(true); if (newerFocus) h.$('search').focus();
    await settle(h, saving, outcome);
    assert.equal(h.control.current.selected.key, 'B');
    assert.equal(h.document.activeElement, h.$(newerFocus ? 'search' : 'clipTitle'));
    assert.equal(h.$('clipTitle').textContent, 'Clip B');
    assert.deepEqual(h.markersView.get(), []);
  });
}

for (const outcome of ['success', 'catalog rejection']) {
  test(`new focus during catalog GET survives ${outcome}`, async t => {
    const h = setup(t, [duplicate(), duplicate(), duplicate()]); h.edit(2, 'text');
    const saving = h.control.save(false);
    const review = { ...h.control.current.selected.review, version: 2 };
    h.writes[0].resolve({ review }); await tick();
    assert.equal(h.reads[0]?.path, '/api/state');
    h.$('search').focus();
    if (outcome === 'catalog rejection') h.reads[0].reject(new Error('catalog offline'));
    else h.reads[0].resolve({ items: [clip('A'), clip('B')], stats: { review_counts: { pending: 1 } } });
    await saving;
    assert.equal(h.document.activeElement, h.$('search'));
    assert.equal(h.focusListeners, 0);
  });
}
