import test from "node:test";
import { words } from "../src/audio_review_desk/static/copy.js";
import assert from "node:assert/strict";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readFileSync } from "node:fs";
import { readWithRecovery } from "../src/audio_review_desk/static/read-recovery.js";

// Actual workbench control flow with deferred I/O and small DOM/render doubles.
// These tests cover ownership and draft safety, not browser rendering.
const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = [
  extract("let discardResolver =", "function translate()"),
  extract("function markDirty()", "function range()"),
  extract("async function select(item", "function showCompletion("),
  extract("let jobPollError =", "async function startImport("),
].join("\n");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const row = (key, decoded = false) => ({ key, label: key, quality: { decoded, duration: 10 }, review: { note: `saved ${key}`, version: 1, markers: [] } });
const catalog = (version, decoded = false) => ({ version, workspace_id: "test", items: [row("A", decoded), row("B", decoded)], stats: { review_counts: { pending: 2 } } });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return { AbortController,
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    get count() { return timers.size; },
    async tick(ms = 0) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      now = end; await tick();
    },
  };
}

function setup({ decoded = false, realLanguage = false } = {}) {
  const runtime = clock(), noticeRuntime = clock();
  const reads = [], writes = [], notices = [], elements = new Map(), starts = [];
  let callbacks, dialogs = 0;
  const noop = () => {};
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, elements: [], disabled: false,
      addEventListener(type, callback) { this[type] = callback; }, setCustomValidity() {}, setAttribute() {}, dataset: {}, querySelectorAll: () => [], classList: { toggle() {} }, querySelector: () => ({}), reportValidity: () => true, focus: noop });
    return elements.get(id);
  };
  const env = { setTimeout: noticeRuntime.setTimeout, clearTimeout: noticeRuntime.clearTimeout, words, realLanguage, paintRescanReceipt: noop, validateNote: noop, transport: { refresh: noop }, reveal: () => {}, renderExportScope: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    createWaveformReader,
    invalidateHistory: () => {}, loadHistory: () => {}, $, readWithRecovery: options => readWithRecovery(options, runtime), initial: catalog("initial", decoded),
    request: path => { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => notices.push(args), errorText: (error, language) => language + ":" + error.message, language: "en",
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: false }),
    document: { documentElement: {}, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, activeElement: null, body: {} }, openDialog: () => { dialogs++; },
    audition: { cancel: noop }, rememberPosition: noop, media: { cancel: noop, load: noop },
    player: { pause: noop, removeAttribute: noop, load: noop }, updateLibraryToggle: noop,
    spectrumView: { setLanguage: noop, setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop },
    renderSummary: noop, renderQueue: noop, drawWave: noop, updateIssueCount: noop,
    markersView: { refresh: noop, hasChanges: () => false, flush: () => true, captureFocus: () => null },
    sameReview: (left, right) => left.note === right.note,
    reviewPayload: (target, values) => ({ ...target.review, note: values.note }),
    resumedTime: () => 0, renderJob: noop,
    createJobPoller: options => { callbacks = options; return { start: value => starts.push(value) }; },
  };
  const control = Function(...Object.keys(env), `
    let spectrumVisible = false;
    const t = key => realLanguage ? (words[language][key] || key) : key;
    let noticeResolver = null, noticeTimer = null;
    ${extract('function notice(', 'async function request(')}

    let state = initial, selected = state.items[0], dirty = false, busy = false,
      generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null, pendingCompletion = null, suspendedCompletion = null, variant = 'a', wave = {}, job = null,
      handledJob = null, visibleCache = null;
    const selectedKeys = new Set(), savedThisSession = new Set();
    let listeningMemory = { get: () => ({}) };
    function visibleItems() { return state.items; }
    function draftValues() { return { note: $('note').value }; }
    function renderDetails(restore = true) { if (restore && selected) $('note').value = selected.review.note; }
    ${code}
    ${extract('$("cancelImport").addEventListener', '$("rescan").addEventListener')}
    ${realLanguage ? extract('function translate() {', 'function renderExportScope()') : 'function translate() { if (noticeResolver) $("notice").textContent = noticeResolver(); }'}
    $('queueComplete').hidden = true;
    $('note').value = selected.review.note;
    return { notice, refresh, select, save, setBusy, acceptJob, cancel: () => $("cancelImport").click(),
      language(value) { language = value; translate(); },
      boot() { state = null; selected = null; },
      get feedback() { return { text: $('notice').textContent, hidden: $('notice').hidden, resolver: noticeResolver, turn: noticeGeneration }; },
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      get current() { return { state, selected, dirty, busy, job, cancelRequest, refreshController, pendingCompletion, note: $('note').value }; }
    };`)(...Object.values(env));
  return { ...control, get current() { return control.current; }, get feedback() { return control.feedback; }, noticeRuntime, runtime, reads, writes, notices, starts, callbacks, get dialogs() { return dialogs; } };
}

