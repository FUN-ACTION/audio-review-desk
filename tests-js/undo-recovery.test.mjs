import test from "node:test";
import assert from "node:assert/strict";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readFileSync } from "node:fs";
import { filterItems, sortItems, reviewPayload, sameReview, formatTime } from "../src/audio_review_desk/static/ui.js";
import { words } from "../src/audio_review_desk/static/copy.js";

// Real undo, refresh, selection, filtering and review-form rendering with deferred
// I/O and DOM/media doubles. This is not native-browser acceptance.
const source = readFileSync(process.env.ARD_UNDO_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = [
  extract("let discardResolver =", "function translate()"),
  extract("function visibleItems()", "function renderSelection()"),
  extract("function draftValues()", "function range()"),
  extract("function renderDetails(", "function showCompletion("),
  extract("async function undo()", "async function switchVariant("),
].join("\n");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const review = (patch = {}) => ({ status: "pass", score: 4, note: "latest note", issues: ["noise"], markers: [{ time: 2, text: "latest marker" }], trim_start: 1, trim_end: 8, version: 4, updated_utc: "2026-11-03T20:00:00Z", origin: "human_ui", ...patch });
const restored = () => review({ status: "pending", score: 0, note: "restored earlier note", issues: ["other"], markers: [{ time: 0.125, text: "earlier marker" }], trim_start: 0, trim_end: 5.123456, version: 5, updated_utc: "2026-11-03T20:05:00Z", origin: "undo" });
const item = (key, decoded = true) => ({ key, id: key, label: key, source_id: key, source_start: 0, source_end: 10, eligible: true,
  quality: { decoded, duration: 10, flags: [], sample_rate: 48000, channels: 1, rms_dbfs: -20, peak: 0.5, leading_quiet_seconds: 0, trailing_quiet_seconds: 0 },
  review: review({ status: key === "A" ? "pass" : "pending" }) });
const catalog = (committed = review()) => ({ workspace_id: "undo-test", items: [{ ...item("A"), review: committed }, item("B", false)],
  stats: { files: 2, review_counts: { pass: 1, pending: 1, fix: 0, exclude: 0 }, duplicate_groups: [], human_approved_seconds: 7 } });
function setup({ detached = false, language = "en" } = {}) {
  const reads = [], writes = [], notices = [], renders = [], elements = new Map(), markerState = { rows: [] }, histories = [];
  let dialogs = 0;
  const focusListeners = new Set();
  const document = { body: null, activeElement: null,
    addEventListener(type, fn) { if (type === "focusin") focusListeners.add(fn); },
    removeEventListener(type, fn) { if (type === "focusin") focusListeners.delete(fn); },
  };
  const noop = () => {};
  function element() {
    let value = "", disabled = false;
    return { hidden: false, isConnected: true,
      get disabled() { return disabled; },
      set disabled(next) { disabled = next; if (next && document.activeElement === this) this.blur(); },
      blur() { if (document.activeElement === this) document.activeElement = document.body; },
      focus() {
        if (this.disabled || !this.isConnected || this.hidden) return;
        document.activeElement = this;
        for (const fn of [...focusListeners]) fn({ target: this });
      }, checked: false, open: false, textContent: "", elements: [],
      get value() { return value; }, set value(next) { value = String(next); },
      classList: { toggle: noop }, setAttribute: noop, removeAttribute: noop, replaceChildren: noop, append: noop,
      setCustomValidity: noop, reportValidity: () => true, querySelector: () => null, querySelectorAll: () => [] };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const decisions = ["pending", "pass", "fix", "exclude"].map(value => Object.assign(element(), { value }));
  const issues = ["noise", "other"].map(value => Object.assign(element(), { value }));
  $("issues").querySelectorAll = query => query.includes(":checked") ? issues.filter(row => row.checked) : issues;
  $("reviewForm").elements = [$("undo"), $("note"), $("score"), $("trimStart"), $("trimEnd"), ...decisions, ...issues];
  $("filter").value = "all"; $("sort").value = "name";
  const env = { renderExportScope: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    createWaveformReader,
    $, language, initial: catalog(), detached, filterItems, sortItems, reviewPayload, sameReview, formatTime,
    request: (path, options) => { const wait = deferred(); reads.push({ path, signal: options?.signal, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => { $("notice").textContent = args[0] || ""; notices.push(args); }, errorText: error => error.message,
    t: key => words[language][key] || key, openDialog: () => { dialogs++; },
    document: Object.assign(document, { body: element(), createElement: element,
      querySelectorAll: query => query === "input[name=decision]" ? decisions : [],
      querySelector: query => query === "input[name=decision]:checked" ? decisions.find(input => input.checked) : null }),
    markersView: { set: rows => { markerState.rows = structuredClone(rows); }, get: () => structuredClone(markerState.rows),
      refresh: noop, hasChanges: () => false, flush: () => true, captureFocus: () => null },
    player: { readyState: 1, pause: noop, removeAttribute: noop, load: noop },
    media: { cancel: noop, load: noop }, audition: { cancel: noop }, spectrumView: { setVisible: noop, setSource: noop }, waveformView: { cancelDrag() {}, reset: noop },
    quietRange: () => null, syncGlider: noop, updateTime: noop, drawWave: noop, rememberPosition: noop, updateLibraryToggle: noop,
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: false }), resumedTime: () => 0,
    invalidateHistory: noop, loadHistory: () => histories.push(true), recordRender: value => renders.push(value),
  };
  document.activeElement = document.body;
  const control = Function(...Object.keys(env), `
    let noticeResolver = null;
    function notice(message = '', ...args) {
      noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null;
      if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice();
    }

    let state = initial, selected = detached ? structuredClone(state.items[0]) : state.items[0], dirty = false, busy = false,
      variant = 'a', wave = {}, generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      suspendedCompletion = null, visibleCache = null, spectrumVisible = false;
    const selectedKeys = new Set(), savedThisSession = new Set();
    const listeningMemory = { get: () => ({}) };
    function renderSummary() {}
    function renderQueue() { recordRender({ busy, note: $('note').value, rows: visibleItems().map(item => [item.key, item.review.status, item.review.version]) }); }
    ${code}
    renderDetails();
    return { feedback: notice, undo, save, refresh, select, visibleItems, draftValues,
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      get current() { return { state, selected, dirty, busy, form: draftValues() }; }
    };`)(...Object.values(env));
  return { ...control, document, focusListeners, get current() { return control.current; }, $, reads, writes, notices, renders, histories, feedback: control.feedback, get dialogs() { return dialogs; } };
}
async function commitUndo(h, result = restored()) {
  const pending = h.undo(); await tick();
  h.writes.at(-1).resolve({ saved: true, review: result }); await tick();
  assert.equal(h.reads.at(-1)?.path, "/api/state");
  return { pending };
}
async function failCatalog(h, pending) { h.reads.at(-1).reject(new Error("catalog unavailable")); await pending; }
async function completeCatalog(h, pending, next = catalog(restored())) {
  h.reads.at(-1).resolve(next); await tick();
  if (h.reads.at(-1).path.startsWith("/api/wave/")) h.reads.at(-1).resolve({ a: [], b: [] });
  await pending;
}

test("undo applies its committed review and all form controls before editing unlocks", async () => {
  const h = setup(), selected = h.current.selected, local = h.current.state.items[0], { pending } = await commitUndo(h);
  const beforeFailure = h.current;
  await failCatalog(h, pending);
  assert.equal(beforeFailure.selected, selected); assert.equal(h.current.state.items[0], local);
  assert.deepEqual(beforeFailure.selected.review, restored());
  assert.deepEqual(beforeFailure.form, { status: "pending", score: "0", trimStart: "0", trimEnd: "5.123456", issues: ["other"], note: "restored earlier note", markers: restored().markers });
  assert.equal(beforeFailure.dirty, false); assert.equal(beforeFailure.busy, false);
  assert.equal(h.renders.find(row => !row.busy)?.note, "restored earlier note");
});

test("undo reconciles detached selected and catalog objects without replacing either", async () => {
  const h = setup({ detached: true }), selected = h.current.selected, local = h.current.state.items[0];
  assert.notEqual(selected, local);
  const { pending } = await commitUndo(h); await failCatalog(h, pending);
  assert.equal(h.current.selected, selected); assert.equal(h.current.state.items[0], local);
  assert.deepEqual(selected.review, restored()); assert.deepEqual(local.review, restored());
});

test("undo invalidates cached status and note filters before a failed catalog read", async () => {
  for (const [filter, search] of [["pending", ""], ["all", "earlier"]]) {
    const h = setup(); h.$("filter").value = filter; h.$("search").value = search;
    const before = h.visibleItems(); assert.equal(before.some(row => row.key === "A"), false);
    const { pending } = await commitUndo(h); await failCatalog(h, pending);
    assert.equal(h.visibleItems().some(row => row.key === "A"), true);
    assert.notEqual(h.visibleItems(), before); assert.equal(h.$("outsideFilter").hidden, true);
  }
});

test("a review leaving the active filter remains open with correct outside-filter feedback", async () => {
  const h = setup(); h.$("filter").value = "pass"; h.visibleItems();
  const { pending } = await commitUndo(h); await failCatalog(h, pending);
  assert.deepEqual(h.visibleItems(), []); assert.equal(h.current.selected.key, "A");
  assert.equal(h.$("outsideFilter").hidden, false); assert.equal(h.$("detailPanel").hidden, false);
});

test("the next save uses the undo version and restored values after catalog failure", async () => {
  const h = setup(), { pending } = await commitUndo(h); await failCatalog(h, pending);
  h.edit("new review after undo"); const saving = h.save(); await tick();
  const write = h.writes.at(-1); write.reject(new Error("test stopped after payload capture")); await saving;
  assert.equal(write.path, "/api/review"); assert.equal(write.payload.expected_version, 5);
  assert.equal(write.payload.note, "new review after undo"); assert.equal(write.payload.score, 0);
  assert.equal(write.payload.trim_end, 5.123456); assert.deepEqual(write.payload.markers, restored().markers);
});

test("the next undo uses the committed version after catalog failure", async () => {
  const h = setup(), { pending } = await commitUndo(h); await failCatalog(h, pending);
  const undoing = h.undo(); await tick(); const write = h.writes.at(-1);
  write.reject(new Error("test stopped after payload capture")); await undoing;
  assert.deepEqual(write.payload, { key: "A", expected_version: 5 });
});

test("catalog failure reports committed undo and stale totals in both languages", async () => {
  for (const language of ["en", "zh"]) {
    const h = setup({ language }), stats = structuredClone(h.current.state.stats), { pending } = await commitUndo(h);
    await failCatalog(h, pending);
    assert.equal(typeof words[language].undoRefresh, "string");
    assert.deepEqual(h.notices.at(-1), [words[language].undoRefresh]);
    assert.deepEqual(h.current.state.stats, stats, "duration unions remain server-derived, not guessed");
    assert.equal(h.histories.length, 1);
  }
});

test("undo can restore the empty default review without retaining discarded fields", async () => {
  const h = setup(), empty = review({ status: "pending", score: null, note: "", issues: [], markers: [], trim_start: null, trim_end: null, version: 5 });
  const { pending } = await commitUndo(h, empty); await failCatalog(h, pending);
  assert.deepEqual(h.current.form, { status: "pending", score: "", trimStart: "", trimEnd: "", note: "", issues: [], markers: [] });
});

test("a rejected undo leaves the existing review unchanged and does not read the catalog", async () => {
  const h = setup(), before = structuredClone(h.current.form), selected = h.current.selected;
  const pending = h.undo(); await tick(); h.writes[0].reject(new Error("undo conflict")); await pending;
  assert.deepEqual(h.current.form, before); assert.equal(h.current.selected, selected);
  assert.deepEqual(h.current.selected.review, review()); assert.deepEqual(h.reads, []);
  assert.deepEqual(h.notices.at(-1), ["undo conflict"]); assert.equal(h.current.busy, false);
});

test("declining the discard dialog keeps the draft and sends no undo", async () => {
  const h = setup(); h.edit("keep this draft"); const pending = h.undo(); await tick();
  assert.equal(h.dialogs, 1); h.answerDiscard(false); await pending;
  assert.equal(h.current.form.note, "keep this draft"); assert.equal(h.current.dirty, true);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.reads, []);
});

test("successful undo refresh keeps server totals, current review and success feedback", async () => {
  const h = setup(), { pending } = await commitUndo(h), next = catalog(restored());
  next.stats.review_counts = { pass: 0, pending: 2, fix: 0, exclude: 0 }; next.stats.human_approved_seconds = 0;
  await completeCatalog(h, pending, next);
  assert.equal(h.current.state, next); assert.deepEqual(h.current.selected.review, restored());
  assert.deepEqual(h.notices.at(-1), [words.en.undoSaved, true]); assert.equal(h.histories.length, 0);
});

test("editing during undo refresh preserves the new draft and newer feedback", async () => {
  for (const failure of [false, true]) {
    const h = setup(), { pending } = await commitUndo(h);
    h.edit("newer draft"); h.feedback("newer feedback");
    if (failure) h.reads[0].reject(new Error("late failure")); else h.reads[0].resolve(catalog());
    await pending;
    assert.equal(h.current.form.note, "newer draft"); assert.equal(h.current.dirty, true);
    assert.deepEqual(h.notices.at(-1), ["newer feedback"]); assert.equal(h.histories.length, 0);
  }
});

test("navigation during undo refresh is not replaced by late results or feedback", async () => {
  for (const failure of [false, true]) {
    const h = setup(), { pending } = await commitUndo(h), next = h.current.state.items[1];
    await h.select(next); h.feedback("new selection feedback");
    if (failure) h.reads[0].reject(new Error("late failure")); else h.reads[0].resolve(catalog());
    await pending;
    assert.equal(h.current.selected, next); assert.deepEqual(h.notices.at(-1), ["new selection feedback"]);
    assert.equal(h.histories.length, 0);
  }
});

test("a newer refresh owns its catalog and feedback after undo", async () => {
  const h = setup(), { pending } = await commitUndo(h), newer = h.refresh(true), next = catalog(restored());
  await completeCatalog(h, newer, next); h.feedback("new refresh feedback");
  h.reads[0].reject(new Error("obsolete undo refresh")); await pending;
  assert.equal(h.current.state, next); assert.deepEqual(h.notices.at(-1), ["new refresh feedback"]);
});

test("a new mutation revokes pending undo refresh feedback", async () => {
  const h = setup(), { pending } = await commitUndo(h);
  h.edit("saving after undo"); const saving = h.save(); h.feedback("saving newer review");
  h.reads[0].reject(new Error("obsolete undo refresh")); await pending;
  assert.equal(h.current.busy, true); assert.deepEqual(h.notices.at(-1), ["saving newer review"]);
  assert.equal(h.histories.length, 0);
  h.writes.at(-1).reject(new Error("save stopped")); await saving;
});

test("waveform failure after a refreshed catalog retains its specific error", async () => {
  const h = setup(), { pending } = await commitUndo(h), next = catalog(restored());
  h.reads[0].resolve(next); await tick(); assert.equal(h.reads[1].path, "/api/wave/A");
  h.reads[1].reject(new Error("waveform unavailable")); await pending;
  assert.equal(h.current.state, next); assert.deepEqual(h.notices.at(-1), ["waveform unavailable"]);
});

// Native controls blur when disabled. Model that transition and actual focusin
// ownership; these checks do not claim browser or screen-reader acceptance.
test("failed keyboard undo restores its reenabled trigger and removes its focus listener", async () => {
  const h = setup(); h.$("undo").focus();
  const pending = h.undo(); await tick();
  assert.equal(h.document.activeElement, h.document.body);
  assert.equal(h.$("undo").disabled, true);
  h.writes[0].reject(new Error("undo conflict")); await pending;
  assert.equal(h.document.activeElement, h.$("undo"));
  assert.equal(h.$("undo").disabled, false); assert.equal(h.focusListeners.size, 0);
});

for (const outcome of ["success", "catalog failure", "waveform failure"]) {
  test(`undo restores focus before its independent ${outcome} refresh settles`, async () => {
    const h = setup(); h.$("undo").focus(); const { pending } = await commitUndo(h);
    assert.equal(h.document.activeElement, h.$("undo")); assert.equal(h.focusListeners.size, 0);
    h.$("search").focus();
    if (outcome === "catalog failure") await failCatalog(h, pending);
    else if (outcome === "waveform failure") {
      h.reads[0].resolve(catalog(restored())); await tick();
      h.reads[1].reject(new Error("waveform unavailable")); await pending;
    } else await completeCatalog(h, pending);
    assert.equal(h.document.activeElement, h.$("search"), "refresh never reclaims focus");
  });
}

for (const success of [false, true]) for (const blur of [false, true]) {
  test(`undo preserves deliberate focus movement (success=${success}, later blur=${blur})`, async () => {
    const h = setup(); h.$("undo").focus(); const pending = h.undo(); await tick();
    h.$("search").focus(); if (blur) h.$("search").blur();
    if (success) { h.writes[0].resolve({ review: restored() }); await tick(); await failCatalog(h, pending); }
    else { h.writes[0].reject(new Error("undo conflict")); await pending; }
    assert.equal(h.document.activeElement, blur ? h.document.body : h.$("search"));
    assert.equal(h.focusListeners.size, 0);
  });
}

test("undo does not focus a detached originating control", async () => {
  const h = setup(); h.$("undo").focus(); const pending = h.undo(); await tick();
  h.$("undo").isConnected = false;
  h.writes[0].reject(new Error("undo conflict")); await pending;
  assert.equal(h.document.activeElement, h.document.body); assert.equal(h.focusListeners.size, 0);
});

test("cancelling discard never installs undo focus ownership", async () => {
  const h = setup(); h.edit("keep draft"); h.$("undo").focus();
  const pending = h.undo(); await tick();
  assert.equal(h.document.activeElement, h.$("keepEditing")); assert.equal(h.focusListeners.size, 0);
  h.$("note").focus(); h.answerDiscard(false); await pending;
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(h.writes.length, 0);
});

test("new mutation during undo refresh retains its own focus ownership", async () => {
  const h = setup(); h.$("undo").focus(); const { pending } = await commitUndo(h);
  h.$("note").focus(); h.edit("new draft"); const saving = h.save(); await tick();
  assert.equal(h.document.activeElement, h.document.body);
  h.reads[0].reject(new Error("obsolete read")); await pending;
  assert.equal(h.document.activeElement, h.document.body);
  h.writes.at(-1).reject(new Error("save stopped")); await saving;
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(h.focusListeners.size, 0);
});
