import test from "node:test";
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
function setup({ decoded = false } = {}) {
  const reads = [], writes = [], notices = [], elements = new Map(), starts = [];
  let callbacks, dialogs = 0;
  const noop = () => {};
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, elements: [], disabled: false,
      setCustomValidity() {}, setAttribute() {}, querySelector: () => null, reportValidity: () => true, focus: noop });
    return elements.get(id);
  };
  const env = { renderExportScope: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    createWaveformReader,
    invalidateHistory: () => {}, loadHistory: () => {}, $, readWithRecovery, initial: catalog("initial", decoded),
    request: path => { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => notices.push(args), errorText: error => error.message, language: "en", t: key => key,
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: false }),
    document: { addEventListener: noop, removeEventListener: noop, activeElement: null, body: {} }, openDialog: () => { dialogs++; },
    audition: { cancel: noop }, rememberPosition: noop, media: { cancel: noop, load: noop },
    player: { pause: noop, removeAttribute: noop, load: noop }, updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop }, waveformView: { cancelDrag() {}, reset: noop },
    renderSummary: noop, renderQueue: noop, drawWave: noop, updateIssueCount: noop,
    markersView: { hasChanges: () => false, flush: () => true, captureFocus: () => null },
    sameReview: (left, right) => left.note === right.note,
    reviewPayload: (target, values) => ({ ...target.review, note: values.note }),
    resumedTime: () => 0, renderJob: noop,
    createJobPoller: options => { callbacks = options; return { start: value => starts.push(value) }; },
  };
  const control = Function(...Object.keys(env), `
    let spectrumVisible = false;
    let noticeResolver = null;
    function notice(message = '', ...args) { noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null; if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice(); }
    let state = initial, selected = state.items[0], dirty = false, busy = false,
      generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null, pendingCompletion = null, suspendedCompletion = null, variant = 'a', wave = {}, job = null,
      handledJob = null, visibleCache = null;
    const selectedKeys = new Set(), savedThisSession = new Set();
    let listeningMemory = { get: () => ({}) };
    function visibleItems() { return state.items; }
    function draftValues() { return { note: $('note').value }; }
    function renderDetails(restore = true) { if (restore && selected) $('note').value = selected.review.note; }
    ${code}
    $('note').value = selected.review.note;
    return { notice, refresh, select, save, setBusy, acceptJob,
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      get current() { return { state, selected, dirty, busy, note: $('note').value }; }
    };`)(...Object.values(env));
  return { ...control, get current() { return control.current; }, reads, writes, notices, starts, callbacks, get dialogs() { return dialogs; } };
}

test("automatic and manual refreshes preserve edits begun during the state read", async () => {
  for (const force of [true, false]) {
    const h = setup(), pending = h.refresh(force); await tick();
    const before = h.current.state, selection = h.current.selected;
    h.edit("irreplaceable draft"); h.reads[0].resolve(catalog("late"));
    assert.equal(await pending, false);
    assert.equal(h.current.state, before); assert.equal(h.current.selected, selection);
    assert.equal(h.current.dirty, true); assert.equal(h.current.note, "irreplaceable draft");
  }
});

test("a newer selection survives a pending refresh", async () => {
  const h = setup(), pending = h.refresh(true), next = h.current.state.items[1];
  await h.select(next); h.reads[0].resolve(catalog("late"));
  assert.equal(await pending, false); assert.equal(h.current.selected, next);
});

test("only the newest concurrent refresh applies its catalog", async () => {
  const h = setup(), older = h.refresh(true), newer = h.refresh(true);
  h.reads[1].resolve(catalog("newest")); assert.equal(await newer, true);
  const state = h.current.state, selection = h.current.selected;
  h.reads[0].resolve(catalog("older")); assert.equal(await older, false);
  assert.equal(h.current.state, state); assert.equal(h.current.selected, selection);
});

test("a refresh arriving during save cannot clear selection or its pending draft", async () => {
  const h = setup(), pending = h.refresh(true), selection = h.current.selected;
  h.edit("saving draft"); const save = h.save();
  assert.equal(h.current.busy, true);
  h.reads[0].resolve(catalog("older")); assert.equal(await pending, false);
  assert.equal(h.current.selected, selection); assert.equal(h.current.note, "saving draft");
  assert.equal(h.current.dirty, true);
  h.writes[0].reject(new Error("save rejected")); await save;
  assert.equal(h.current.selected, selection); assert.equal(h.current.dirty, true);
});

test("a completed save still invalidates a refresh that started before it", async () => {
  const h = setup(), pending = h.refresh(true);
  h.edit("saved newest"); const save = h.save();
  h.writes[0].resolve({ review: { note: "saved newest", version: 2, markers: [] } }); await tick();
  const saved = catalog("after-save"); saved.items[0].review.note = "saved newest";
  h.reads[1].resolve(saved); await save;
  assert.equal(h.current.busy, false); assert.equal(h.current.dirty, false);
  h.reads[0].resolve(catalog("before-save")); assert.equal(await pending, false);
  assert.equal(h.current.state, saved); assert.equal(h.current.selected.review.note, "saved newest");
  assert.equal(h.current.note, "saved newest");
});