const empty = () => ({ workspace_id: 'test', items: [], stats: { review_counts: { pending: 0 } } });
async function fail(h, message = 'offline') {
  const task = h.refresh(true); h.reads.at(-1).reject(new Error(message)); assert.equal(await task, false);
}
for (const populated of [false, true]) for (const boot of [false, true]) {
  test(`owned load failure clears before ${populated ? 'nonempty' : 'empty'} success, boot=${boot}`, async () => {
    const h = setup(); if (boot) h.boot(); await fail(h);
    assert.equal(h.feedback.text, 'en:offline'); const old = h.feedback.resolver;
    h.language('zh'); assert.equal(h.feedback.text, 'zh:offline'); assert.equal(h.feedback.resolver, old);
    const task = h.refresh(true); h.reads.at(-1).resolve(populated ? catalog('new') : empty());
    assert.equal(await task, true); assert.equal(h.feedback.hidden, true); assert.equal(h.feedback.text, '');
  });
}
for (const populated of [false, true]) for (const kind of ['fixed', 'resolver', 'same-text']) {
  test(`newer ${kind} notification survives ${populated ? 'nonempty' : 'empty'} refresh`, async () => {
    const h = setup(); await fail(h); const task = h.refresh(true);
    h.notice(kind === 'fixed' ? 'Saved latest' : () => kind === 'same-text' ? 'en:offline' : 'Import complete');
    const owned = h.feedback; h.reads.at(-1).resolve(populated ? catalog('new') : empty());
    assert.equal(await task, true); assert.deepEqual(h.feedback, owned);
  });
}
for (const outcome of ['resolve', 'reject']) {
  test(`obsolete ${outcome} cannot overwrite newer failed request`, async () => {
    const h = setup(), old = h.refresh(true), oldRead = h.reads.at(-1);
    await fail(h, 'new outage'); const current = h.feedback;
    oldRead[outcome](outcome === 'resolve' ? empty() : new Error('old outage'));
    assert.equal(await old, false); assert.deepEqual(h.feedback, current);
  });
}
test('late current failure cannot replace newer save/import message', async () => {
  const h = setup(), task = h.refresh(true); h.notice(() => 'Saved'); const before = h.feedback;
  h.reads.at(-1).reject(new Error('offline')); assert.equal(await task, false); assert.deepEqual(h.feedback, before);
});
for (const action of ['busy', 'dirty']) {
  test(`${action} invalidation does not clear a previous load failure`, async () => {
    const h = setup(); await fail(h); const task = h.refresh(true), read = h.reads.at(-1), before = h.feedback;
    if (action === 'busy') h.setBusy(true); else h.edit('draft');
    read.resolve(empty()); assert.equal(await task, false); assert.deepEqual(h.feedback, before);
  });
}
test('newer repeated failure remains owned and can subsequently clear', async () => {
  const h = setup(); await fail(h, 'first'); await fail(h, 'second'); assert.equal(h.feedback.text, 'en:second');
  const task = h.refresh(true); h.reads.at(-1).resolve(empty()); assert.equal(await task, true); assert.equal(h.feedback.hidden, true);
});
test('waveform error after a successful snapshot is not cleared as the old load error', async () => {
  const h = setup(); await fail(h);
  const task = h.refresh(true); h.reads.at(-1).resolve(catalog('decoded', true)); await tick();
  h.reads.at(-1).reject(new Error('wave unavailable')); assert.equal(await task, false);
  assert.equal(h.feedback.text, 'en:wave unavailable'); assert.equal(h.feedback.hidden, false);
});
const offline = () => Object.assign(new Error('offline'), { code: 'network' });
for (const populated of [false, true]) for (const replacement of ['none', 'fixed', 'same-text']) {
  test(`recover success ${populated ? 'nonempty' : 'empty'} preserves ${replacement} ownership`, async () => {
    const h = setup(), task = h.refresh(true, { recover: true });
    h.reads.at(-1).reject(offline()); await tick();
    assert.equal(h.feedback.text, 'jobRefreshing');
    if (replacement !== 'none') h.notice(replacement === 'fixed' ? 'Saved/imported' : () => 'jobRefreshing');
    const before = h.feedback;
    await h.runtime.tick(700); h.reads.at(-1).resolve(populated ? catalog('recovered') : empty());
    assert.equal(await task, true);
    if (replacement === 'none') assert.equal(h.feedback.hidden, true); else assert.deepEqual(h.feedback, before);
    assert.equal(h.runtime.count, 0);
  });
}
for (const replacement of ['none', 'fixed', 'same-text']) {
  test(`recover invalidation detaches and cancels only its ${replacement} notice`, async () => {
    const h = setup(), task = h.refresh(true, { recover: true });
    h.reads.at(-1).reject(offline()); await tick();
    if (replacement !== 'none') h.notice(replacement === 'fixed' ? 'Saved/imported' : () => 'jobRefreshing');
    const before = h.feedback;
    h.edit('new draft'); assert.equal(await task, false); await h.runtime.tick(60000);
    if (replacement === 'none') assert.equal(h.feedback.hidden, true); else assert.deepEqual(h.feedback, before);
    assert.equal(h.reads.length, 1); assert.equal(h.runtime.count, 0);
  });
}
for (const outcome of ['success', 'terminal']) {
  test(`recover never replaces newer notification before first retry or ${outcome}`, async () => {
    const h = setup(), task = h.refresh(true, { recover: true }); h.notice(() => 'New import receipt');
    const before = h.feedback; h.reads.at(-1).reject(offline()); await tick();
    assert.deepEqual(h.feedback, before); await h.runtime.tick(700);
    if (outcome === 'success') h.reads.at(-1).resolve(catalog('recovered'));
    else h.reads.at(-1).reject(new Error('terminal'));
    assert.equal(await task, outcome === 'success'); assert.deepEqual(h.feedback, before); assert.equal(h.runtime.count, 0);
  });
}
test('recover terminal failure owns a localized error which next success clears', async () => {
  const h = setup(), task = h.refresh(true, { recover: true }); h.reads.at(-1).reject(offline()); await tick();
  await h.runtime.tick(700); h.reads.at(-1).reject(new Error('terminal')); assert.equal(await task, false);
  assert.equal(h.feedback.text, 'en:terminal'); h.language('zh'); assert.equal(h.feedback.text, 'zh:terminal');
  const next = h.refresh(true); h.reads.at(-1).resolve(empty()); assert.equal(await next, true); assert.equal(h.feedback.hidden, true);
});
for (const outcome of ['success', 'cancel', 'newer']) {
  test(`actual translate retains dynamic recover notice identity through ${outcome}`, async () => {
    const h = setup({ realLanguage: true }); h.boot();
    const task = h.refresh(true, { recover: true }); h.reads.at(-1).reject(offline()); await tick();
    assert.equal(h.feedback.text, words.en.jobRefreshing);
    const resolver = h.feedback.resolver, generation = h.feedback.turn, timers = h.runtime.count;
    for (const language of ['zh', 'en', 'zh']) {
      h.language(language); assert.equal(h.feedback.text, words[language].jobRefreshing);
      assert.equal(h.feedback.resolver, resolver); assert.equal(h.feedback.turn, generation);
      assert.equal(h.feedback.hidden, false); assert.equal(h.runtime.count, timers);
    }
    if (outcome === 'newer') h.notice(() => words.zh.jobRefreshing);
    if (outcome === 'success') {
      await h.runtime.tick(700); h.reads.at(-1).resolve(empty()); assert.equal(await task, true);
    } else { h.setBusy(true); assert.equal(await task, false); }
    assert.equal(h.feedback.hidden, outcome !== 'newer'); assert.equal(h.runtime.count, 0);
    h.language('en'); assert.equal(h.feedback.hidden, outcome !== 'newer');
    if (outcome === 'newer') assert.equal(h.feedback.text, words.zh.jobRefreshing);
  });
}
for (const retry of [false, true]) for (const replacement of ['none', 'before-read', 'after-retry', 'same-text']) {
  test(`scan completion retry=${retry} respects ${replacement} ownership`, async () => {
    const h = setup({ realLanguage: true }); h.boot();
    const task = h.callbacks.onSnapshot({ id: 'scan', state: 'succeeded' }, { restoring: false });
    if (replacement === 'before-read') h.notice(() => 'New import receipt');
    if (retry) {
      h.reads.at(-1).reject(offline()); await tick();
      if (replacement === 'none') { h.language('zh'); assert.equal(h.feedback.text, words.zh.jobRefreshing); }
      await h.runtime.tick(700);
    }
    if (replacement === 'after-retry') h.notice(() => 'New import receipt');
    if (replacement === 'same-text') h.notice(() => words.en.jobRefreshing);
    const before = h.feedback;
    h.reads.at(-1).resolve(empty()); await task;
    if (replacement === 'none') {
      assert.equal(h.feedback.text, words[retry ? 'zh' : 'en'].jobDone);
      assert.equal(h.feedback.hidden, false);
    } else assert.deepEqual(h.feedback, before);
    assert.equal(h.runtime.count, 0);
    h.notice(); // Cancel the real notice success timer owned by this fixture.
  });
}
test('scan waveform failure stays specific and does not block committed catalog', async () => {
  const h = setup(), task = h.callbacks.onSnapshot({ id: 'scan', state: 'succeeded' }, { restoring: false });
  h.reads.at(-1).resolve(catalog('committed', true)); await tick();
  h.reads.at(-1).reject(new Error('wave failed')); await task;
  assert.equal(h.current.state.version, 'committed'); assert.equal(h.feedback.text, 'en:wave failed');
});
test('save acquires ownership after cancelling and clearing an earlier recovery notice', async () => {
  const h = setup(), recovering = h.refresh(true, { recover: true });
  h.reads.at(-1).reject(offline()); await tick(); assert.equal(h.feedback.text, 'jobRefreshing');
  const saving = h.save();
  assert.equal(await recovering, false); assert.equal(h.feedback.hidden, true);
  h.writes.at(-1).resolve({ review: { note: 'saved A', version: 2, markers: [] } }); await tick();
  h.reads.at(-1).resolve(catalog('saved')); await saving;
  assert.equal(h.feedback.text, 'saved'); assert.equal(h.runtime.count, 0); h.notice();
});
for (const retry of [false, true]) for (const failure of [false, true]) {
  test(`scan old success expires during GET, retry=${retry}, failure=${failure}`, async () => {
    const h = setup({ realLanguage: true }); h.notice(() => 'Previous success', true);
    const task = h.callbacks.onSnapshot({ id: 'scan-expiry', state: 'succeeded' }, { restoring: false });
    const generation = h.feedback.turn; h.language('zh'); await h.noticeRuntime.tick(3200);
    assert.equal(h.feedback.turn, generation); assert.equal(h.feedback.hidden, true); assert.equal(h.feedback.resolver, null);
    if (retry) { h.reads.at(-1).reject(offline()); await tick(); await h.runtime.tick(700); }
    if (failure) h.reads.at(-1).reject(new Error('terminal error')); else h.reads.at(-1).resolve(empty());
    await task; assert.equal(h.feedback.hidden, false);
    assert.equal(h.feedback.text, failure ? 'zh:terminal error' : words.zh.jobDone);
  });
}
for (const newer of ['message', 'explicit-clear']) {
  test(`scan old expiry does not restore ownership after ${newer}`, async () => {
    const h = setup({ realLanguage: true }); h.notice(() => 'Previous success', true);
    const task = h.callbacks.onSnapshot({ id: 'scan-expiry', state: 'succeeded' }, { restoring: false });
    await h.noticeRuntime.tick(3200);
    if (newer === 'message') h.notice(() => 'New import receipt'); else h.notice();
    const before = h.feedback; h.reads.at(-1).resolve(empty()); await task; assert.deepEqual(h.feedback, before);
  });
}

