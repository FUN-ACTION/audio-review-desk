import { stripMarkerText } from "../src/audio_review_desk/static/marker-text.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountMarkers } from "../src/audio_review_desk/static/markers.js";
import { createDraftRecovery, canonicalBaseline } from "../src/audio_review_desk/static/draft-recovery.js";
import { createDraftSession } from "../src/audio_review_desk/static/draft-session.js";
import { formatTime, reviewPayload, sameReview } from "../src/audio_review_desk/static/ui.js";
import { words } from "../src/audio_review_desk/static/copy.js";

// Actual workbench functions, handlers, controller, serialization and marker
// editor, with deterministic DOM/storage/network doubles. Not browser QA.
const source = readFileSync(process.env.ARD_RELOAD_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Source boundary missing: ${start} / ${end}`);
  return source.slice(a, b);
};
const code = [
  extract('window.addEventListener("beforeunload"', "function closeSettings()"),
  extract("let discardResolver =", "for (const name of issueNames)"),
  extract("function draftValues()", "function range()"),
  extract("function renderDetails(", "function revealQueueSelection()"),
  extract("let refreshLoadError =", "function showCompletion("),
  extract("function invalidateHistory()", '$("reviewForm").addEventListener("input"'),
  extract('$("reviewForm").addEventListener("input", markDirty);', '$("reviewForm").addEventListener("submit"'),
  extract('window.addEventListener("pagehide", (event) => {', 'document.addEventListener("visibilitychange"'),
].join("\n");
const initializer = extract("const draftSession = createDraftSession({", "async function goToNextPending()");
const workspaceId = "a".repeat(64), A = "b".repeat(64), B = "c".repeat(64), foreignWorkspace = "d".repeat(64);
const storageKey = `ard-reload-draft-v1:${workspaceId}`;
const issueNames = ["cut_start", "cut_end", "noise", "reverb", "backing_voice", "instrument", "lyrics", "distortion", "identity", "other"];
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const savedReview = (patch = {}) => ({ version: 3, status: "fix", score: 8, trim_start: 1, trim_end: 9,
  issues: ["noise"], note: "Current saved review", markers: [{ time: 2, text: "Current marker" }],
  updated_utc: "2026-11-03T20:00:00Z", origin: "ui", ...patch });
const oldReview = (patch = {}) => savedReview({ version: 1, status: "pass", score: 0, trim_start: 0, trim_end: null,
  issues: ["cut_start", "other"], note: "Earlier\nreview note", markers: [{ time: 0, text: "Opening" }], ...patch });
const row = (key = A, { decoded = true, review = savedReview() } = {}) => ({ key, label: key === A ? "Clip A" : "Clip B", eligible: decoded,
  source_id: "private source never stored", source_start: 0, source_end: 10,
  quality: { decoded, duration: 10, flags: [], sample_rate: 48000, channels: 1, rms_dbfs: -20, peak: 0.5,
    leading_quiet_seconds: 0, trailing_quiet_seconds: 0 }, review });
const catalog = (items = [row(), row(B)], id = workspaceId) => ({ workspace_id: id, session: "private session never stored", items, stats: { review_counts: { pending: 1 } } });
const draft = (patch = {}) => ({ key: A, baseline: savedReview(),
  form: { status: "pass", score: "0", trimStart: "0", trimEnd: "", issues: ["other"], note: "Recovered\n草稿 🎧" },
  markers: { rows: [{ time: 1.23456789, text: "Precise 🎧" }], input: "", editing: null }, ...patch });
function storage(seed = null) {
  const map = new Map(), calls = [];
  const result = { map, calls, failRead: false, failWrite: false, failClear: false,
    getItem(key) { calls.push(["get", key]); if (this.failRead) throw new Error("Storage unavailable"); return map.get(key) ?? null; },
    setItem(key, value) { calls.push(["set", key]); if (this.failWrite) throw new Error("Quota exceeded"); map.set(key, String(value)); },
    removeItem(key) { calls.push(["remove", key]); if (this.failClear) throw new Error("Clear unavailable"); map.delete(key); },
  };
  if (seed) assert.equal(createDraftRecovery({ workspaceId, storage: result, now: () => 1000 }).write(seed).status, "saved");
  return result;
}
function setup({ store = storage(), initial = catalog(), currentKey = initial.items[0]?.key, language = "en", boot = false } = {}) {
  const nodes = new Map(), reads = [], writes = [], notices = [], focus = [], docListeners = new Map(), windowListeners = new Map();
  let dialogs = 0, auditionCancellations = 0;
  const document = { activeElement: null, body: null, documentElement: {},
    addEventListener(type, callback) { docListeners.set(type, [...(docListeners.get(type) || []), callback]); },
    removeEventListener(type, callback) { docListeners.set(type, (docListeners.get(type) || []).filter(fn => fn !== callback)); },
  };
  class Element {
    constructor(tagName = "div", id = "") {
      this.tagName = tagName.toUpperCase(); this.id = id; this.children = []; this.parentElement = null;
      this._text = ""; this.textWrites = 0; this._value = ""; this.className = ""; this.disabled = false; this.checked = false;
      this.hidden = false; this.open = false; this.isConnected = true; this.style = {}; this.dataset = {};
      this.attributes = new Map(); this.listeners = new Map(); this.elements = []; this.validationMessage = "";
      this.classList = { add: name => { this.className += ` ${name}`; },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, enabled) => { const names = new Set(this.className.split(/\s+/).filter(Boolean));
          const on = enabled ?? !names.has(name); on ? names.add(name) : names.delete(name); this.className = [...names].join(" "); return on; } };
    }
    set innerHTML(value) { if (this.id === "draftRecoveryContent") throw new Error("Draft preview must use textContent, never HTML"); this._html = value; }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    get disabled() { return this._disabled; }
    set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; }
    get hidden() { return this._hidden; }
    set hidden(value) { this._hidden = value; if (value && this.contains(document.activeElement)) document.activeElement = document.body; }
    get textContent() { return this._text + this.children.map(node => node.textContent || "").join("\n"); }
    set textContent(value) { this._text = String(value); this.textWrites++; this.children = []; }
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
    replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== fn)); }
    async emit(type, event = {}) { for (const callback of this.listeners.get(type) || []) await callback({ target: this, preventDefault() {}, ...event }); }
    click() {
      for (let node = this; node; node = node.parentElement) if (node.hidden) return Promise.resolve();
      return this.disabled ? Promise.resolve() : this.emit("click");
    }
    focus(options) {
      if (this.disabled || !this.isConnected) return;
      for (let node = this; node; node = node.parentElement) if (node.hidden) return;
      document.activeElement = this; focus.push({ id: this.id, options });
      for (const callback of docListeners.get("focusin") || []) callback({ target: this });
    }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { return !this.querySelector(":invalid") && !this.elements.some(node => node.validationMessage || node.validity?.badInput); }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    closest(selector) { if (selector.startsWith(".") && this.classList.contains(selector.slice(1))) return this; return this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const all = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
      return all.filter(node => selector === "*" || selector === "input" && node.tagName === "INPUT"
        || selector === "input:checked" && node.tagName === "INPUT" && node.checked
        || selector === "button" && node.tagName === "BUTTON"
        || selector === ":invalid" && (node.validationMessage || node.validity?.badInput)
        || selector.startsWith(".") && node.classList.contains(selector.slice(1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element("div", id)); return nodes.get(id); };
  document.createElement = tagName => new Element(tagName);
  document.body = $("body"); document.activeElement = document.body;
  const decisions = ["pending", "pass", "fix", "exclude"].map(value => { const input = new Element("input"); input.value = value; return input; });
  const issues = issueNames.map(value => { const input = new Element("input"); input.value = value; return input; });
  $("issues").append(...issues);
  document.querySelectorAll = selector => selector === "input[name=decision]" ? decisions : [];
  document.querySelector = selector => selector === "input[name=decision]:checked" ? decisions.find(input => input.checked) || null : null;
  // Match the real page: trim controls are associated through form=, not
  // descendants. Input events on them do not bubble through reviewForm.
  $("reviewForm").append(...decisions, $("score"), $("note"), $("issues"));
  $("rangeFields").append($("trimStart"), $("trimEnd"));
  $("markerSection").append($("markerText"), $("markerList"));
  $("reviewForm").elements = [...decisions, $("score"), $("trimStart"), $("trimEnd"), $("note"), ...issues, $("clearProtectedDraft")];
  $("draftProtection").append($("draftProtectionSummary"), $("draftProtectionWhen"), $("clearProtectedDraft"));
  $("draftProtectionSummary").append($("draftProtectionStatus"));
  $("reviewForm").append($("draftProtection"));
  $("draftRecovery").append($("draftRecoveryText"), $("restoreDraft"), $("locateDraft"), $("discardDraft"), $("draftRecoveryPreview"));
  $("draftRecoveryPreview").append($("draftRecoveryContent"));
  $("detailPanel").append($("clipTitle"), $("reviewForm"));
  document.body.append($("draftRecovery"), $("detailPanel"), $("search"));
  $("historyPanel").open = false; $("queueComplete").hidden = true; $("importError").hidden = true;
  globalThis.document = document;
  const noop = () => {};
  const env = { stripMarkerText, $, document, initial, currentKey, initialLanguage: language, boot, issueNames, words,
    mountMarkers, createDraftRecovery, createDraftSession, reviewPayload, sameReview, formatTime,
    sessionStorage: store, matchMedia: () => ({ matches: false }), resumedTime: () => 0,
    precise: value => `${formatTime(value)}.${Math.floor(((value || 0) % 1) * 1000).toString().padStart(3, "0")}`,
    request: path => { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    notice: (message, ...args) => notices.push([typeof message === "function" ? message() : message, ...args]), errorText: error => error.message,
    openDialog: () => { dialogs++; }, audition: { cancel: () => { auditionCancellations++; } },
    renderSummary: noop, renderQueue: noop, drawWave: noop, syncGlider: noop, updateTime: noop, renderWaveStatus: noop,
    rememberPosition: noop, updateLibraryToggle: noop, revealQueueSelection: noop,
    waveformReader: { cancel: noop, load: async () => true }, waveformView: { cancelDrag() {}, reset: noop },
    spectrumView: { setVisible: noop, setSource: noop, setLanguage: noop, dispose: noop },
    media: { currentTime: 0, cancel: noop, load: noop },
    player: { currentTime: 0, readyState: 4, pause: noop, removeAttribute: noop, load: noop }, quietRange: () => null,
    transport: { refresh: noop }, continueQueue: () => null, showCompletion: noop,
    window: { addEventListener(type, callback) { windowListeners.set(type, callback); } }, jobPoller: { stop: noop, start: noop },
  };
  const control = Function(...Object.keys(env), `
    let noticeGeneration = 0;
    let state = boot ? null : initial, selected = boot ? null : initial.items.find(item => item.key === currentKey),
      dirty = false, busy = false, generation = 0, historyGeneration = 0, refreshGeneration = 0,
      refreshController = null, refreshRead = null, suspendedCompletion = null, pendingCompletion = null,
      visibleCache = null, variant = 'a', spectrumVisible = false, language = initialLanguage, job = null,
      wave = {a: [], b: []}, waveStatus = null, waveNotice = null, noticeResolver = null;
    const savedThisSession = new Set(), selectedKeys = new Set();
    let listeningMemory = { get: () => ({}) };
    const t = key => words[language][key] || key;
    function visibleItems() { return state?.items || []; }
    const markersView = mountMarkers({ input: $('markerText'), add: $('addMarker'), list: $('markerList'),
      ticks: $('markerTicks'), player, duration: () => selected?.quality.duration || 0,
      t, onChange: () => markDirty(), onError: notice });
    ${initializer}
    ${code}
    if (!boot) { draftSession.initialize(state.workspace_id); if (selected) renderDetails(); }
    return { draftSession, draftValues, markersView, loadHistoryDraft, discardAllowed,
      save, select, refresh, setBusy, markDirty, renderDetails, invalidateHistory, invalidateRefresh,
      context() { return { key: selected.key, selectionTurn: generation, version: selected.review.version, historyTurn: historyGeneration }; },
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; if (resolve) resolve(allowed); },
      changeVersion(review) { selected.review = review; draftSession.refresh(); },
      switchLanguage(next) { language = next; translate(); },
      get current() { return { state, selected, dirty, busy, generation, historyGeneration, refreshGeneration }; }
    };
  `)(...Object.values(env));
  return { ...control, get current() { return control.current; }, $, document, decisions, issues, reads, writes, notices, focus, store,
    activate() { globalThis.document = document; },
    clickDocument(target) { for (const callback of docListeners.get("click") || []) callback({ target }); },
    beforeUnload() { let prevented = false; windowListeners.get("beforeunload")({ preventDefault() { prevented = true; } }); return prevented; },
    pagehide(persisted = true) { globalThis.document = document; return windowListeners.get("pagehide")({ persisted }); },
    pageshow(persisted = true) { globalThis.document = document; return windowListeners.get("pageshow")({ persisted }); },
    get dialogs() { return dialogs; }, get auditionCancellations() { return auditionCancellations; } };
}
const copyIn = store => createDraftRecovery({ workspaceId, storage: store }).read();
const restore = async h => { h.activate(); return h.$("restoreDraft").click(); };
const type = async (h, id, value) => { h.activate(); h.$(id).value = value; await h.$(id).emit("input"); if (h.$("reviewForm").contains(h.$(id))) await h.$("reviewForm").emit("input"); };
const readPayload = h => ({ ...h.draftValues(), markerDraft: h.markersView.snapshot() });
function assertBaseline(h, before = savedReview()) {
  assert.deepEqual(h.current.selected.review, before);
  assert.deepEqual(h.current.state.items.find(item => item.key === h.current.selected.key).review, before);
}

// Tests follow below.

test("actual startup refresh offers a stored draft without applying it or issuing a POST", async () => {
  const store = storage(draft()), before = store.map.get(storageKey), h = setup({ store, boot: true });
  const starting = h.refresh(true); assert.equal(h.reads.length, 1); h.reads[0].resolve(catalog());
  assert.equal(await starting, true); assert.equal(h.current.selected.key, A); assertBaseline(h);
  assert.equal(h.$("note").value, savedReview().note); assert.equal(h.current.dirty, false);
  assert.equal(h.draftSession.state().canRestore, true); assert.equal(h.draftSession.state().owned, false);
  assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryAvailable);
  assert.equal(h.$("restoreDraft").disabled, false); assert.equal(h.$("draftRecoveryPreview").hidden, false);
  assert.equal(store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
});

test("explicit Restore applies exact fields, remains unsaved, and preserves the actual current baseline", async () => {
  const pending = draft(), h = setup({ store: storage(pending) }), selected = h.current.selected;
  await restore(h);
  assert.equal(h.current.selected, selected); assertBaseline(h);
  const { markers, ...form } = h.draftValues(); assert.deepEqual(form, pending.form);
  assert.deepEqual(markers, pending.markers.rows); assert.equal(h.current.dirty, true);
  assert.equal(h.$("saveState").textContent, words.en.unsaved); assert.equal(h.draftSession.state().protected, true);
  assert.equal(h.$("draftRecoveryPreview").hidden, true); assert.equal(h.document.activeElement, h.$("note"));
  assert.equal(h.writes.length, 0); assert.equal(h.notices.at(-1)[0], words.en.recoveryRestored);
  assert.deepEqual(copyIn(h.store).record.baseline, canonicalBaseline(savedReview()));
});

test("form edits persist exact raw strings and never store unrelated workspace, media or session data", async () => {
  const h = setup(); await type(h, "note", "  local\n草稿 🎧  ");
  await type(h, "score", "0"); await type(h, "trimStart", "1:"); await type(h, "trimEnd", "");
  const value = copyIn(h.store); assert.equal(value.status, "available");
  assert.deepEqual(value.record.form, { status: "fix", score: "0", trimStart: "1:", trimEnd: "", issues: ["noise"], note: "  local\n草稿 🎧  " });
  assert.deepEqual(value.record.baseline, canonicalBaseline(savedReview()));
  assert.doesNotMatch(h.store.map.get(storageKey), /private source|private session|source_id|audio|\/media\/|updated_utc|origin/);
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("unfinished marker input alone survives pagehide and reload without being added", async () => {
  const h = setup(); await type(h, "markerText", "  not added 🎧  ");
  assert.equal(h.current.dirty, true); const expected = h.markersView.snapshot(); h.pagehide(false);
  const resumed = setup({ store: h.store }); assert.equal(resumed.$("markerText").value, "");
  await restore(resumed); assert.deepEqual(resumed.markersView.snapshot(), expected);
  assert.deepEqual(resumed.markersView.get(), savedReview().markers);
  assert.equal(resumed.writes.length, 0); assert.equal(resumed.current.dirty, true); assertBaseline(resumed);
});

test("actual marker inline invalid raw time and text survive recovery without validation or flush", async () => {
  const h = setup(); await h.$("markerList").querySelector(".marker-note").click();
  const time = h.$("markerList").querySelector(".marker-edit-time"), text = h.$("markerList").querySelector(".marker-edit-text");
  time.value = "1:"; await time.emit("input"); text.value = "   "; await text.emit("input");
  await type(h, "markerText", "  another pending note  ");
  const expected = h.markersView.snapshot(), beforeNotices = h.notices.length;
  assert.deepEqual(expected.editing, { index: 0, time: "1:", text: "   ", originalTime: 2, timeDirty: true });
  assert.equal(h.notices.length, beforeNotices); h.pagehide();
  const resumed = setup({ store: h.store }); await restore(resumed);
  assert.deepEqual(resumed.markersView.snapshot(), expected); assertBaseline(resumed);
  assert.equal(resumed.writes.length, 0); assert.equal(resumed.current.dirty, true);
  const saving = resumed.save(); await saving;
  assert.equal(resumed.writes.length, 0, "explicit Save must still validate restored inline fields");
  assert.deepEqual(resumed.markersView.snapshot(), expected);
});

for (const refreshFailure of [false, true]) test(`confirmed Save uses the original current version and clears its owned copy before catalog settles (failure=${refreshFailure})`, async () => {
  const h = setup({ store: storage(draft()) }); await restore(h);
  const saving = h.save(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].path, "/api/review");
  assert.equal(h.$("exportScope").textContent, words.en.exportScopeSaving);
  assert.deepEqual(h.writes[0].payload, { key: A, expected_version: 3, status: "pass", score: 0,
    trim_start: 0, trim_end: null, issues: ["other"], note: draft().form.note, markers: draft().markers.rows });
  assert.equal(copyIn(h.store).status, "available");
  h.writes[0].resolve({ review: savedReview({ version: 4, status: "pass", score: 0, trim_start: 0, trim_end: null,
    issues: ["other"], note: draft().form.note, markers: draft().markers.rows }) }); await tick();
  assert.equal(copyIn(h.store).status, "empty", "POST confirmation owns clearing, not the catalog request");
  assert.equal(h.reads.at(-1).path, "/api/state");
  assert.equal(h.$("exportScope").textContent, words.en.exportScopeSaving);
  h.switchLanguage("zh");
  assert.equal(h.$("exportScope").textContent, words.zh.exportScopeSaving);
  if (refreshFailure) h.reads.at(-1).reject(new Error("catalog offline"));
  else h.reads.at(-1).resolve(catalog([row(A, { review: h.current.selected.review })]));
  await saving;
  assert.equal(h.$("exportScope").textContent, words.zh.exportScopeSaved);
  assert.equal(h.current.selected.review.version, 4); assert.equal(h.current.dirty, false);
  assert.equal(h.notices.at(-1)[0], words.zh[refreshFailure ? "savedRefresh" : "saved"]); assert.equal(h.writes.length, 1);
});

for (const message of ["network unavailable", "response lost after request reached server", "Another page updated this review; reload before saving"]) {
  test(`failed or uncertain Save retains the owned copy with no retry: ${message}`, async () => {
    const h = setup({ store: storage(draft()) }); await restore(h);
    const before = h.store.map.get(storageKey), payload = readPayload(h), saving = h.save();
    assert.equal(h.$("exportScope").textContent, words.en.exportScopeSaving);
    h.writes[0].reject(new Error(message)); await saving;
    assert.equal(h.store.map.get(storageKey), before); assert.equal(h.current.dirty, true); assertBaseline(h);
    assert.equal(h.$("exportScope").textContent, words.en.exportScopeDraft);
    assert.deepEqual(readPayload(h), payload); assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 0);
    assert.equal(h.notices.at(-1)[0], message);
  });
}

test("confirmed Save with failed storage clear warns and does not claim a saved-review copy is protected", async () => {
  const h = setup(); h.edit("Review to save"); h.store.failClear = true;
  const saving = h.save(); h.writes[0].resolve({ review: savedReview({ version: 4, note: "Review to save" }) });
  await tick(); h.reads.at(-1).reject(new Error("catalog offline")); await saving;
  assert.equal(h.current.dirty, false); assert.equal(h.draftSession.state().protected, false);
  assert.equal(h.draftSession.state().status, "unavailable"); assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryUnavailable);
  assert.equal(h.store.map.has(storageKey), true); assert.equal(h.writes.length, 1);
});

test("history loading creates a newly protected draft based on the current saved review", async () => {
  const h = setup(); h.$("historyPanel").open = true;
  assert.equal(await h.loadHistoryDraft(oldReview(), h.context()), true);
  assertBaseline(h); assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
  const value = copyIn(h.store).record; assert.equal(value.form.note, oldReview().note);
  assert.equal(value.form.score, "0"); assert.equal(value.baseline.version, 3);
  assert.deepEqual(value.baseline, canonicalBaseline(savedReview())); assert.deepEqual(value.markers.rows, oldReview().markers);
  assert.equal(h.draftSession.state().protected, true);
});

test("loading history over an owned draft preserves on Cancel and replaces only after accepted discard", async () => {
  const h = setup(); h.edit("Keep this draft"); const before = h.store.map.get(storageKey); h.$("historyPanel").open = true;
  const cancelled = h.loadHistoryDraft(oldReview(), h.context()); h.answerDiscard(false);
  assert.equal(await cancelled, false); assert.equal(h.store.map.get(storageKey), before); assert.equal(h.$("note").value, "Keep this draft");
  const accepted = h.loadHistoryDraft(oldReview(), h.context()); h.answerDiscard(true);
  assert.equal(await accepted, true); assert.equal(copyIn(h.store).record.form.note, oldReview().note); assertBaseline(h);
  assert.equal(h.draftSession.state().protected, true); assert.equal(h.writes.length, 0);
});

test("normal selection Cancel retains the owned draft and accepted discard clears only that copy", async () => {
  const h = setup(); h.edit("Draft A"); const original = h.store.map.get(storageKey);
  const cancelled = h.select(h.current.state.items[1]); h.answerDiscard(false); await cancelled;
  assert.equal(h.current.selected.key, A); assert.equal(h.store.map.get(storageKey), original); assert.equal(h.current.dirty, true);
  const accepted = h.select(h.current.state.items[1]); h.answerDiscard(true); await accepted;
  assert.equal(h.current.selected.key, B); assert.equal(h.current.dirty, false); assert.equal(copyIn(h.store).status, "empty");
  assert.equal(h.writes.length, 0);
});

test("Restore Cancel preserves a different live draft and the pending stored copy", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Live work after reload");
  const before = h.store.map.get(storageKey), pending = restore(h); assert.equal(h.dialogs, 1);
  h.answerDiscard(false); await pending;
  assert.equal(h.$("note").value, "Live work after reload"); assert.equal(h.current.dirty, true);
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.draftSession.state().owned, false);
  assert.match(h.$("draftRecoveryText").textContent, /new edits are not protected/); assert.equal(h.writes.length, 0);
});

test("Restore accepted discard replaces live fields only after confirmation and becomes owned", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Live work after reload");
  const pending = restore(h); assert.equal(h.$("note").value, "Live work after reload"); h.answerDiscard(true); await pending;
  assert.equal(h.$("note").value, draft().form.note); assert.equal(h.current.dirty, true); assertBaseline(h);
  assert.equal(h.draftSession.state().owned, true); assert.equal(h.draftSession.state().protected, true); assert.equal(h.writes.length, 0);
});

for (const invalidate of ["edit", "history", "refresh", "busy", "baseline"]) {
  test(`obsolete Restore confirmation cannot discard newer ${invalidate} state`, async () => {
    const h = setup({ store: storage(draft()) }); h.edit("Live draft"); const before = h.store.map.get(storageKey);
    const pending = restore(h); assert.equal(h.dialogs, 1);
    if (invalidate === "edit") h.edit("Newer live edit");
    if (invalidate === "history") h.invalidateHistory();
    if (invalidate === "refresh") h.invalidateRefresh();
    if (invalidate === "busy") { h.setBusy(true); h.setBusy(false); }
    if (invalidate === "baseline") h.changeVersion(savedReview({ version: 4, note: "New server review" }));
    const live = readPayload(h); h.answerDiscard(true); await pending;
    assert.deepEqual(readPayload(h), live); assert.equal(h.current.dirty, true);
    assert.equal(h.store.map.get(storageKey), before); assert.equal(h.draftSession.state().owned, false); assert.equal(h.writes.length, 0);
  });
}

for (const patch of [{ version: 4 }, { note: "Same version, changed content" }, { score: 0 }, { markers: [{ time: 2, text: "Changed marker" }] }]) {
  test(`baseline mismatch blocks Restore and leaves the old draft readable: ${JSON.stringify(patch)}`, async () => {
    const current = savedReview(patch), h = setup({ store: storage(draft()), initial: catalog([row(A, { review: current })]) });
    assert.equal(h.draftSession.state().canRestore, false); assert.equal(h.$("restoreDraft").disabled, true);
    assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryStale);
    assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.match(h.$("draftRecoveryContent").textContent, /Recovered/);
    const before = h.store.map.get(storageKey); assert.equal(await h.draftSession.restore(), false);
    assert.equal(h.$("note").value, current.note); assertBaseline(h, current); assert.equal(h.store.map.get(storageKey), before);
    assert.equal(h.current.dirty, false); assert.equal(h.writes.length, 0);
  });
}

test("metadata-only server changes do not change the saved review identity", async () => {
  const current = savedReview({ origin: "import", updated_utc: "2026-11-03T22:00:00Z" });
  const h = setup({ store: storage(draft()), initial: catalog([row(A, { review: current })]) });
  assert.equal(h.draftSession.state().canRestore, true); await restore(h); assertBaseline(h, current);
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("Find this audio navigates but never implicitly restores or POSTs", async () => {
  const h = setup({ store: storage(draft()), currentKey: B }), before = h.store.map.get(storageKey);
  assert.equal(h.$("locateDraft").hidden, false); assert.equal(h.$("restoreDraft").hidden, true);
  await h.$("locateDraft").click(); assert.equal(h.current.selected.key, A);
  assert.equal(h.$("note").value, savedReview().note); assert.equal(h.current.dirty, false);
  assert.equal(h.$("restoreDraft").disabled, false); assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
});

test("missing source keeps the recovery copy and read-only preview", async () => {
  const h = setup({ store: storage(draft()), initial: catalog([row(B)]) }), before = h.store.map.get(storageKey);
  assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryMissing);
  assert.equal(h.$("locateDraft").hidden, true); assert.equal(h.$("restoreDraft").hidden, true);
  assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.match(h.$("draftRecoveryContent").textContent, /Recovered/);
  h.edit("A new draft on B"); assert.equal(h.store.map.get(storageKey), before);
  assert.equal(h.draftSession.state().protected, false); assert.equal(h.writes.length, 0);
});

test("undecoded source retains incompatible copies read-only and allows drafts using only enabled fields", async () => {
  const clean = draft({ form: { status: "fix", score: "", trimStart: "", trimEnd: "", issues: ["other"], note: "Text-only recovered draft" },
    markers: { rows: [], input: "", editing: null } });
  const blocked = [draft(),
    { ...clean, form: { ...clean.form, status: "pass" } },
    ...["score", "trimStart", "trimEnd"].map(key => ({ ...clean, form: { ...clean.form, [key]: "0" } })),
    { ...clean, markers: { ...clean.markers, rows: [{ time: 2, text: "Existing note" }] } },
    { ...clean, markers: { ...clean.markers, input: "Unfinished note" } },
    { ...clean, markers: { rows: [{ time: 2, text: "Existing note" }], input: "",
      editing: { index: 0, time: "1:", text: "Editing note", originalTime: 2, timeDirty: true } } }];
  for (const pending of blocked) {
    const h = setup({ store: storage(pending), initial: catalog([row(A, { decoded: false })]) }), before = h.store.map.get(storageKey);
    assert.equal(h.draftSession.state().canRestore, false); assert.equal(await h.draftSession.restore(), false);
    assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryIncompatible);
    assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.equal(h.current.dirty, false); assertBaseline(h);
    assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
  }
  for (const status of ["pending", "fix", "exclude"]) {
    const pending = { ...clean, form: { ...clean.form, status } };
    const h = setup({ store: storage(pending), initial: catalog([row(A, { decoded: false })]) });
    await restore(h); assertBaseline(h); assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
    assert.equal(h.$("markerText").disabled, true); assert.equal(h.$("addMarker").disabled, true);
    assert.equal(h.$("note").value, pending.form.note); assert.deepEqual(h.markersView.snapshot(), pending.markers);
    assert.equal(h.draftSession.state().protected, true);
  }
});

test("a cloned tab's independent storage cannot clear or overwrite the original, and a newer server base blocks apply", async () => {
  const original = setup({ store: storage(draft()) }); await restore(original); original.edit("Original tab draft");
  const bytes = original.store.map.get(storageKey), clonedStore = storage(); clonedStore.map.set(storageKey, bytes);
  const clone = setup({ store: clonedStore }); await restore(clone); clone.edit("Clone tab draft");
  assert.equal(original.store.map.get(storageKey), bytes); assert.equal(copyIn(clonedStore).record.form.note, "Clone tab draft");
  await clone.$("clearProtectedDraft").click(); assert.equal(copyIn(clonedStore).status, "empty"); assert.equal(original.store.map.get(storageKey), bytes);
  const later = storage(); later.map.set(storageKey, bytes);
  const reopened = setup({ store: later, initial: catalog([row(A, { review: savedReview({ version: 4 }) })]) });
  assert.equal(reopened.draftSession.state().canRestore, false); assert.equal(await reopened.draftSession.restore(), false);
  assert.equal(later.map.get(storageKey), bytes); assert.equal(reopened.writes.length, 0);
});

test("workspace switch retains the old workspace copy without offering it to the new workspace", async () => {
  const store = storage(draft()), h = setup({ store });
  const refreshing = h.refresh(true); h.reads.at(-1).resolve(catalog([row()], foreignWorkspace)); await refreshing;
  assert.equal(h.current.state.workspace_id, foreignWorkspace); assert.equal(h.draftSession.state().record, null);
  assert.equal(h.$("draftRecovery").hidden, true); assert.equal(copyIn(store).status, "available");
  h.edit("New workspace draft"); assert.equal(copyIn(store).record.form.note, draft().form.note);
  const other = createDraftRecovery({ workspaceId: foreignWorkspace, storage: store }).read();
  assert.equal(other.record.form.note, "New workspace draft"); assert.equal(h.writes.length, 0);
});

test("Clear this copy leaves current live edits unchanged and does not immediately create another copy", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Newer live work"); const before = readPayload(h);
  await h.$("discardDraft").click(); assert.equal(copyIn(h.store).status, "empty");
  assert.deepEqual(readPayload(h), before); assert.equal(h.current.dirty, true);
  assert.equal(h.notices.at(-1)[0], words.en.recoveryCleared); assert.equal(h.writes.length, 0);
  h.edit("A later edit"); assert.equal(copyIn(h.store).record.form.note, "A later edit");
});

for (const failure of ["unavailable", "quota", "malformed"]) {
  test(`${failure} storage never claims the current unsaved edit is protected`, async () => {
    const store = storage();
    if (failure === "unavailable") store.failRead = true;
    if (failure === "quota") store.failWrite = true;
    if (failure === "malformed") store.map.set(storageKey, '{"not":"a valid record"}');
    const h = setup({ store }); h.edit("Keep my current draft");
    assert.equal(h.current.dirty, true); assert.equal(h.draftSession.state().protected, false);
    assert.equal(h.draftSession.state().canRestore, false); assert.equal(h.$("draftRecovery").hidden, false);
    assert.equal(h.$("draftRecoveryText").textContent, words.en[failure === "malformed" ? "recoveryInvalid" : "recoveryUnavailable"]);
    assert.equal(h.$("note").value, "Keep my current draft"); assertBaseline(h); assert.equal(h.writes.length, 0);
    if (failure === "malformed") assert.equal(store.map.get(storageKey), '{"not":"a valid record"}');
  });
}

test("quota failure on a later edit exposes an older snapshot without falsely protecting the newer live edit", async () => {
  const h = setup(); h.edit("First protected edit"); const first = h.store.map.get(storageKey);
  h.store.failWrite = true; h.edit("Unprotected later edit");
  assert.equal(h.store.map.get(storageKey), first); assert.equal(h.draftSession.state().protected, false);
  assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryUnavailable);
  assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.match(h.$("draftRecoveryContent").textContent, /First protected edit/);
  assert.equal(h.$("note").value, "Unprotected later edit"); assert.equal(h.writes.length, 0);
});

test("failed clear retains a readable copy and reports failure instead of success", async () => {
  const h = setup({ store: storage(draft()) }), before = h.store.map.get(storageKey); h.store.failClear = true;
  await h.$("discardDraft").click(); assert.equal(h.store.map.get(storageKey), before);
  assert.equal(h.draftSession.state().status, "unavailable"); assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryUnavailable);
  assert.equal(h.notices.some(([message]) => message === words.en.recoveryCleared), false); assert.equal(h.writes.length, 0);
});

test("language redraw updates recovery copy without reapplying or overwriting a live draft", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("New live text"); const before = h.store.map.get(storageKey);
  h.switchLanguage("zh"); assert.equal(h.document.documentElement.lang, "zh-CN");
  assert.equal(h.$("draftRecoveryText").textContent, `${words.zh.recoveryAvailable} ${words.zh.recoveryWaiting}`);
  assert.match(h.$("draftRecoveryContent").textContent, /Recovered/); assert.equal(h.$("note").value, "New live text");
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
  h.switchLanguage("en"); assert.equal(h.$("draftRecoveryText").textContent, `${words.en.recoveryAvailable} ${words.en.recoveryWaiting}`);
});

test("read-only preview renders hostile note and marker strings only through textContent", () => {
  const attack = '<img src=x onerror="globalThis.executed=true">', pending = draft();
  pending.form.note = attack; pending.markers.rows[0].text = '<script>alert("marker")</script>';
  pending.markers.input = '<iframe src="https://example.invalid"></iframe>';
  pending.markers.editing = { index: 0, time: "<b>1:</b>", text: '<svg onload="alert(1)">', originalTime: 1.23456789, timeDirty: true };
  const h = setup({ store: storage(pending) }), preview = h.$("draftRecoveryContent");
  assert.ok(preview.textContent.includes(attack)); assert.ok(preview.textContent.includes(pending.markers.input));
  assert.ok(preview.textContent.includes(pending.markers.editing.text)); assert.deepEqual(preview.children, []);
  assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.equal(h.writes.length, 0);
});

test("BFCache return refreshes the panel but never re-applies the stored copy over live edits", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("New live page-cache draft");
  const pending = h.store.map.get(storageKey), before = readPayload(h), notices = h.notices.length;
  h.pagehide(true); h.pageshow(true); h.pageshow(true);
  assert.deepEqual(readPayload(h), before); assert.equal(h.store.map.get(storageKey), pending);
  assert.equal(h.current.dirty, true); assert.equal(h.draftSession.state().owned, false);
  assert.equal(h.notices.length, notices); assert.equal(h.writes.length, 0);
});

test("Clear this copy followed by pagehide and BFCache return never recreates it", async () => {
  const h = setup(); h.edit("Keep live edits, clear copy");
  await h.$("clearProtectedDraft").click(); assert.equal(copyIn(h.store).status, "empty");
  h.pagehide(true); h.pageshow(true); h.pagehide(false);
  assert.equal(copyIn(h.store).status, "empty"); assert.equal(h.$("note").value, "Keep live edits, clear copy");
  assert.equal(h.current.dirty, true); assert.equal(h.draftSession.state().protected, false); assert.equal(h.writes.length, 0);
  h.edit("Explicit later edit"); assert.equal(copyIn(h.store).record.form.note, "Explicit later edit");
});

test("manually returning every field to its saved value clears only an owned recovery copy", () => {
  const h = setup(); h.edit("Temporary change"); assert.equal(copyIn(h.store).status, "available");
  h.edit(savedReview().note); assert.equal(h.current.dirty, false); assert.equal(copyIn(h.store).status, "empty");
  assert.equal(h.$("draftRecovery").hidden, true); assert.equal(h.writes.length, 0);
});

for (const id of ["score", "trimStart", "trimEnd"]) {
  test(`native badInput on ${id} never claims its hidden partial value is protected`, async () => {
    const h = setup(); h.edit("Last protected note"); const before = h.store.map.get(storageKey);
    h.$(id).validity = { badInput: true }; await type(h, id, "");
    assert.equal(h.draftSession.state().protected, false); assert.equal(h.draftSession.state().status, "unavailable");
    assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryUnavailable);
    assert.equal(h.store.map.get(storageKey), before); assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
    h.$(id).validity = { badInput: false }; await type(h, id, "2");
    assert.equal(h.draftSession.state().protected, true); assert.equal(copyIn(h.store).record.form[id], "2");
  });
}

test("duration-incompatible stored markers cannot erase a dirty live form or report a successful Restore", async () => {
  const pending = draft({ markers: { rows: [{ time: 999, text: "Beyond duration" }], input: "", editing: null } });
  const h = setup({ store: storage(pending) }); h.edit("Live draft must survive");
  const before = h.store.map.get(storageKey), live = readPayload(h);
  assert.equal(await h.draftSession.restore(), false);
  assert.deepEqual(readPayload(h), live); assert.equal(h.current.dirty, true); assertBaseline(h);
  assert.equal(h.dialogs, 0); assert.equal(h.draftSession.state().canRestore, false);
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
  assert.equal(h.notices.some(([message]) => message === words.en.recoveryRestored), false);
});

test("a source disappearing during an actual catalog refresh retains preview but disables Restore", async () => {
  const h = setup({ store: storage(draft()) }), before = h.store.map.get(storageKey);
  const refreshing = h.refresh(true); h.reads.at(-1).resolve(catalog([])); assert.equal(await refreshing, true);
  assert.equal(h.current.selected, null); assert.equal(h.store.map.get(storageKey), before);
  assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryMissing);
  assert.equal(h.draftSession.state().canRestore, false);
  assert.ok(h.$("restoreDraft").hidden || h.$("restoreDraft").disabled, "missing-source Restore must not remain visibly enabled");
  assert.equal(await h.draftSession.restore(), false); assert.equal(h.writes.length, 0);
});

test("saving another selected clip cannot clear the pending copy belonging to its source", async () => {
  const h = setup({ store: storage(draft()), currentKey: B }), before = h.store.map.get(storageKey);
  h.edit("Save draft B"); const saving = h.save(); assert.equal(h.writes[0].payload.key, B);
  h.writes[0].resolve({ review: savedReview({ version: 4, note: "Save draft B" }) }); await tick();
  h.reads.at(-1).reject(new Error("catalog offline")); await saving;
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.draftSession.state().owned, false);
  assert.equal(h.current.dirty, false); assert.equal(h.current.selected.key, B); assert.equal(h.writes.length, 1);
});

test("saving without restoring a same-item pending copy must not claim or clear it", async () => {
  const h = setup({ store: storage(draft()) }), before = h.store.map.get(storageKey);
  h.edit("New live draft I chose to save"); const saving = h.save();
  h.writes[0].resolve({ review: savedReview({ version: 4, note: "New live draft I chose to save" }) }); await tick();
  h.reads.at(-1).reject(new Error("catalog offline")); await saving;
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.draftSession.state().canRestore, false);
  assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryStale); assert.equal(h.writes.length, 1);
});

test("a pending copy is retained when a new history draft is loaded without restoring it", async () => {
  const h = setup({ store: storage(draft()) }), before = h.store.map.get(storageKey); h.$("historyPanel").open = true;
  assert.equal(await h.loadHistoryDraft(oldReview(), h.context()), true);
  assert.equal(h.$("note").value, oldReview().note); assert.equal(h.current.dirty, true);
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.draftSession.state().protected, false);
  assert.equal(h.draftSession.state().owned, false); assert.equal(h.writes.length, 0);
});

test("a newer selection intent invalidates an outstanding Restore confirmation before any destructive reset", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Current live work");
  const pending = restore(h), before = readPayload(h), stored = h.store.map.get(storageKey);
  await h.select(h.current.state.items[1]); assert.equal(h.dialogs, 1);
  h.answerDiscard(true); await pending;
  assert.deepEqual(readPayload(h), before); assert.equal(h.current.selected.key, A); assert.equal(h.current.dirty, true);
  assert.equal(h.store.map.get(storageKey), stored); assert.equal(h.draftSession.state().owned, false); assert.equal(h.writes.length, 0);
});

test("a repeated Restore click while confirmation is pending cannot apply twice or open two dialogs", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Current live work");
  const pending = restore(h); assert.equal(await h.draftSession.restore(), false); assert.equal(h.dialogs, 1);
  h.answerDiscard(true); await pending;
  assert.equal(h.$("note").value, draft().form.note); assert.equal(h.current.dirty, true);
  assert.equal(h.notices.filter(([message]) => message === words.en.recoveryRestored).length, 1);
  assert.equal(h.writes.length, 0);
});

test("a storage outage that recovers reveals the existing copy instead of overwriting it with newer live work", () => {
  const store = storage(draft()), before = store.map.get(storageKey); store.failRead = true;
  const h = setup({ store }); h.edit("Live draft while storage is unavailable");
  assert.equal(h.draftSession.state().status, "unavailable"); store.failRead = false; h.edit("Later live edit");
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.draftSession.state().owned, false);
  assert.equal(h.draftSession.state().canRestore, true); assert.equal(h.draftSession.state().protected, false);
  assert.equal(h.$("note").value, "Later live edit"); assert.equal(h.writes.length, 0);
});

test("a source duration changing during Restore confirmation leaves the dirty form and stored copy untouched", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Live draft before duration changed");
  const pending = restore(h), before = readPayload(h), stored = h.store.map.get(storageKey);
  assert.equal(h.dialogs, 1); h.current.selected.quality.duration = 1; h.answerDiscard(true); await pending;
  assert.deepEqual(readPayload(h), before); assert.equal(h.current.dirty, true); assertBaseline(h);
  assert.equal(h.store.map.get(storageKey), stored); assert.equal(h.draftSession.state().canRestore, false);
  assert.equal(h.notices.some(([message]) => message === words.en.recoveryRestored), false); assert.equal(h.writes.length, 0);
});

test("failed marker application after accepted Restore cannot erase the already-live draft", async () => {
  const h = setup({ store: storage(draft()) }); h.edit("Live form must survive a last-step failure");
  const before = readPayload(h), stored = h.store.map.get(storageKey), pending = restore(h);
  assert.equal(h.dialogs, 1);
  // A narrow failure double at the final atomic editor boundary. All capture,
  // serialization, preflight, discard and workbench application code is real.
  const originalRestore = h.markersView.restore; let attempts = 0;
  h.markersView.restore = () => { attempts++; return false; };
  h.answerDiscard(true); await pending; h.markersView.restore = originalRestore;
  assert.equal(attempts, 1); assert.deepEqual(readPayload(h), before); assert.equal(h.current.dirty, true); assertBaseline(h);
  assert.equal(h.store.map.get(storageKey), stored); assert.equal(h.draftSession.state().owned, false);
  assert.equal(h.notices.some(([message]) => message === words.en.recoveryRestored), false); assert.equal(h.writes.length, 0);
});

test("badInput is dirty even when the browser exposes an empty value matching an empty saved field", async () => {
  for (const id of ["score", "trimStart", "trimEnd"]) {
    const baseline = savedReview({ score: null, trim_start: null, trim_end: null, markers: [] });
    const h = setup({ initial: catalog([row(A, { review: baseline })]) });
    h.$(id).validity = { badInput: true }; await type(h, id, "");
    assert.equal(h.current.dirty, true); assert.equal(h.draftSession.state().protected, false);
    assert.equal(h.draftSession.state().status, "unavailable"); assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryUnavailable);
    assert.equal(copyIn(h.store).status, "empty"); assert.equal(h.writes.length, 0); assertBaseline(h, baseline);
  }
});

for (const id of ["trimStart", "trimEnd"]) {
  test(`associated ${id} partial text retains an older owned copy when every exposed value returns to baseline`, async () => {
    const baseline = savedReview({ trim_start: null, trim_end: null });
    const h = setup({ initial: catalog([row(A, { review: baseline })]) });
    assert.equal(h.$("reviewForm").contains(h.$(id)), false);
    assert.ok(h.$("reviewForm").elements.includes(h.$(id)));
    await type(h, id, "2");
    const before = h.store.map.get(storageKey);
    assert.equal(h.draftSession.state().protected, true);
    h.$(id).validity = { badInput: true }; await type(h, id, "");
    assert.equal(h.current.dirty, true); assert.equal(h.draftSession.state().protected, false);
    assert.equal(h.draftSession.state().status, "unavailable");
    assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
    const discarding = h.discardAllowed(); assert.equal(h.dialogs, 1);
    h.answerDiscard(false); assert.equal(await discarding, false);
    assert.equal(h.current.dirty, true); assert.equal(h.store.map.get(storageKey), before);
  });
}

// Compact protection hierarchy and disclosure checks use actual handlers with
// deterministic DOM doubles. They do not measure layout or native focus.
test("compact protection keeps an ordinary first edit out of the full recovery panel", () => {
  const h = setup();
  assert.equal(h.$("draftProtection").hidden, true); assert.equal(h.$("draftRecovery").hidden, true);
  h.edit("Ordinary first edit");
  assert.equal(h.$("draftProtection").hidden, false); assert.equal(h.$("draftRecovery").hidden, true);
  assert.equal(h.$("draftProtection").open, false);
  assert.equal(h.$("draftProtectionStatus").textContent, words.en.recoveryProtectedShort);
  assert.equal(h.$("saveState").textContent, words.en.unsaved); assert.equal(h.writes.length, 0);
  assert.equal(h.$("draftRecoveryText").textContent, ""); assertBaseline(h);
});

test("compact protection appears only after the pending copy is explicitly restored", async () => {
  const h = setup({ store: storage(draft()) });
  assert.equal(h.$("draftRecovery").hidden, false); assert.equal(h.$("draftProtection").hidden, true);
  await restore(h);
  assert.equal(h.$("draftRecovery").hidden, true); assert.equal(h.$("draftProtection").hidden, false);
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(h.current.dirty, true);
  assert.equal(h.writes.length, 0); assertBaseline(h);
});

test("compact protection and saved-state live text are not rewritten for each keystroke", () => {
  const h = setup(); h.edit("First edit");
  const statusWrites = h.$("draftProtectionStatus").textWrites, saveWrites = h.$("saveState").textWrites;
  const timeWrites = h.$("draftProtectionWhen").textWrites, panelWrites = h.$("draftRecoveryText").textWrites;
  h.edit("Second edit"); h.edit("Third edit");
  assert.equal(h.$("draftProtectionStatus").textWrites, statusWrites);
  assert.equal(h.$("saveState").textWrites, saveWrites);
  assert.equal(h.$("draftRecoveryText").textWrites, panelWrites);
  assert.ok(h.$("draftProtectionWhen").textWrites > timeWrites, "timestamp stays outside live status");
  assert.equal(copyIn(h.store).record.form.note, "Third edit");
});

test("compact protection language redraw changes the label without recapturing or changing a draft", () => {
  const h = setup(); h.edit("Unchanged live draft");
  const before = h.store.map.get(storageKey); h.switchLanguage("zh");
  assert.equal(h.$("draftProtectionStatus").textContent, words.zh.recoveryProtectedShort);
  assert.equal(h.$("draftRecovery").hidden, true); assert.equal(h.store.map.get(storageKey), before);
  h.switchLanguage("en"); assert.equal(h.$("draftProtectionStatus").textContent, words.en.recoveryProtectedShort);
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("compact protection yields to an actionable error and closes its disclosure until a valid later write", () => {
  const h = setup(); h.edit("Protected first edit"); h.$("draftProtection").open = true;
  h.store.failWrite = true; h.edit("Newest unprotected edit");
  assert.equal(h.$("draftProtection").hidden, true); assert.equal(h.$("draftProtection").open, false);
  assert.equal(h.$("draftRecovery").hidden, false); assert.equal(h.$("draftRecoveryText").textContent, words.en.recoveryUnavailable);
  assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.equal(h.$("discardDraft").disabled, false);
  h.store.failWrite = false; h.edit("Later protected edit");
  assert.equal(h.$("draftProtection").hidden, false); assert.equal(h.$("draftRecovery").hidden, true);
  assert.equal(h.$("draftProtection").open, false); assert.equal(h.$("note").value, "Later protected edit");
});

test("compact protection never substitutes for a stale-copy recovery decision", () => {
  const h = setup(); h.edit("Old local draft"); const before = h.store.map.get(storageKey);
  h.changeVersion(savedReview({ version: 4 }));
  assert.equal(h.$("draftProtection").hidden, true); assert.equal(h.$("draftRecovery").hidden, false);
  assert.match(h.$("draftRecoveryText").textContent, /different saved review/);
  assert.equal(h.$("draftRecoveryPreview").hidden, false); assert.equal(h.$("restoreDraft").disabled, true);
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 0);
});

for (const source of ["compact", "pending"]) {
  test(`clearing the focused ${source} recovery action returns focus to the current note without changing edits`, async () => {
    const h = source === "compact" ? setup() : setup({ store: storage(draft()) });
    h.edit("Keep this live draft");
    const control = h.$(source === "compact" ? "clearProtectedDraft" : "discardDraft");
    control.focus(); const before = readPayload(h); await control.click();
    assert.equal(h.document.activeElement, h.$("note"));
    assert.deepEqual(h.focus.at(-1).options, { preventScroll: true });
    assert.equal(h.$("draftRecovery").hidden, true); assert.equal(h.$("draftProtection").hidden, true);
    assert.deepEqual(readPayload(h), before); assert.equal(h.current.dirty, true);
    assert.equal(copyIn(h.store).status, "empty"); assert.equal(h.writes.length, 0);
  });
}

test("clearing a focused missing-source recovery action returns focus to library search", async () => {
  const h = setup({ store: storage(draft()), initial: catalog([]) });
  h.$("discardDraft").focus(); await h.$("discardDraft").click();
  assert.equal(h.document.activeElement, h.$("search"));
  assert.deepEqual(h.focus.at(-1).options, { preventScroll: true });
  assert.equal(copyIn(h.store).status, "empty"); assert.equal(h.writes.length, 0);
});

test("failed compact Clear keeps the copy and moves its focused action to the visible error retry", async () => {
  const h = setup(); h.edit("Keep live work"); const before = h.store.map.get(storageKey);
  h.store.failClear = true; h.$("clearProtectedDraft").focus(); await h.$("clearProtectedDraft").click();
  assert.equal(h.$("draftProtection").hidden, true); assert.equal(h.$("draftRecovery").hidden, false);
  assert.equal(h.document.activeElement, h.$("discardDraft")); assert.equal(h.$("discardDraft").disabled, false);
  assert.equal(h.store.map.get(storageKey), before); assert.equal(h.notices.length, 0);
  h.store.failClear = false; await h.$("discardDraft").click();
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(copyIn(h.store).status, "empty");
  assert.equal(h.$("note").value, "Keep live work"); assert.equal(h.current.dirty, true);
});

test("failed full-panel Clear leaves focus on its still-visible action", async () => {
  const h = setup({ store: storage(draft()) }), before = h.store.map.get(storageKey);
  h.store.failClear = true; h.$("discardDraft").focus(); const focusCount = h.focus.length;
  await h.$("discardDraft").click();
  assert.equal(h.document.activeElement, h.$("discardDraft")); assert.equal(h.focus.length, focusCount);
  assert.equal(h.$("draftRecovery").hidden, false); assert.equal(h.store.map.get(storageKey), before);
});

test("recovery Clear does not move an unrelated or newer focus intent", async () => {
  for (const source of ["compact", "pending"]) {
    const h = source === "compact" ? setup() : setup({ store: storage(draft()) }); h.edit("Keep edit");
    const control = h.$(source === "compact" ? "clearProtectedDraft" : "discardDraft");
    h.$("search").focus(); const count = h.focus.length; await control.click();
    assert.equal(h.document.activeElement, h.$("search")); assert.equal(h.focus.length, count);
    assert.equal(copyIn(h.store).status, "empty");
  }
  const h = setup(); h.edit("Keep edit"); h.$("clearProtectedDraft").focus();
  const remove = h.store.removeItem;
  h.store.removeItem = function(key) { remove.call(this, key); h.$("search").focus(); };
  await h.$("clearProtectedDraft").click(); assert.equal(h.document.activeElement, h.$("search"));
  assert.equal(copyIn(h.store).status, "empty");
});

test("compact Clear is disabled while saving and cannot remove its pending owned copy", async () => {
  const h = setup(); h.edit("Pending write"); const before = h.store.map.get(storageKey);
  h.setBusy(true); assert.equal(h.$("clearProtectedDraft").disabled, true);
  await h.$("clearProtectedDraft").click(); assert.equal(h.store.map.get(storageKey), before);
  assert.equal(h.current.busy, true); assert.equal(h.writes.length, 0);
  h.setBusy(false); assert.equal(h.$("clearProtectedDraft").disabled, false);
});

test("compact disclosure Escape closes it and returns focus without modifying storage or editor", async () => {
  const h = setup(); h.edit("Live draft"); h.$("draftProtection").open = true; h.$("clearProtectedDraft").focus();
  const before = h.store.map.get(storageKey), live = readPayload(h); let prevented = 0, stopped = 0;
  await h.$("draftProtection").emit("keydown", { key: "Escape", preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(h.$("draftProtection").open, false); assert.equal(h.document.activeElement, h.$("draftProtectionSummary"));
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  assert.equal(h.store.map.get(storageKey), before); assert.deepEqual(readPayload(h), live); assert.equal(h.writes.length, 0);
});

for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
  test(`compact disclosure respects composing Escape ${JSON.stringify(composition)}`, async () => {
    const h = setup(); h.edit("Live draft"); h.$("draftProtection").open = true; h.$("clearProtectedDraft").focus();
    await h.$("draftProtection").emit("keydown", { key: "Escape", ...composition,
      preventDefault() { assert.fail("composition must keep Escape"); }, stopPropagation() { assert.fail("composition must propagate"); } });
    assert.equal(h.$("draftProtection").open, true); assert.equal(h.document.activeElement, h.$("clearProtectedDraft"));
  });
}

test("compact disclosure outside click and tab-out dismiss without stealing focus", async () => {
  const h = setup(); h.edit("Live draft"); h.$("draftProtection").open = true;
  h.clickDocument(h.$("draftProtectionStatus")); assert.equal(h.$("draftProtection").open, true);
  h.$("note").focus(); const count = h.focus.length;
  h.clickDocument(h.$("note")); assert.equal(h.$("draftProtection").open, false); assert.equal(h.focus.length, count);
  h.$("draftProtection").open = true;
  await h.$("draftProtection").emit("focusout", { relatedTarget: h.$("clearProtectedDraft") });
  assert.equal(h.$("draftProtection").open, true);
  await h.$("draftProtection").emit("focusout", { relatedTarget: h.$("note") });
  assert.equal(h.$("draftProtection").open, false); assert.equal(h.document.activeElement, h.$("note"));
  assert.equal(h.focus.length, count); assert.equal(h.writes.length, 0);
});

test("compact disclosure closes when the draft returns to saved content without manufacturing a write", () => {
  const h = setup(); h.edit("Temporary edit"); h.$("draftProtection").open = true;
  h.edit(savedReview().note);
  assert.equal(h.$("draftProtection").hidden, true); assert.equal(h.$("draftProtection").open, false);
  assert.equal(h.$("draftProtectionStatus").textContent, ""); assert.equal(h.$("draftRecovery").hidden, true);
  assert.equal(copyIn(h.store).status, "empty"); assert.equal(h.writes.length, 0); assert.equal(h.current.dirty, false);
});

test("compact protection markup stays inside the existing review header with native non-submitting controls", () => {
  const html = readFileSync(new URL("../src/audio_review_desk/static/workbench.html", import.meta.url), "utf8");
  const form = html.slice(html.indexOf('<form id="reviewForm"'), html.indexOf('</form>', html.indexOf('<form id="reviewForm"')));
  assert.match(form, /class="section-heading review-heading"/);
  assert.match(form, /<details id="draftProtection"[^>]* hidden>/);
  assert.ok(form.indexOf('id="draftProtection"') < form.indexOf('class="decisions"'));
  assert.match(form, /<summary id="draftProtectionSummary" aria-describedby="draftProtectionDescription">/);
  assert.match(form, /<button id="clearProtectedDraft" type="button"/);
  assert.match(form, /data-t="recoveryProtected"/); assert.match(form, /data-t="recoveryScope"/);
  assert.match(form, /<time id="draftProtectionWhen"><\/time>/);
  assert.ok(!form.includes('id="draftRecovery"'), "missing-source recovery remains outside the selected-detail form");
  const css = readFileSync(new URL("../src/audio_review_desk/static/workbench-studio.css", import.meta.url), "utf8");
  assert.match(css, /\.review-heading\s*\{[^}]*min-height:\s*28px/);
  assert.match(css, /\.draft-protection-popover\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /width:\s*min\(280px, calc\(100vw - 56px\)\)/);
});

for (const id of ["draftProtectionSummary", "clearProtectedDraft"]) {
  test(`keyboard-equivalent Save from ${id} restores a stable editor target after the disclosure disappears`, async () => {
    const h = setup(); h.edit("Draft to save"); h.$("draftProtection").open = true; h.$(id).focus();
    const saving = h.save();
    h.writes[0].resolve({ review: savedReview({ version: 4, note: "Draft to save" }) }); await tick();
    assert.equal(h.$("draftProtection").hidden, true);
    h.reads.at(-1).reject(new Error("catalog offline")); await saving;
    assert.equal(h.document.activeElement, h.$("note"));
    assert.deepEqual(h.focus.at(-1).options, { preventScroll: true });
    assert.equal(h.current.dirty, false); assert.equal(copyIn(h.store).status, "empty");
    assert.equal(h.writes.length, 1);
  });
  test(`failed Save from ${id} preserves its still-visible disclosure and focus`, async () => {
    const h = setup(); h.edit("Draft to keep"); h.$("draftProtection").open = true; h.$(id).focus();
    const before = h.store.map.get(storageKey), saving = h.save();
    h.writes[0].reject(new Error("offline")); await saving;
    assert.equal(h.$("draftProtection").hidden, false); assert.equal(h.$("draftProtection").open, true);
    assert.equal(h.document.activeElement, h.$(id)); assert.equal(h.current.dirty, true);
    assert.equal(h.store.map.get(storageKey), before); assert.equal(h.writes.length, 1);
  });
  test(`Save from ${id} never steals newer focus even when that newer target later blurs`, async () => {
    const h = setup(); h.edit("Draft to save"); h.$("draftProtection").open = true; h.$(id).focus();
    const saving = h.save(); h.$("search").focus(); h.document.activeElement = h.document.body;
    const focuses = h.focus.length;
    h.writes[0].resolve({ review: savedReview({ version: 4, note: "Draft to save" }) }); await tick();
    h.reads.at(-1).reject(new Error("catalog offline")); await saving;
    assert.equal(h.document.activeElement, h.document.body); assert.equal(h.focus.length, focuses);
    assert.equal(h.current.dirty, false); assert.equal(h.writes.length, 1);
  });
}

// Native maxlength and IME display are not emulated here. These checks execute
// real note validation, events, recovery, marker flush and Save with DOM doubles.
const unicodeNoteCases = [
  ["BMP", "声".repeat(4000)],
  ["supplementary", "🎧".repeat(4000)],
  ["mixed", "a声🎧".repeat(1333) + "z"],
  ["combining", "e\u0301".repeat(2000)],
  ["ZWJ", "👩‍👩‍👧‍👦".repeat(571) + "abc"],
];
for (const [kind, text] of unicodeNoteCases) for (const extra of ["", "x"]) test(`note ${kind} ${extra ? 4001 : 4000} codepoints: exact text and Save boundary`, async () => {
  const h = setup(), note = text + extra; assert.equal([...note].length, extra ? 4001 : 4000);
  // Programmatic assignment deliberately emits no input event.
  h.$("note").value = note; h.$("markerText").value = "Pending marker";
  const snapshot = h.markersView.snapshot(); let flushes = 0;
  const flush = h.markersView.flush; h.markersView.flush = () => { flushes++; return flush(); };
  const saving = h.save(false);
  if (extra) {
    await saving; assert.equal(h.writes.length, 0); assert.equal(flushes, 0);
    assert.deepEqual(h.markersView.snapshot(), snapshot); assert.equal(h.$("note").validationMessage, words.en.noteTooLong);
    assert.equal(h.current.busy, false);
  } else {
    assert.equal(h.writes.length, 1); assert.equal(flushes, 1); assert.equal(h.writes[0].payload.note, note);
    assert.equal(h.$("note").validationMessage, ""); h.writes[0].reject(new Error("controlled failure")); await saving;
  }
  assert.equal(h.$("note").value, note);
});
test("oversize note validation updates during IME without submitting or interrupting input", async () => {
  const h = setup(), input = h.$("note"); let reports = 0;
  const report = h.$("reviewForm").reportValidity.bind(h.$("reviewForm")); h.$("reviewForm").reportValidity = () => { reports++; return report(); };
  input.focus(); await input.emit("compositionstart"); input.value = "声".repeat(4001);
  await input.emit("input", { isComposing: true });
  assert.equal(input.validationMessage, words.en.noteTooLong); assert.equal(h.writes.length, 0); assert.equal(reports, 0);
  assert.equal(h.document.activeElement, input); assert.equal(input.value.length, 4001);
  input.value = "🎧".repeat(4000); await input.emit("compositionend");
  assert.equal(input.validationMessage, ""); assert.equal(input.getAttribute("aria-invalid"), "false");
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0); assert.equal(reports, 0);
});
test("note validity rewords through actual translation and clears on corrected input", async () => {
  const h = setup(); await type(h, "note", "声".repeat(4001));
  assert.equal(h.$("note").validationMessage, words.en.noteTooLong);
  h.switchLanguage("zh"); assert.equal(h.$("note").validationMessage, words.zh.noteTooLong);
  assert.equal(h.$("note").value, "声".repeat(4001));
  await type(h, "note", "Corrected"); assert.equal(h.$("note").validationMessage, "");
  h.switchLanguage("en"); assert.equal(h.$("note").validationMessage, ""); assert.equal(h.writes.length, 0);
});
test("reload restore without input clears stale validity and keeps long valid Unicode", async () => {
  const note = "🎧".repeat(4000), record = draft(); record.form.note = note;
  const h = setup({ store: storage(record) }); h.$("note").setCustomValidity("Stale error");
  await restore(h); assert.equal(h.$("note").value, note); assert.equal(h.$("note").validationMessage, "");
  assert.equal(h.$("note").getAttribute("aria-invalid"), "false"); assert.equal(h.writes.length, 0);
});
test("switching clips after explicit discard clears the prior note error", async () => {
  const second = row(B, { decoded: false, review: savedReview({ score: null, trim_start: null, trim_end: null, markers: [], note: "Other clip" }) });
  const h = setup({ initial: catalog([row(), second]) }); await type(h, "note", "x".repeat(4001));
  const selecting = h.select(second); h.answerDiscard(true); await selecting;
  assert.equal(h.current.selected.key, B); assert.equal(h.$("note").value, "Other clip");
  assert.equal(h.$("note").validationMessage, ""); assert.equal(h.writes.length, 0);
});
test("native note ceiling accommodates every supported 4000-codepoint value", () => {
  const html = readFileSync(new URL("../src/audio_review_desk/static/workbench.html", import.meta.url), "utf8");
  assert.match(html, /id="note"\s+rows="3"\s+maxlength="8000"/);
  for (const [, note] of unicodeNoteCases) assert.ok(note.length <= 8000);
  // Counting is not grapheme segmentation or a promise that malformed Unicode
  // can be persisted: JSON/Python/SQLite have their own encoding boundary.
  assert.equal([..."e\u0301"].length, 2); assert.equal([..."👩‍👩‍👧‍👦"].length, 7);
  assert.equal([..."\ud800"].length, 1); assert.equal(JSON.stringify("\ud800"), '"\\ud800"');
});
test("busy and no-selection Save exits do not validate or flush note drafts", async () => {
  for (const boot of [false, true]) {
    const h = setup({ boot }); if (!boot) h.setBusy(true);
    let validates = 0, flushes = 0; h.$("note").setCustomValidity = () => { validates++; };
    h.markersView.flush = () => { flushes++; return true; };
    await h.save(false); assert.equal(validates, 0); assert.equal(flushes, 0); assert.equal(h.writes.length, 0);
  }
});

for(const raw of ['\u0085','\u001c',' ','\t\n'])test(`raw blank marker survives Save, reload and cancelled navigation: ${JSON.stringify(raw)}`,async()=>{
 const h=setup();await type(h,'markerText',raw);
 assert.equal(h.current.dirty,true);assert.equal(h.beforeUnload(),true);
 const before=h.markersView.snapshot();await h.save(false);assert.equal(h.writes.length,0);assert.deepEqual(h.markersView.snapshot(),before);
 const navigating=h.select(h.current.state.items[1]);assert.equal(h.dialogs,1);h.answerDiscard(false);await navigating;
 assert.equal(h.current.selected.key,A);assert.equal(h.$('markerText').value,raw);
 const resumed=setup({store:h.store});await restore(resumed);
 assert.equal(resumed.$('markerText').value,raw);assert.equal(resumed.current.dirty,true);assert.equal(resumed.beforeUnload(),true);
 await type(resumed,'markerText','');assert.equal(resumed.current.dirty,false);assert.equal(resumed.beforeUnload(),false);
});
for(const raw of ['\u0085','\u001c',' ','\t\n'])test(`undecodable clip rejects raw marker restore without deleting backup: ${JSON.stringify(raw)}`,async()=>{
 const record=draft();record.form={status:'fix',score:'',trimStart:'',trimEnd:'',issues:[],note:'Draft'};
 record.markers={rows:[],input:raw,editing:null};
 const h=setup({store:storage(record),initial:catalog([row(A,{decoded:false})])}),before=h.store.map.get(storageKey);
 assert.equal(h.draftSession.state().canRestore,false);assert.equal(await h.draftSession.restore(),false);
 assert.equal(h.store.map.get(storageKey),before);assert.equal(h.writes.length,0);assert.equal(h.current.dirty,false);
});
for(const kind of ['blank','long','full'])test(`Save preflights pending ${kind} before flushing the inline editor`,async()=>{
 const markers=kind==='full'?Array.from({length:100},(_,i)=>({time:i/10,text:'Marker '+i})):[{time:1,text:'Existing'}];
 const h=setup({initial:catalog([row(A,{review:savedReview({markers})})])});
 await h.$('markerList').querySelector('.marker-note').click();
 const field=h.$('markerList').querySelector('.marker-edit-text');field.value='Unapplied edit';await field.emit('input');
 await type(h,'markerText',kind==='blank'?'\u0085':kind==='long'?'a'.repeat(241):'New note');
 const before=h.markersView.snapshot();await h.save(false);
 assert.equal(h.writes.length,0);assert.deepEqual(h.markersView.snapshot(),before);assert.equal(h.current.dirty,true);assert.equal(h.beforeUnload(),true);
});
for(const language of ['en','zh'])test(`blank marker errors use current language and keep drafts (${language})`,async()=>{
 const h=setup({language});await type(h,'markerText','\u0085');await h.save(false);
 assert.equal(h.notices.at(-1)[0],words[language].markerBlankPending);
 const other=language==='en'?'zh':'en';h.switchLanguage(other);await h.save(false);
 assert.equal(h.notices.at(-1)[0],words[other].markerBlankPending);assert.equal(h.$('markerText').value,'\u0085');
 await type(h,'markerText','');await h.$('markerList').querySelector('.marker-note').click();
 const field=h.$('markerList').querySelector('.marker-edit-text');field.value='\u001c';await field.emit('input');await h.save(false);
 assert.equal(h.notices.at(-1)[0],words[other].markerBlankEdit);assert.equal(field.value,'\u001c');assert.equal(h.writes.length,0);
});
test('explicit discard alone permits leaving a raw blank pending marker',async()=>{
 const second=row(B,{decoded:false,review:savedReview({score:null,markers:[],trim_start:null,trim_end:null})});
 const h=setup({initial:catalog([row(),second])});await type(h,'markerText','\u0085');const navigation=h.select(second);
 assert.equal(h.dialogs,1);assert.equal(h.$('markerText').value,'\u0085');h.answerDiscard(true);await navigation;
 assert.equal(h.current.selected.key,B);assert.equal(h.$('markerText').value,'');assert.equal(h.current.dirty,false);
});

// Exercise real marker events -> markDirty -> export scope. No direct dirty
// assignments or marker-state substitutes; DOM/network remain controlled doubles.
for (const language of ["en", "zh"]) {
  test(`export scope follows pending marker input, rejected whitespace and clearing (${language})`, async () => {
    const h = setup({ language }), scope = h.$("exportScope"), baseline = h.markersView.snapshot();
    assert.equal(scope.textContent, words[language].exportScopeSaved);
    await type(h, "markerText", "Pending note");
    assert.equal(scope.textContent, words[language].exportScopeDraft);
    assert.equal(h.markersView.snapshot().input, "Pending note");
    const other = language === "en" ? "zh" : "en";
    h.switchLanguage(other);
    assert.equal(scope.textContent, words[other].exportScopeDraft);
    assert.equal(h.markersView.snapshot().input, "Pending note");
    await type(h, "markerText", "");
    assert.equal(scope.textContent, words[other].exportScopeSaved);
    for (const raw of ["   ", "\u0085"]) {
      await type(h, "markerText", raw);
      assert.equal(scope.textContent, words[other].exportScopeDraft);
      const before = h.markersView.snapshot();
      await h.save(false);
      assert.deepEqual(h.markersView.snapshot(), before);
      assert.equal(scope.textContent, words[other].exportScopeDraft);
      assert.equal(h.writes.length, 0);
      await type(h, "markerText", "");
      assert.equal(scope.textContent, words[other].exportScopeSaved);
    }
    assert.deepEqual(h.markersView.snapshot(), baseline);
    assert.equal(h.writes.length, 0);
  });
  test(`export scope follows actual inline cancel and marker add/delete (${language})`, async () => {
    const h = setup({ language }), scope = h.$("exportScope"), baseline = h.markersView.snapshot();
    await h.$("markerList").querySelector(".marker-note").click();
    assert.equal(scope.textContent, words[language].exportScopeSaved);
    const field = h.$("markerList").querySelector(".marker-edit-text");
    field.value = "Changed"; await field.emit("input");
    assert.equal(scope.textContent, words[language].exportScopeDraft);
    assert.equal(h.markersView.snapshot().editing.text, "Changed");
    await h.$("markerList").querySelector(".marker-edit-actions").children
      .find(node => node.textContent === words[language].cancel).click();
    assert.equal(scope.textContent, words[language].exportScopeSaved);
    assert.deepEqual(h.markersView.snapshot(), baseline);
    await type(h, "markerText", "New"); await h.$("addMarker").click();
    assert.equal(h.$("markerText").value, "");
    assert.ok(h.markersView.get().some(row => row.text === "New"));
    assert.equal(scope.textContent, words[language].exportScopeDraft);
    await h.$("markerList").children.find(node => node.querySelector(".marker-note")?.textContent === "New")
      .querySelector(".marker-remove").click();
    assert.equal(scope.textContent, words[language].exportScopeSaved);
    assert.deepEqual(h.markersView.snapshot(), baseline);
    assert.equal(h.writes.length, 0);
  });
}
