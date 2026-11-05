import { stripMarkerText } from "../src/audio_review_desk/static/marker-text.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readFileSync } from "node:fs";
import { readWithRecovery } from "../src/audio_review_desk/static/read-recovery.js";

// Actual workbench control flow with deferred I/O and small DOM/render doubles.
// These tests cover ownership and draft safety, not browser rendering.
const source = readFileSync(process.env.ARD_HISTORY_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = [
  extract("let discardResolver =", "function translate()"),
  extract("function markDirty()", "function range()"),
  extract("async function select(item", "function showCompletion("),
  extract("function showCompletion(", "async function switchVariant("),
  extract("let jobPollError =", "async function startImport("),
  extract(source.includes("function invalidateHistory()") ? "function invalidateHistory()" : "async function loadHistory()", '$("reviewForm").addEventListener("input"'),
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
  const element = () => ({ value: "", hidden: false, elements: [], disabled: false,
    open: false, rows: [], ownText: "",
    get textContent() { return this.ownText + this.rows.map(row => row.textContent).join("\n"); },
    set textContent(value) { this.ownText = String(value); this.rows = []; },
    append(...rows) { this.rows.push(...rows); },
    replaceChildren(...rows) { this.ownText = ""; this.rows = rows; },
    setCustomValidity() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null,
    reportValidity: () => true, focus: noop });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const env = { stripMarkerText, renderExportScope: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    createWaveformReader,
    $, readWithRecovery, initial: catalog("initial", decoded),
    request: path => { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => notices.push(args), errorText: error => error.message, language: "en", t: key => key,
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: false }),
    document: { addEventListener: noop, removeEventListener: noop, activeElement: null, body: {}, createElement: element }, precise: value => String(value), continueQueue: (before, after, key) => after.find(item => item.key !== key), formatTime: value => String(value), openDialog: () => { dialogs++; },
    audition: { cancel: noop }, rememberPosition: noop, media: { cancel: noop, load: noop, pause: noop },
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
    let noticeResolver = null;
    function notice(message = '', ...args) {
      noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null;
      if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice();
    }

    let spectrumVisible = false;
    let state = initial, selected = state.items[0], dirty = false, busy = false,
      generation = 0, historyGeneration = 0, refreshGeneration = 0, refreshController = null, refreshRead = null, pendingCompletion = null, suspendedCompletion = null, variant = 'a', wave = {}, job = null,
      handledJob = null, visibleCache = null;
    const selectedKeys = new Set(), savedThisSession = new Set();
    let listeningMemory = { get: () => ({}) };
    function visibleItems() { return state.items; }
    function draftValues() { return { note: $('note').value }; }
    function renderDetails(restore = true) { if (restore && selected) $('note').value = selected.review.note; }
    ${code}
    $('note').value = selected.review.note;
    return { refresh, select, save, batch, undo, setBusy, acceptJob, loadHistory, selectedKeys,
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      get current() { return { state, selected, dirty, busy, note: $('note').value }; }
    };`)(...Object.values(env));
  return { ...control, get current() { return control.current; }, reads, writes, notices, starts, callbacks, $, get dialogs() { return dialogs; } };
}

const history = (version, note = "review note") => ({ history: [{ version, status: "pass", score: 0, note, markers: [{ time: 1.25, text: "marker" }], updated_utc: "2026-11-03T00:00:00Z" }] });
const mutationSuccess = action => action === "undo"
  ? { saved: true, review: { ...history(2).history[0], issues: [], trim_start: null, trim_end: null, origin: "undo" } }
  : { saved: 1, reviews: [{ key: "A", review: { ...row("A").review, status: "fix", score: null, issues: [], trim_start: null, trim_end: null,
      version: 2, updated_utc: "2026-11-03T00:00:00Z", origin: "batch_ui" } }] };
const open = h => { h.$("historyPanel").open = true; return h.loadHistory(); };

test("history clears old rows while loading another clip", async () => {
  const h = setup(), first = open(h); h.reads[0].resolve(history(1, "A private note")); await first;
  await h.select(row("B")); const next = open(h);
  assert.equal(h.$("history").textContent, "historyLoading");
  h.reads[1].resolve(history(2, "B note")); await next;
  assert.match(h.$("history").textContent, /B note/);
});
test("latest same-clip history read owns both success and failure", async () => {
  for (const failure of [false, true]) {
    const h = setup(), old = open(h), latest = h.loadHistory();
    h.reads[1].resolve(history(2)); await latest;
    if (failure) h.reads[0].reject(new Error("old failure")); else h.reads[0].resolve(history(1));
    await old;
    assert.match(h.$("history").textContent, /^v2/); assert.deepEqual(h.notices, []);
  }
});
test("closed history ignores pending success and error", async () => {
  for (const failure of [false, true]) {
    const h = setup(), old = open(h); h.$("historyPanel").open = false; await h.loadHistory();
    const before = h.$("history").textContent;
    if (failure) h.reads[0].reject(new Error("late failure")); else h.reads[0].resolve(history(1));
    await old; assert.equal(h.$("history").textContent, before); assert.deepEqual(h.notices, []);
  }
});
test("selection round trip invalidates the old history request", async () => {
  const h = setup(), old = open(h); await h.select(row("B")); await h.select(row("A"));
  const latest = open(h); h.reads[1].resolve(history(2)); await latest;
  h.reads[0].resolve(history(1)); await old; assert.match(h.$("history").textContent, /^v2/);
});
test("review mutation invalidates history already in flight", async () => {
  const h = setup(), old = open(h); h.setBusy(true);
  h.reads[0].resolve(history(1)); await old;
  assert.doesNotMatch(h.$("history").textContent, /^v1/);
});
test("current history errors stay local and preserve global feedback", async () => {
  const h = setup(), pending = open(h); h.reads[0].reject(new Error("offline")); await pending;
  assert.match(h.$("history").textContent, /historyError/); assert.deepEqual(h.notices, []);
});
test("successful save reloads open history without awaiting it, including state refresh failure", async () => {
  for (const stateFails of [false, true]) {
    const h = setup(); h.$("historyPanel").open = true;
    const saving = h.save(); h.writes[0].resolve({ review: history(2).history[0] }); await tick();
    if (stateFails) h.reads[0].reject(new Error("state offline")); else h.reads[0].resolve(catalog("saved"));
    await saving;
    assert.equal(h.reads[1]?.path, "/api/history/A");
    h.reads[1].resolve(history(2)); await tick(); assert.match(h.$("history").textContent, /^v2/);
    assert.equal(h.notices.at(-1)[0], stateFails ? "savedRefresh" : "saved");
  }
});
test("closed panel and save-and-advance do not fetch history", async () => {
  for (const advancing of [false, true]) {
    const h = setup(); h.$("historyPanel").open = advancing;
    const saving = h.save(advancing); h.writes[0].resolve({ review: history(2).history[0] }); await tick();
    h.reads[0].resolve(catalog("saved")); await saving;
    assert.deepEqual(h.reads.map(row => row.path), ["/api/state"]);
  }
});
test("zero scores, note text, marker times and empty state remain visible", async () => {
  const h = setup(), pending = open(h); h.reads[0].resolve(history(3)); await pending;
  assert.match(h.$("history").textContent, /score: 0/); assert.match(h.$("history").textContent, /1.25 · marker/);
  const empty = h.loadHistory(); h.reads[1].resolve({ history: [] }); await empty;
  assert.equal(h.$("history").textContent, "noHistory");
});

test("opening history during a review mutation does not read an uncommitted snapshot", async () => {
  const h = setup(); h.setBusy(true); const opening = open(h); assert.equal(h.reads.length, 0); await opening;
});
test("failed save reloads committed history while preserving save error feedback", async () => {
  const h = setup(); h.$("historyPanel").open = true;
  const saving = h.save(); h.writes[0].reject(new Error("save rejected")); await saving;
  assert.equal(h.current.dirty, true); assert.equal(h.reads[0].path, "/api/history/A");
  h.reads[0].resolve(history(1)); await tick();
  assert.match(h.$("history").textContent, /^v1/);
  assert.equal(h.notices.at(-1)[0], "save rejected");
});
test("closing then reopening history revokes both results from the old opening", async () => {
  for (const failure of [false, true]) {
    const h = setup(), old = open(h); h.$("historyPanel").open = false; await h.loadHistory();
    const latest = open(h); h.reads[1].resolve(history(4)); await latest;
    if (failure) h.reads[0].reject(new Error("old opening")); else h.reads[0].resolve(history(1));
    await old; assert.match(h.$("history").textContent, /^v4/); assert.deepEqual(h.notices, []);
  }
});
test("history failure after successful save cannot replace save feedback", async () => {
  const h = setup(); h.$("historyPanel").open = true;
  const saving = h.save(); h.writes[0].resolve({ review: history(2).history[0] }); await tick();
  h.reads[0].resolve(catalog("saved")); await saving;
  h.reads[1].reject(new Error("history offline")); await tick();
  assert.equal(h.notices.at(-1)[0], "saved"); assert.match(h.$("history").textContent, /historyError/);
});

test("save-and-advance with no next visible clip refreshes remaining history", async () => {
  const h = setup(); h.current.state.items.splice(1); h.$("historyPanel").open = true;
  const saving = h.save(true); h.writes[0].resolve({ review: history(2).history[0] }); await tick();
  const saved = catalog("saved"); saved.items.splice(1); h.reads[0].resolve(saved); await saving;
  assert.equal(h.reads[1].path, "/api/history/A"); h.reads[1].resolve(history(2)); await tick();
  assert.match(h.$("history").textContent, /^v2/);
});

test("failed save, undo and batch settle invalidated loading with committed history", async () => {
  for (const action of ["save", "undo", "batch"]) {
    const h = setup(), old = open(h); h.selectedKeys.add("A");
    const mutation = h[action](); await tick();
    h.reads[0].reject(new Error("obsolete history")); await old;
    h.$("historyPanel").open = false; await h.loadHistory(); const opening = open(h);
    assert.equal(h.reads.length, 1, "busy reopening must not read before the mutation settles"); await opening;
    h.writes[0].reject(new Error("mutation failed")); await mutation;
    assert.equal(h.reads[1]?.path, "/api/history/A");
    h.reads[1].resolve(history(1)); await tick();
    assert.match(h.$("history").textContent, /^v1/);
    assert.equal(h.notices.at(-1)[0], "mutation failed");
  }
});
test("undo and batch recover open history if their catalog refresh fails", async () => {
  for (const action of ["undo", "batch"]) {
    const h = setup(); h.selectedKeys.add("A"); h.$("historyPanel").open = true;
    h.$("batchStatus").value = "fix";
    const mutation = h[action](); await tick(); h.writes[0].resolve(mutationSuccess(action)); await tick();
    assert.equal(h.reads[0].path, "/api/state");
    h.reads[0].reject(new Error("state failed")); await mutation;
    assert.equal(h.reads[1].path, "/api/history/A");
    h.reads[1].resolve(history(2)); await tick(); assert.match(h.$("history").textContent, /^v2/);
  }
});
test("successful undo and batch close history without an unnecessary history read", async () => {
  for (const action of ["undo", "batch"]) {
    const h = setup(); h.selectedKeys.add("A"); h.$("historyPanel").open = true;
    h.$("batchStatus").value = "fix";
    const mutation = h[action](); await tick(); h.writes[0].resolve(mutationSuccess(action)); await tick();
    h.reads[0].resolve(catalog("updated")); await mutation;
    assert.equal(h.$("historyPanel").open, false);
    assert.deepEqual(h.reads.map(row => row.path), ["/api/state"]);
  }
});

test("completing the queue closes history and rejects its in-flight result without another GET", async () => {
  const h = setup(); h.current.state.items.splice(1);
  const old = open(h), saving = h.save(true);
  h.writes[0].resolve({ review: history(2).history[0] }); await tick();
  const saved = catalog("complete"); saved.items.splice(1); saved.stats.review_counts.pending = 0;
  h.reads[1].resolve(saved); await saving;
  assert.equal(h.$("historyPanel").open, false);
  assert.equal(h.$("detailPanel").hidden, true);
  assert.equal(h.$("queueComplete").hidden, false);
  const before = h.$("history").textContent;
  h.reads[0].resolve(history(1)); await old;
  assert.equal(h.$("history").textContent, before);
  assert.deepEqual(h.reads.map(row => row.path), ["/api/history/A", "/api/state"]);
});