test('scan retry replaces old success before expiry and survives repeated recovery through translation', async () => {
  const h = setup({ realLanguage: true }); h.notice(() => 'Previous success', true);
  const task = h.callbacks.onSnapshot({ id: 'scan-retry-before-expiry', state: 'succeeded' }, { restoring: false });
  h.reads.at(-1).reject(offline()); await tick();
  assert.equal(h.feedback.text, words.en.jobRefreshing);
  const resolver = h.feedback.resolver, generation = h.feedback.turn;
  assert.equal(h.noticeRuntime.count, 0, 'publishing retry cancels the earlier success timer');
  await h.noticeRuntime.tick(6400);
  assert.equal(h.feedback.hidden, false); assert.equal(h.feedback.resolver, resolver);
  assert.equal(h.feedback.turn, generation);
  await h.runtime.tick(700); assert.equal(h.reads.length, 2);
  h.reads.at(-1).reject(offline()); await tick();
  await h.runtime.tick(1400); assert.equal(h.reads.length, 3);
  h.language('zh'); assert.equal(h.feedback.text, words.zh.jobRefreshing);
  assert.equal(h.feedback.resolver, resolver); assert.equal(h.feedback.turn, generation);
  h.reads.at(-1).resolve(empty()); await task;
  assert.equal(h.feedback.text, words.zh.jobDone); assert.equal(h.feedback.hidden, false);
  assert.equal(h.runtime.count, 0); assert.equal(h.noticeRuntime.count, 1);
  await h.noticeRuntime.tick(3200);
  assert.equal(h.feedback.hidden, true); assert.equal(h.noticeRuntime.count, 0);
});
for (const timing of ['before-retry', 'after-retry']) {
  test(`same-text newer success expires without restoring scan ownership (${timing})`, async () => {
    const h = setup({ realLanguage: true });
    const task = h.callbacks.onSnapshot({ id: 'scan-newer-expiry', state: 'succeeded' }, { restoring: false });
    const newer = () => words.en.jobRefreshing;
    if (timing === 'before-retry') h.notice(newer, true);
    h.reads.at(-1).reject(offline()); await tick();
    if (timing === 'after-retry') {
      assert.equal(h.feedback.text, words.en.jobRefreshing);
      assert.notEqual(h.feedback.resolver, newer);
      h.notice(newer, true);
    }
    assert.equal(h.feedback.resolver, newer);
    const generation = h.feedback.turn;
    await h.noticeRuntime.tick(3200);
    assert.equal(h.feedback.hidden, true); assert.equal(h.feedback.resolver, null);
    assert.equal(h.feedback.turn, generation);
    const expired = h.feedback;
    await h.runtime.tick(700); h.reads.at(-1).resolve(empty()); await task;
    assert.deepEqual(h.feedback, expired, 'natural expiry must not let the older scan reclaim feedback');
    assert.equal(h.current.state.items.length, 0, 'catalog reconciliation still completes');
    assert.equal(h.runtime.count, 0); assert.equal(h.noticeRuntime.count, 0);
  });
}

