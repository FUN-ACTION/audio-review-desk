import test from "node:test";
import assert from "node:assert/strict";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readFileSync } from "node:fs";
import { filterItems, sortItems, reviewPayload, sameReview, formatTime, continueQueue } from "../src/audio_review_desk/static/ui.js";
import { errorText as actualErrorText } from "../src/audio_review_desk/static/errors.js";
import { words } from "../src/audio_review_desk/static/copy.js";

// Real batch, refresh, selection, filtering and review-form rendering with deferred
// I/O and DOM/media doubles. This is not native-browser acceptance.
const source = readFileSync(process.env.ARD_BATCH_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = [
  extract("let discardResolver =", "for (const name of issueNames)"),
  extract('$("language").addEventListener("change"', '$("refresh").addEventListener'),
  extract('$("exportMenu").addEventListener("toggle"', 'for (const dialog of document.querySelectorAll("dialog"))'),
  extract('for (const id of ["search", "filter", "sort"])', '$("selectAll").addEventListener'),
  extract("function visibleItems()", "function clearSelection()"),
  extract("function draftValues()", "function range()"),
  extract("function renderDetails(", "function showCompletion("),
  extract("async function batch()", "async function switchVariant("),
].join("\n");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const review = (patch = {}) => ({ status: "pass", score: 0, note: "keep note", issues: ["noise"], markers: [{ time: 0.125, text: "keep marker" }], trim_start: 0, trim_end: 5.123456, version: 4, updated_utc: "2026-11-03T20:00:00Z", origin: "human_ui", ...patch });
const item = (key, decoded = true) => ({ key, id: key, label: key, source_id: key, source_start: 0, source_end: 10, eligible: true,
  quality: { decoded, duration: 10, flags: [], sample_rate: 48000, channels: 1, rms_dbfs: -20, peak: 0.5, leading_quiet_seconds: 0, trailing_quiet_seconds: 0 },
  review: review({ status: key === "A" ? "pass" : "pending", ...(decoded ? {} : { score: null, markers: [], trim_start: null, trim_end: null }) }) });
const catalog = (committed = review()) => ({ workspace_id: "batch-test", items: [{ ...item("A"), review: committed }, item("B", false)],
  stats: { files: 2, review_counts: { pass: 1, pending: 1, fix: 0, exclude: 0 }, duplicate_groups: [], human_approved_seconds: 7 } });
function setup({ detached = false, language = "en", initial = catalog(), translateErrors = false, mobile = false, markerFlush = true, markerChanges = false } = {}) {
  const reads = [], writes = [], notices = [], renders = [], elements = new Map(), markerState = { rows: [] }, histories = [];
  let dialogs = 0; const timers = new Map(); let timerId = 0;
  const focusListeners = new Set(), bodyClasses = new Set();
  const document = { body: null, activeElement: null,
    addEventListener(type, fn) { if (type === "focusin") focusListeners.add(fn); },
    removeEventListener(type, fn) { if (type === "focusin") focusListeners.delete(fn); },
  };
  const noop = () => {};
  function element() {
    let value = "", disabled = false;
    return { hidden: false, isConnected: true, parentElement: null, dataset: {}, listeners: new Map(),
      addEventListener(type, fn) { this.listeners.set(type, fn); },
      get disabled() { return disabled; },
      set disabled(next) { disabled = next; if (next && document.activeElement === this) this.blur(); },
      contains(node) { return node === this || Boolean(node?.parentElement && this.contains(node.parentElement)); },
      getClientRects() {
        const collapsedQueue = mobile && bodyClasses.has("mobile-library-collapsed") && ["selectAll", "search"].includes(this.id);
        return !this.isConnected || this.hidden || this.parentElement?.hidden || collapsedQueue ? [] : [{}];
      },
      blur() { if (document.activeElement === this) document.activeElement = document.body; },
      focus() {
        if (this.disabled || !this.getClientRects().length) return;
        document.activeElement = this;
        for (const fn of [...focusListeners]) fn({ target: this });
      }, checked: false, open: false, textContent: "", elements: [],
      get value() { return value; }, set value(next) { value = String(next); },
      classList: { toggle: noop }, setAttribute: noop, removeAttribute: noop, replaceChildren: noop, append: noop,
      setCustomValidity: noop, reportValidity: () => true, querySelector: () => null, querySelectorAll: () => [] };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, Object.assign(element(), { id })); return elements.get(id); };
  for (const id of ["applyBatch", "batchStatus", "clearSelection"]) $(id).parentElement = $("batchBar");
  const decisions = ["pending", "pass", "fix", "exclude"].map(value => Object.assign(element(), { value }));
  const issues = ["noise", "other"].map(value => Object.assign(element(), { value }));
  $("issues").querySelectorAll = query => query === "label" ? issues.map(row => ({ querySelector: selector => selector === "input" ? row : element() }))
    : query.includes(":checked") ? issues.filter(row => row.checked) : issues;
  $("reviewForm").elements = [$("note"), $("score"), $("trimStart"), $("trimEnd"), ...decisions, ...issues];
  $("filter").value = "all"; $("sort").value = "name";
  const env = {
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    createWaveformReader,
    $, language, initial, detached, filterItems, sortItems, reviewPayload, sameReview, formatTime, continueQueue,
    request: (path, options) => { const wait = deferred(); reads.push({ path, signal: options?.signal, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => { $("notice").textContent = args[0] || ""; notices.push(args); }, errorText: translateErrors ? actualErrorText : error => error.message,
    reveal: noop, words, localStorage: { setItem: noop }, clearTimeout: id => timers.delete(id), setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, transport: { refresh: noop }, commandMenu: { refresh: noop }, openDialog: () => { dialogs++; },
    document: Object.assign(document, { documentElement: {}, body: element(), createElement: element,
      querySelectorAll: query => query === "input[name=decision]" ? decisions : [],
      querySelector: query => query === "input[name=decision]:checked" ? decisions.find(input => input.checked) : null }),
    markersView: { set: rows => { markerState.rows = structuredClone(rows); }, get: () => structuredClone(markerState.rows),
      refresh: noop, hasChanges: () => markerChanges, flush: () => markerFlush, captureFocus: () => null },
    player: { readyState: 1, pause: noop, removeAttribute: noop, load: noop },
    media: { cancel: noop, load: noop }, audition: { cancel: noop }, spectrumView: { setLanguage: noop, setVisible: noop, setSource: noop }, waveformView: { cancelDrag() {}, reset: noop },
    quietRange: () => null, syncGlider: noop, updateTime: noop, drawWave: noop, rememberPosition: noop, updateLibraryToggle: noop,
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: mobile }), resumedTime: () => 0,
    invalidateHistory: noop, loadHistory: () => histories.push(true), recordRender: value => renders.push(value),
  };
  document.body.classList = { add: key => bodyClasses.add(key), remove: key => bodyClasses.delete(key), contains: key => bodyClasses.has(key) };
  document.activeElement = document.body;
  const control = Function(...Object.keys(env), `
    
    ${extract('function notice(', 'async function request(')}
    const t = key => words[language][key] || key;
    let job = null, noticeResolver = null, noticeTimer = null;
    let state = initial, selected = detached ? structuredClone(state.items[0]) : state.items[0], dirty = false, busy = false,
      variant = 'a', wave = {}, generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      suspendedCompletion = null, visibleCache = null, spectrumVisible = false;
    const selectedKeys = new Set(), savedThisSession = new Set();
    const listeningMemory = { get: () => ({}) };
    function renderSummary() {}
    function renderQueue() { renderSelection(); recordRender({ busy, note: $('note').value, rows: visibleItems().map(item => [item.key, item.review.status, item.review.version]), form: draftValues() }); }
    ${code}
    renderDetails();
    return { translateTo(value) { $("language").value = value; $("language").listeners.get("change")(); },
      newOwner: createFeedbackOwner, get feedbackState() { return { resolver: noticeResolver, generation: noticeGeneration, text: $("notice").textContent, hidden: $("notice").hidden }; }, feedback: notice, saving: () => savingReview, batch, selectedKeys, savedThisSession, retryWave, undo, save, refresh, select, visibleItems, draftValues,
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      get current() { return { state, selected, dirty, busy, form: draftValues() }; }
    };`)(...Object.values(env));
  return { ...control, timers, document, focusListeners, get feedbackState() { return control.feedbackState; }, get current() { return control.current; }, $, reads, writes, notices, renders, histories, feedback: control.feedback, get dialogs() { return dialogs; } };
}
const committed = (key = "A", status = "exclude") => ({ ...item(key, key === "A").review, status, version: 5, updated_utc: "2026-11-03T21:00:00Z", origin: "batch_ui" });
const result = (keys = ["A", "B"], status = "exclude") => ({ saved: keys.length, reviews: keys.map(key => ({ key, review: committed(key, status) })) });
async function start(h, keys = ["A", "B"]) {
  for (const key of keys) h.selectedKeys.add(key);
  h.$("batchStatus").value = "exclude";
  const pending = h.batch(); await tick();
  return { pending };
}
async function commit(h, response = result(), keys = ["A", "B"]) {
  const { pending } = await start(h, keys);
  h.writes.at(-1).resolve(response); await tick();
  assert.equal(h.reads.at(-1)?.path, "/api/state");
  return { pending };
}
async function failCatalog(h, pending) { h.reads.at(-1).reject(new Error("catalog unavailable")); await pending; }
async function completeCatalog(h, pending, next = catalog(committed())) {
  h.reads.at(-1).resolve(next); await tick();
  if (h.reads.at(-1).path.startsWith("/api/wave/")) h.reads.at(-1).resolve({ a: [], b: [] });
  await pending;
}
function startOperation(h, kind) {
  if (kind === 'batch') { h.selectedKeys.add('A'); h.selectedKeys.add('B'); h.$('batchStatus').value = 'exclude'; return h.batch(); }
  if (kind === 'undo') return h.undo();
  h.edit('saved draft'); return h.save(kind === 'advance');
}
async function commitOperation(h, kind) {
  h.writes.at(-1).resolve(kind === 'batch' ? result() : { review: committed('A', 'pass') }); await tick();
  assert.equal(h.reads.at(-1).path, '/api/state');
}
async function settleOperation(h, pending, fail) {
  if (fail) h.reads.at(-1).reject(new Error('catalog unavailable'));
  else h.reads.at(-1).resolve(catalog(committed('A', 'pass')));
  await tick();
  if (h.reads.at(-1)?.path.startsWith('/api/wave/')) { h.reads.at(-1).resolve({ a: [], b: [] }); await tick(); }
  await pending;
}
for (const kind of ['batch', 'undo', 'save', 'advance']) for (const fail of [false, true]) for (const stage of ['post', 'get']) {
  test(`${kind} ${fail ? 'catalog failure' : 'success'} preserves a newer message during ${stage}`, async () => {
    const h = setup(), pending = startOperation(h, kind); await tick();
    if (stage === 'post') h.feedback(() => 'New import/cancel receipt');
    await commitOperation(h, kind);
    if (stage === 'get') h.feedback(() => 'New import/cancel receipt');
    const owned = h.feedbackState;
    await settleOperation(h, pending, fail);
    assert.deepEqual(h.feedbackState, owned);
    assert.equal(h.current.busy, false); assert.equal(h.current.dirty, false);
    assert.equal(h.current.state.items.find(item => item.key === 'A').review.version, 5);
  });
}
for (const kind of ['batch', 'undo', 'save', 'advance']) {
  test(`${kind} mutation rejection preserves newer feedback and committed data`, async () => {
    const h = setup(), pending = startOperation(h, kind); await tick(); h.feedback(() => 'New import/cancel receipt');
    const owned = h.feedbackState; h.writes.at(-1).reject(new Error('mutation failed')); await pending;
    assert.deepEqual(h.feedbackState, owned); assert.equal(h.current.state.items[0].review.version, 4);
    if (kind === 'save' || kind === 'advance') assert.equal(h.current.dirty, true);
  });
  test(`${kind} ordinary completion remains visible and dynamically translates`, async () => {
    const h = setup(), pending = startOperation(h, kind); await tick(); await commitOperation(h, kind); await settleOperation(h, pending, false);
    const before = h.feedbackState;
    assert.equal(before.hidden, false); assert.equal(typeof before.resolver, 'function');
    h.translateTo('zh'); assert.notEqual(h.feedbackState.text, before.text);
    assert.equal(h.feedbackState.resolver, before.resolver); assert.equal(h.feedbackState.generation, before.generation);
  });
}
for (const kind of ['batch', 'undo', 'advance']) {
  test(`${kind} waveform failure wins after catalog commit`, async () => {
    const h = setup(), pending = startOperation(h, kind); await tick(); await commitOperation(h, kind);
    const next = catalog(committed('A', 'pass'));
    if (kind === 'advance') next.items[1].quality.decoded = true;
    h.reads.at(-1).resolve(next); await tick();
    assert.ok(h.reads.at(-1).path.startsWith('/api/wave/')); h.reads.at(-1).reject(new Error('specific wave error')); await pending;
    assert.equal(h.feedbackState.text, 'specific wave error'); assert.equal(h.current.state.items[0].review.version, 5);
  });
}
test('notification owner can advance itself but never reacquire after any external notice or clear', () => {
  const h = setup(), owner = h.newOwner(), first = () => 'same';
  assert.equal(owner.publish(first), true); assert.equal(owner.clear(first), true);
  assert.equal(owner.publish(first), true); h.feedback(() => 'same');
  assert.equal(owner.clear(first), false); assert.equal(owner.publish('stale'), false);
  h.feedback(); assert.equal(owner.publish('still stale'), false); assert.equal(h.feedbackState.hidden, true);
});
test('owner clear requires resolver identity, not equal text', () => {
  const h = setup(), owner = h.newOwner(), first = () => 'same'; owner.publish(first);
  assert.equal(owner.clear(() => 'same'), false); assert.equal(owner.owns(), true);
  assert.equal(owner.clear(first), true);
});
test('reentrant new notification during publication permanently revokes the operation', () => {
  const node = { classList: { toggle() {} } };
  const h = Function('$', 'clearTimeout', 'setTimeout', `let noticeGeneration = 0, noticeResolver = null, noticeTimer = null;
    function reveal() { if (!entered) { entered = true; notice(() => 'newer reentrant'); } }
    let entered = false;
    ${extract('function notice(', 'async function request(')}
    ${extract('function createFeedbackOwner()', 'function invalidateRefresh()')}
    return { owner: createFeedbackOwner(), clear: () => notice(), get text() { return $('notice').textContent; } };`)(() => node, () => {}, () => {});
  assert.equal(h.owner.publish(() => 'original'), false); assert.equal(h.text, 'newer reentrant');
  h.clear(); assert.equal(h.owner.publish('cannot reacquire'), false); assert.equal(h.text, '');
});
// Defensive reentrancy boundary: production reveal has no known path that
// publishes a notice today. This double deliberately introduces one.
function noticeTimerFixture() {
  const node = { classList: { toggle() {} } }, timers = new Map(), archived = new Map(); let serial = 0;
  const control = Function('$', 'clearTimeout', 'setTimeout', `
    let noticeGeneration = 0, noticeResolver = null, noticeTimer = null, nextReveal = null;
    function reveal() { const callback = nextReveal; nextReveal = null; callback?.(); }
    ${extract('function notice(', 'async function request(')}
    ${extract('function createFeedbackOwner()', 'function invalidateRefresh()')}
    return { notice, owner: createFeedbackOwner(), reenter(callback) { nextReveal = callback; },
      get current() { return { text: $('notice').textContent, resolver: noticeResolver, generation: noticeGeneration, timer: noticeTimer }; } };
  `)(() => node, id => timers.delete(id), (fn, delay) => { const id = ++serial; const fire = () => { timers.delete(id); fn(); }; timers.set(id, { fn: fire, delay }); archived.set(id, fire); return id; });
  return { ...control, get current() { return control.current; }, timers, archived };
}
for (const newerSuccess of [false, true]) {
  test(`reentrant success publication cannot install a timer over newer success=${newerSuccess}`, () => {
    const h = noticeTimerFixture(), newer = () => 'newer notification';
    h.reenter(() => h.notice(newer, newerSuccess));
    assert.equal(h.owner.publish(() => 'old success', true), false);
    assert.equal(h.current.text, 'newer notification'); assert.equal(h.current.resolver, newer);
    assert.equal(h.timers.size, newerSuccess ? 1 : 0);
    assert.equal(h.owner.publish('cannot reacquire'), false);
    if (newerSuccess) {
      const timer = h.timers.get(h.current.timer); assert.ok(timer); assert.equal(timer.delay, 3200);
      timer.fn(); assert.equal(h.current.text, ''); assert.equal(h.timers.size, 0);
    }
  });
}
for (const newerSuccess of [false, true]) {
  test(`already captured old success timer cannot clear newer success=${newerSuccess}`, () => {
    const h = noticeTimerFixture(); h.notice(() => 'old success', true);
    const oldCallback = h.archived.get(h.current.timer);
    h.notice(() => 'newer notification', newerSuccess); const before = h.current, timers = [...h.timers.keys()];
    oldCallback(); assert.deepEqual(h.current, before); assert.deepEqual([...h.timers.keys()], timers);
  });
}
function expireSuccess(h) {
  assert.equal(h.timers.size, 1); const [id, callback] = [...h.timers][0];
  h.timers.delete(id); callback();
}
for (const kind of ['save', 'advance', 'batch', 'undo']) for (const stage of ['post', 'get']) for (const failure of [false, true]) {
  test(`${kind} old success expiry during ${stage} does not suppress ${failure ? 'failure' : 'success'} outcome`, async () => {
    const h = setup(); h.feedback(() => 'Previous success', true);
    const pending = startOperation(h, kind); await tick();
    if (stage === 'get') await commitOperation(h, kind);
    const generation = h.feedbackState.generation; h.translateTo('zh'); expireSuccess(h);
    assert.equal(h.feedbackState.generation, generation); assert.equal(h.feedbackState.resolver, null);
    assert.equal(h.feedbackState.hidden, true);
    if (stage === 'post' && failure) { h.writes.at(-1).reject(new Error('mutation failed')); await pending; }
    else {
      if (stage === 'post') await commitOperation(h, kind);
      await settleOperation(h, pending, failure);
    }
    assert.equal(h.feedbackState.hidden, false); assert.notEqual(h.feedbackState.text, 'Previous success');
    assert.ok(h.feedbackState.generation > generation);
    if (!failure || stage === 'get') assert.equal(h.current.state.items[0].review.version, 5);
    else assert.equal(h.current.state.items[0].review.version, 4);
  });
}
for (const kind of ['save', 'batch', 'undo']) for (const newer of ['message', 'explicit-clear']) {
  test(`${kind} natural expiry does not undo revocation by ${newer}`, async () => {
    const h = setup(); h.feedback(() => 'Previous success', true);
    const pending = startOperation(h, kind); await tick(); expireSuccess(h);
    if (newer === 'message') h.feedback(() => 'New import receipt'); else h.feedback();
    const before = h.feedbackState; await commitOperation(h, kind); await settleOperation(h, pending, false);
    assert.deepEqual(h.feedbackState, before);
  });
}
test('natural success expiry does not increment generation; captured old timer remains harmless', () => {
  const h = noticeTimerFixture(); h.notice(() => 'old', true);
  const old = h.archived.get(h.current.timer), before = h.current;
  old(); assert.equal(h.current.generation, before.generation); assert.equal(h.current.timer, null); assert.equal(h.current.resolver, null);
  h.notice(() => 'new'); const newer = h.current; old(); assert.deepEqual(h.current, newer);
});