test("an obsolete error stays silent after a newer successful refresh", async () => {
  const h = setup(), older = h.refresh(true), newer = h.refresh(true);
  h.reads[1].resolve(catalog("newest")); await newer;
  const notices = h.notices.length;
  h.reads[0].reject(new Error("obsolete failure")); assert.equal(await older, false);
  assert.equal(h.notices.length, notices); assert.equal(h.current.state.version, "newest");
});

test("a current clean refresh succeeds and a current read error remains visible", async () => {
  const h = setup(), pending = h.refresh(true), fresh = catalog("fresh");
  h.reads[0].resolve(fresh); assert.equal(await pending, true);
  assert.equal(h.current.state, fresh); assert.equal(h.current.selected, fresh.items[0]);
  const failed = h.refresh(true); h.reads[1].reject(new Error("current failure"));
  assert.equal(await failed, false); assert.deepEqual(h.notices.at(-1), ["current failure"]);
});

test("normal selection still confirms dirty drafts and cancellation preserves them", async () => {
  const h = setup(), first = h.current.selected, next = h.current.state.items[1];
  h.edit("keep me"); const cancelled = h.select(next); await tick();
  assert.equal(h.dialogs, 1); h.answerDiscard(false); await cancelled;
  assert.equal(h.current.selected, first); assert.equal(h.current.note, "keep me"); assert.equal(h.current.dirty, true);
  const accepted = h.select(next); await tick(); h.answerDiscard(true); await accepted;
  assert.equal(h.current.selected, next); assert.equal(h.current.note, "saved B"); assert.equal(h.current.dirty, false);
});

test("accepted jobs invalidate pending catalog refreshes", async () => {
  const h = setup(), pending = h.refresh(true), before = h.current.state;
  h.acceptJob({ id: "new", state: "running" }); h.reads[0].resolve(catalog("old job"));
  assert.equal(await pending, false); assert.equal(h.current.state, before);
});

test("editing during completion's waveform read suppresses its old success notice", async () => {
  const h = setup({ decoded: true });
  const completion = h.callbacks.onSnapshot({ id: "done", state: "succeeded" }, { restoring: false });
  h.reads[0].resolve(catalog("imported", true)); await tick();
  assert.equal(h.reads[1].path, "/api/wave/A"); h.edit("new waveform-time draft");
  h.reads[1].resolve({ a: [], b: [] }); await completion;
  assert.equal(h.current.note, "new waveform-time draft"); assert.equal(h.current.dirty, true);
  assert.equal(h.notices.some(([text]) => text === "jobDone"), false);
});

test("mutation start invalidates a read even after busy clears without any edit", async () => {
  const h = setup(), pending = h.refresh(true), before = h.current.state;
  h.setBusy(true); h.setBusy(false);
  h.reads[0].resolve(catalog("before-mutation"));
  assert.equal(await pending, false); assert.equal(h.current.state, before);
});

test("forced refresh does not discard a pre-existing dirty draft", async () => {
  const h = setup(), before = h.current.state, selection = h.current.selected;
  h.edit("existing draft"); const pending = h.refresh(true); await tick();
  // An implementation may refuse before requesting or reject the response.
  if (h.reads.length) h.reads[0].resolve(catalog("fresh"));
  assert.equal(await pending, false); assert.equal(h.current.state, before);
  assert.equal(h.current.selected, selection); assert.equal(h.current.note, "existing draft");
  assert.equal(h.current.dirty, true); assert.equal(h.dialogs, 0);
});

test("an invalidated refresh waveform error cannot replace newer feedback", async () => {
  const h = setup({ decoded: true }), pending = h.refresh(true);
  h.reads[0].resolve(catalog("fresh", true)); await tick();
  assert.equal(h.reads[1].path, "/api/wave/A");
  h.edit("new draft"); const save = h.save();
  h.writes[0].reject(new Error("new save feedback")); await save;
  assert.deepEqual(h.notices.at(-1), ["new save feedback"]);
  const count = h.notices.length;
  h.reads[1].reject(new Error("obsolete wave failure"));
  assert.equal(await pending, false); assert.equal(h.notices.length, count);
  assert.equal(h.current.note, "new draft"); assert.equal(h.current.dirty, true);
});

test("a current refresh waveform error remains visible", async () => {
  const h = setup({ decoded: true }), pending = h.refresh(true);
  h.reads[0].resolve(catalog("fresh", true)); await tick();
  h.reads[1].reject(new Error("current wave failure"));
  assert.equal(await pending, false); // Keep the waveform error instead of a success notice.
  assert.equal(h.current.state.version, "fresh");
  assert.deepEqual(h.notices.at(-1), ["current wave failure"]);
  assert.equal(h.current.selected.key, "A");
});

test("ordinary user selection still reports its waveform error", async () => {
  const h = setup({ decoded: true }), pending = h.select(h.current.state.items[1]);
  await tick(); assert.equal(h.reads[0].path, "/api/wave/B");
  h.reads[0].reject(new Error("selection wave failure")); await pending;
  assert.deepEqual(h.notices.at(-1), ["selection wave failure"]);
  assert.equal(h.current.selected.key, "B");
});