// Production terminal callback + refresh/readWithRecovery/select + cancellation
// handler. I/O, renderers and poll scheduling are controlled, not a live server.
for (const terminal of ['succeeded', 'cancelled']) for (const response of ['resolve', 'reject']) {
  test(`late cancel ${response} preserves ${terminal} catalog recovery and a subsequent job`, async () => {
    const h = setup({ realLanguage: true });
    h.acceptJob({ id: 'old', state: 'running', phase: 'reading' });
    const cancellation = h.cancel(), post = h.writes.at(-1);
    assert.equal(post.path, '/api/cancel-import');
    assert.deepEqual(post.payload, { id: 'old' });
    const terminalTask = h.callbacks.onSnapshot({ id: 'old', state: terminal }, { restoring: false });
    // Only succeeded automatically refreshes; cancelled retains the catalog.
    // Its recovery below is an explicit refresh, not a claimed auto-refresh.
    const recovery = terminal === 'succeeded' ? terminalTask : h.refresh(true, { recover: true });
    assert.equal(h.reads.at(-1).path, '/api/state');
    h.reads.at(-1).reject(offline()); await tick();
    const controller = h.current.refreshController, completion = h.current.pendingCompletion;
    const before = h.feedback, starts = h.starts.length;
    assert.equal(controller.signal.aborted, false);
    if (response === 'resolve') post.resolve({ id: 'old', state: 'cancelling', phase: 'reading' });
    else post.reject(offline());
    await cancellation;
    assert.equal(h.current.job.state, terminal);
    assert.equal(h.current.refreshController, controller);
    assert.equal(controller.signal.aborted, false);
    assert.equal(h.current.pendingCompletion, completion);
    assert.equal(h.starts.length, starts);
    assert.deepEqual(h.feedback, before);
    await h.runtime.tick(700);
    h.reads.at(-1).resolve(catalog('recovered')); await recovery; await terminalTask;
    assert.equal(h.current.state.version, 'recovered');
    assert.equal(h.current.selected.key, 'A');
    assert.equal(h.current.note, 'saved A');
    assert.equal(h.runtime.count, 0);
    if (terminal === 'succeeded') assert.equal(h.feedback.text, words.en.jobDone);
    h.acceptJob({ id: 'new', state: 'running', phase: 'reading' });
    assert.equal(h.current.job.id, 'new');
    assert.equal(h.current.state.version, 'recovered');
    assert.equal(h.current.cancelRequest, null);
    h.notice();
  });
}
for (const response of ['resolve', 'reject']) {
  test(`late cancel ${response} cannot revive completion invalidated by a new job`, async () => {
    const h = setup({ realLanguage: true });
    h.acceptJob({ id: 'old', state: 'running', phase: 'reading' });
    const cancellation = h.cancel(), oldPost = h.writes.at(-1);
    const terminal = h.callbacks.onSnapshot({ id: 'old', state: 'succeeded' }, { restoring: false });
    h.reads.at(-1).reject(offline()); await tick();
    const controller = h.current.refreshController;
    h.acceptJob({ id: 'new', state: 'running', phase: 'reading' });
    assert.equal(controller.signal.aborted, true);
    await terminal;
    h.notice('new job receipt');
    const nextCancel = h.cancel(), lock = h.current.cancelRequest, starts = h.starts.length;
    if (response === 'resolve') oldPost.resolve({ id: 'old', state: 'cancelling', phase: 'reading' });
    else oldPost.reject(offline());
    await cancellation;
    assert.equal(h.current.job.id, 'new');
    assert.equal(h.current.cancelRequest, lock);
    assert.equal(h.current.state.version, 'initial');
    assert.equal(h.feedback.text, 'new job receipt');
    assert.equal(h.starts.length, starts);
    assert.equal(h.runtime.count, 0);
    h.writes.at(-1).resolve({ id: 'new', state: 'cancelling', phase: 'reading' });
    await nextCancel;
    assert.equal(h.current.job.id, 'new');
    assert.equal(h.current.job.state, 'cancelling');
    h.notice();
  });
}

for (const waveFailure of [false, true]) {
  test(`cancel error retirement precedes real completion recovery, wave failure=${waveFailure}`, async () => {
    const h = setup({ realLanguage: true });
    h.acceptJob({ id: 'old', state: 'running', phase: 'reading' });
    const pending = h.cancel(); h.writes.at(-1).reject(offline()); await pending;
    const operation = h.current.cancelRequest;
    assert.equal(typeof operation.errorResolver, 'function');
    h.language('zh'); assert.equal(h.feedback.text, 'zh:offline');
    const completion = h.callbacks.onSnapshot({ id: 'old', state: 'succeeded' }, { restoring: false });
    assert.equal(operation.errorResolver, null); assert.equal(h.feedback.hidden, true);
    h.reads.at(-1).reject(offline()); await tick();
    assert.equal(h.feedback.text, words.zh.jobRefreshing);
    h.language('en'); assert.equal(h.feedback.text, words.en.jobRefreshing);
    await h.runtime.tick(700); h.reads.at(-1).resolve(catalog('recovered', waveFailure));
    await tick();
    if (waveFailure) h.reads.at(-1).reject(new Error('wave failed'));
    await completion;
    assert.equal(h.current.state.version, 'recovered');
    assert.equal(h.feedback.text, waveFailure ? 'en:wave failed' : words.en.jobDone);
    assert.equal(h.current.cancelRequest, null); assert.equal(h.runtime.count, 0);
    h.notice();
  });
}
