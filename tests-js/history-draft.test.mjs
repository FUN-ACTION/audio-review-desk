import { stripMarkerText } from "../src/audio_review_desk/static/marker-text.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountMarkers } from "../src/audio_review_desk/static/markers.js";
import { formatTime, reviewPayload, sameReview } from "../src/audio_review_desk/static/ui.js";
import { words } from "../src/audio_review_desk/static/copy.js";

// Execute the actual workbench draft, form, history, and Save functions. Small
// DOM doubles make ownership races deterministic; this is not browser QA.
const source = readFileSync(process.env.ARD_HISTORY_DRAFT_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Source boundary missing: ${start} / ${end}`);
  return source.slice(a, b);
};
const code = [
  extract("let discardResolver =", "function translate()"),
  extract("function draftValues()", "function range()"),
  extract("function renderDetails(", "async function select(item"),
  extract("let refreshLoadError =", "async function refresh("),
  extract("function setBusy(value)", "function showCompletion("),
  extract("function invalidateHistory()", '$("reviewForm").addEventListener("input"'),
].join("\n");
const issueNames = ["cut_start", "cut_end", "noise", "reverb", "backing_voice", "instrument", "lyrics", "distortion", "identity", "other"];
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const savedReview = (patch = {}) => ({ version: 3, status: "fix", score: 8, trim_start: 1, trim_end: 9,
  issues: ["noise"], note: "Current saved review", markers: [{ time: 2, text: "Current marker" }],
  updated_utc: "2026-11-03T20:00:00Z", origin: "ui", ...patch });
const oldReview = (patch = {}) => savedReview({ version: 1, status: "pass", score: 0,
  trim_start: 0, trim_end: null, issues: ["cut_start", "other"], note: "Earlier\nreview note",
  markers: [{ time: 0, text: "Opening" }, { time: 1.234567, text: "Precise marker" }], ...patch });
const row = (key = "A", { decoded = true, review = savedReview() } = {}) => ({ key, label: `Clip ${key}`, eligible: decoded,
  source_id: `source-${key}`, source_start: 0, source_end: 10,
  quality: { decoded, duration: 10, flags: [], sample_rate: 48000, channels: 1,
    rms_dbfs: -20, peak: 0.5, leading_quiet_seconds: 0, trailing_quiet_seconds: 0 }, review });

function setup({ decoded = true, language = "en", review = savedReview() } = {}) {
  const nodes = new Map(), reads = [], writes = [], notices = [], focus = [], docListeners = new Map();
  let dialogs = 0, auditionCancellations = 0;
  const document = { activeElement: null, body: null,
    addEventListener(type, callback) { docListeners.set(type, [...(docListeners.get(type) || []), callback]); },
    removeEventListener(type, callback) { docListeners.set(type, (docListeners.get(type) || []).filter(fn => fn !== callback)); },
  };
  class Element {
    constructor(tagName = "div", id = "") {
      this.tagName = tagName.toUpperCase(); this.id = id; this.children = []; this.parentElement = null;
      this._text = ""; this._value = ""; this.className = ""; this.disabled = false; this.checked = false;
      this.hidden = false; this.open = false; this.isConnected = true; this.style = {}; this.dataset = {};
      this.attributes = new Map(); this.listeners = new Map(); this.elements = []; this.validationMessage = "";
      this.classList = { add: name => { this.className += ` ${name}`; },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, enabled) => { const names = new Set(this.className.split(/\s+/).filter(Boolean));
          const on = enabled ?? !names.has(name); on ? names.add(name) : names.delete(name); this.className = [...names].join(" "); return on; } };
    }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    get textContent() { return this._text + this.children.map(node => node.textContent || "").join("\n"); }
    set textContent(value) { this._text = String(value); this.children = []; }
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
    replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== fn)); }
    async emit(type, event = {}) { for (const callback of this.listeners.get(type) || []) await callback({ target: this, preventDefault() {}, ...event }); }
    focus(options) { document.activeElement = this; focus.push({ id: this.id, options }); }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { return !this.querySelector(":invalid"); }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    closest(selector) { if (selector.startsWith(".") && this.classList.contains(selector.slice(1))) return this; return this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const all = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
      return all.filter(node => selector === "*" || selector === "input" && node.tagName === "INPUT"
        || selector === "input:checked" && node.tagName === "INPUT" && node.checked
        || selector === "button" && node.tagName === "BUTTON"
        || selector === ":invalid" && node.validationMessage
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
  $("reviewForm").append(...decisions, $("score"), $("trimStart"), $("trimEnd"), $("note"), $("issues"), $("markerList"));
  $("reviewForm").elements = [...decisions, $("score"), $("trimStart"), $("trimEnd"), $("note"), ...issues];
  $("historyPanel").open = true;
  globalThis.document = document;
  const initial = { workspace_id: "history-draft", items: [row("A", { decoded, review }), row("B")], stats: { review_counts: { pending: 1 } } };
  const noop = () => {};
  const env = { stripMarkerText, renderExportScope: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    $, document, initial, issueNames, mountMarkers, reviewPayload, sameReview, formatTime, language,
    t: key => words[language][key] || key,
    precise: value => `${formatTime(value)}.${Math.floor(((value || 0) % 1) * 1000).toString().padStart(3, "0")}`,
    request: path => { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => notices.push(args), errorText: error => error.message,
    openDialog: () => { dialogs++; }, audition: { cancel: () => { auditionCancellations++; } },
    renderSummary: noop, renderQueue: noop, drawWave: noop, syncGlider: noop, updateTime: noop, renderWaveStatus: noop,
    spectrumView: { setVisible: noop }, waveformView: { cancelDrag() {} }, media: { currentTime: 0 }, player: { currentTime: 0, readyState: 4 }, quietRange: () => null,
    continueQueue: () => null, select: noop, showCompletion: noop,
  };
  const control = Function(...Object.keys(env), `
    let noticeResolver = null;let noticeGeneration = 0;
    function notice(message = '', ...args) {
      noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null;
      if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice();
    }

    let state = initial, selected = state.items[0], dirty = false, busy = false, generation = 0,
      historyGeneration = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      suspendedCompletion = null, visibleCache = null, variant = 'a', spectrumVisible = false;
    const savedThisSession = new Set();
    function visibleItems() { return state.items; }
    const markersView = mountMarkers({ input: $('markerInput'), add: $('markerAdd'), list: $('markerList'),
      ticks: $('markerTicks'), player, duration: () => selected.quality.duration,
      t, onChange: () => markDirty(), onError: notice });
    ${code}
    renderDetails();
    return { loadHistory,
      // A pre-feature checkout has no load action. Model that absence as a
      // no-op so negative controls fail behavior assertions, not setup errors.
      loadHistoryDraft: typeof loadHistoryDraft === 'function' ? loadHistoryDraft : async () => false,
      save, setBusy, markDirty, renderDetails, invalidateHistory, invalidateRefresh,
      draftValues, markersView,
      context() { return { key: selected.key, selectionTurn: generation, version: selected.review.version, historyTurn: historyGeneration }; },
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; if (resolve) resolve(allowed); },
      changeSelection(item) { selected = item; generation++; invalidateHistory(); invalidateRefresh(); dirty = false; renderDetails(); },
      changeVersion(next) { selected.review = next; },
      get current() { return { state, selected, dirty, busy, generation, historyGeneration, refreshGeneration }; }
    };
  `)(...Object.values(env));
  return { ...control, get current() { return control.current; }, $, document, decisions, issues, reads, writes, notices, focus,
    get dialogs() { return dialogs; }, get auditionCancellations() { return auditionCancellations; } };
}
const load = (h, review = oldReview(), context = h.context()) => h.loadHistoryDraft(review, context);
const history = async (h, rows) => { const pending = h.loadHistory(); h.reads.at(-1).resolve({ history: rows }); await pending; return h.$("history").children; };

function assertCurrentPreserved(h, selected, snapshot) {
  assert.equal(h.current.selected, selected);
  assert.deepEqual(selected.review, snapshot);
  assert.deepEqual(h.current.state.items.find(row => row.key === selected.key).review, snapshot);
}

test("loading an older history version creates only a local draft and preserves the committed baseline", async () => {
  const h = setup(), selected = h.current.selected, before = structuredClone(selected.review), older = oldReview();
  assert.equal(await load(h, older), true);
  assertCurrentPreserved(h, selected, before);
  assert.deepEqual(h.draftValues(), { status: "pass", score: "0", trimStart: "0", trimEnd: "", issues: ["cut_start", "other"],
    note: "Earlier\nreview note", markers: [{ time: 0, text: "Opening" }, { time: 1.234567, text: "Precise marker" }] });
  assert.equal(h.current.dirty, true); assert.equal(h.$("saveState").textContent, words.en.unsaved);
  assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0);
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(h.auditionCancellations, 1);
  assert.match(h.notices.at(-1)[0], /v1/); assert.match(h.notices.at(-1)[0], /unsaved/i); assert.match(h.notices.at(-1)[0], /save/i);
});

test("null fields clear previous form values without treating zero as empty", async () => {
  const h = setup();
  await load(h, oldReview({ score: null, trim_start: null, trim_end: null, issues: [], note: "", markers: [] }));
  assert.equal(h.$("score").value, ""); assert.equal(h.$("trimStart").value, ""); assert.equal(h.$("trimEnd").value, "");
  assert.equal(h.$("note").value, ""); assert.deepEqual(h.draftValues().issues, []); assert.deepEqual(h.markersView.get(), []);
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("history markers, draft markers and the saved review remain independent", async () => {
  const h = setup(), older = oldReview(), before = structuredClone(h.current.selected.review);
  await load(h, older);
  older.markers[0].text = "Mutated source"; older.issues.push("noise");
  assert.equal(h.markersView.get()[0].text, "Opening"); assert.deepEqual(h.draftValues().issues, ["cut_start", "other"]);
  const exported = h.markersView.get(); exported[0].time = 9;
  assert.equal(h.markersView.get()[0].time, 0);
  await h.$("markerList").querySelector(".marker-remove").emit("click");
  assert.equal(older.markers.length, 2); assert.deepEqual(h.current.selected.review, before);
  assert.equal(h.markersView.get().length, 1);
});

test("valid imported Unicode notes and markers load without UTF-16 length rejection or truncation", async () => {
  for (const [noteLength, markerLength] of [[2500, 150], [4000, 240]]) {
    const h = setup(), note = "😀".repeat(noteLength), text = "🎧".repeat(markerLength);
    const older = oldReview({ note, markers: [{ time: 0, text }] });
    assert.equal(await load(h, older), true);
    assert.equal(h.$("note").value, note); assert.equal(h.markersView.get()[0].text, text);
    assert.equal(h.current.selected.review.version, 3); assert.equal(h.current.dirty, true);
    assert.equal(h.writes.length, 0);
  }
});

test("explicit Save uses the current version and loaded values, then appends the returned revision", async () => {
  const h = setup(), older = oldReview(); await load(h, older); h.$("historyPanel").open = false;
  const saving = h.save();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].path, "/api/review");
  assert.deepEqual(h.writes[0].payload, { key: "A", expected_version: 3, status: "pass", score: 0,
    trim_start: 0, trim_end: null, issues: ["cut_start", "other"], note: older.note, markers: older.markers });
  const committed = { ...older, version: 4 };
  h.writes[0].resolve({ review: committed }); await tick();
  assert.equal(h.reads[0].path, "/api/state"); h.reads[0].reject(new Error("catalog offline")); await saving;
  assert.equal(h.current.selected.review.version, 4); assert.equal(h.current.dirty, false);
  assert.equal(older.version, 1); assert.equal(h.writes.length, 1);
});

for (const message of ["Another page updated this review; reload before saving", "network unavailable"]) {
  test(`failed Save retains the loaded draft and does not retry: ${message}`, async () => {
    const h = setup(), before = structuredClone(h.current.selected.review); await load(h); h.$("historyPanel").open = false;
    const saving = h.save(); h.writes[0].reject(new Error(message)); await saving;
    assert.equal(h.current.dirty, true); assert.equal(h.$("note").value, "Earlier\nreview note");
    assert.deepEqual(h.current.selected.review, before); assert.equal(h.writes.length, 1);
    assert.equal(h.notices.at(-1)[0], message);
  });
}

test("canceling discard preserves text, uncommitted marker input and existing validity errors", async () => {
  const h = setup(); h.edit("Keep this draft"); h.$("markerInput").value = "A marker not yet added";
  h.$("score").setCustomValidity("invalid score");
  const pending = load(h); assert.equal(h.dialogs, 1); h.answerDiscard(false);
  assert.equal(await pending, false); assert.equal(h.$("note").value, "Keep this draft");
  assert.equal(h.$("markerInput").value, "A marker not yet added"); assert.equal(h.$("score").validationMessage, "invalid score");
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("confirming discard replaces only the local form and clears old field validity", async () => {
  const h = setup(), before = structuredClone(h.current.selected.review); h.edit("Old draft");
  h.$("trimStart").setCustomValidity("invalid trim"); const pending = load(h); h.answerDiscard(true);
  assert.equal(await pending, true); assert.equal(h.$("note").value, "Earlier\nreview note");
  assert.equal(h.$("trimStart").validationMessage, ""); assert.deepEqual(h.current.selected.review, before);
  assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("the history snapshot is copied before waiting for discard confirmation", async () => {
  const h = setup(), older = oldReview(); h.edit("An existing draft"); const pending = load(h, older);
  older.note = "Changed after the click"; older.issues.push("noise"); older.markers[0].text = "Changed marker";
  h.answerDiscard(true); assert.equal(await pending, true);
  assert.equal(h.$("note").value, "Earlier\nreview note");
  assert.deepEqual(h.draftValues().issues, ["cut_start", "other"]); assert.equal(h.markersView.get()[0].text, "Opening");
  assert.equal(h.writes.length, 0);
});

test("a clean draft still rechecks ownership after the asynchronous discard gate", async () => {
  for (const change of ["selection", "version", "history", "edit", "busy"]) {
    const h = setup(), pending = load(h);
    if (change === "selection") h.changeSelection(row("B"));
    if (change === "version") h.changeVersion(savedReview({ version: 4 }));
    if (change === "history") h.invalidateHistory();
    if (change === "edit") h.edit("An edit in the continuation gap");
    if (change === "busy") h.setBusy(true);
    const before = h.draftValues(); assert.equal(await pending, false);
    assert.deepEqual(h.draftValues(), before); assert.equal(h.dialogs, 0); assert.equal(h.writes.length, 0);
  }
});

for (const change of ["selection", "round trip", "version", "history read", "panel close", "new edit", "save begun"]) {
  test(`a pending discard cannot erase newer state after ${change}`, async () => {
    const h = setup(), original = h.current.selected; h.edit("Original draft"); const pending = load(h);
    assert.equal(h.dialogs, 1);
    let saving;
    if (change === "selection" || change === "round trip") {
      h.changeSelection(row("B")); if (change === "round trip") h.changeSelection(original);
      h.edit("Newer selected draft");
    } else if (change === "version") { h.changeVersion(savedReview({ version: 4, note: "New save" })); h.edit("Newer version draft"); }
    else if (change === "history read") h.invalidateHistory();
    else if (change === "panel close") h.$("historyPanel").open = false;
    else if (change === "new edit") h.edit("Newer local draft");
    else { h.$("historyPanel").open = false; saving = h.save(); }
    const note = h.$("note").value, baseline = structuredClone(h.current.selected.review);
    h.answerDiscard(true); assert.equal(await pending, false);
    assert.equal(h.$("note").value, note); assert.deepEqual(h.current.selected.review, baseline);
    assert.equal(h.current.dirty, true);
    if (saving) { h.writes[0].reject(new Error("save failed")); await saving; }
  });
}

test("a completed newer Save revokes a historical draft confirmation", async () => {
  const h = setup(); h.edit("Draft being saved"); const pending = load(h); h.$("historyPanel").open = false;
  const saving = h.save(); const committed = savedReview({ version: 4, note: "Draft being saved" });
  h.writes[0].resolve({ review: committed }); await tick(); h.reads[0].reject(new Error("state offline")); await saving;
  h.edit("Edited after the newer save"); h.answerDiscard(true);
  assert.equal(await pending, false); assert.equal(h.$("note").value, "Edited after the newer save");
  assert.equal(h.current.selected.review.version, 4); assert.equal(h.current.dirty, true);
});

test("repeat loading while a discard dialog is open cannot silently replace the draft", async () => {
  const h = setup(); h.edit("Existing draft"); const first = load(h), second = load(h, oldReview({ version: 2, note: "Second choice" }));
  assert.equal(await second, false); assert.equal(h.dialogs, 1); h.answerDiscard(false); assert.equal(await first, false);
  assert.equal(h.$("note").value, "Existing draft"); assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
});

test("confirming the first repeated history choice never applies the rejected second choice", async () => {
  const h = setup(); h.edit("Existing draft"); const first = load(h), second = load(h, oldReview({ version: 2, note: "Second choice" }));
  assert.equal(await second, false); h.answerDiscard(true); assert.equal(await first, true);
  assert.equal(h.$("note").value, "Earlier\nreview note"); assert.equal(h.dialogs, 1); assert.equal(h.writes.length, 0);
});

test("current-version and identical older content are harmless no-ops", async () => {
  for (const older of [savedReview(), savedReview({ version: 1 }), oldReview({ version: 3 }), oldReview({ version: 4 })]) {
    const h = setup(); h.edit("Keep existing draft"); assert.equal(await load(h, older), false);
    assert.equal(h.dialogs, 0); assert.equal(h.$("note").value, "Keep existing draft"); assert.equal(h.current.dirty, true);
    assert.equal(h.writes.length, 0);
  }
});

test("stale history callbacks cannot target a newer selection or a newer saved version", async () => {
  for (const change of ["selection", "version", "history", "closed", "busy"]) {
    const h = setup(), context = h.context();
    if (change === "selection") h.changeSelection(row("B"));
    if (change === "version") h.changeVersion(savedReview({ version: 4 }));
    if (change === "history") h.invalidateHistory();
    if (change === "closed") h.$("historyPanel").open = false;
    if (change === "busy") h.setBusy(true);
    const before = h.draftValues(); assert.equal(await load(h, oldReview(), context), false);
    assert.deepEqual(h.draftValues(), before); assert.equal(h.dialogs, 0); assert.equal(h.writes.length, 0);
  }
});

for (const language of ["en", "zh"]) {
  test(`history cards show full values and explicit draft/Save guidance (${language})`, async () => {
    const h = setup({ language }), older = oldReview({ note: "<img src=x onerror=alert(1)>\nFull note" });
    const cards = await history(h, [older, savedReview()]);
    assert.equal(cards.length, 2); assert.match(cards[0].textContent, /^v3/); assert.match(cards[1].textContent, /^v1/);
    const text = cards[1].textContent;
    assert.ok(text.includes(`${words[language].score}: 0`));
    assert.ok(text.includes(words[language].cut_start)); assert.ok(text.includes(words[language].other));
    assert.ok(text.includes(`${words[language].range}: 0:00.000 – 0:10.000`));
    assert.ok(text.includes("<img src=x onerror=alert(1)>")); assert.ok(text.includes("Full note"));
    assert.ok(text.includes("Opening")); assert.ok(text.includes("Precise marker"));
    assert.ok(cards[0].querySelector("button"), "the current history version must expose its disabled draft action");
    assert.equal(cards[0].querySelector("button").disabled, true);
    const action = cards[1].querySelector("button"); assert.ok(action, "older history exposes a local draft action");
    assert.equal(action.type, "button"); assert.equal(action.disabled, false);
    assert.match(action.getAttribute("aria-label"), /v1/);
    await action.emit("click"); await tick(); assert.equal(h.current.dirty, true); assert.equal(h.writes.length, 0);
    assert.ok(h.notices.at(-1)[0].includes(words[language].save));
  });
}

test("a removed card's callback cannot overwrite a newer history opening", async () => {
  const h = setup(), cards = await history(h, [oldReview()]), oldButton = cards[0].querySelector("button");
  assert.ok(oldButton, "history exposes a draft action");
  await history(h, [oldReview({ version: 2, note: "A newer history read" })]);
  await oldButton.emit("click"); await tick();
  assert.equal(h.current.dirty, false); assert.equal(h.$("note").value, "Current saved review"); assert.equal(h.writes.length, 0);
});

test("history newer than the local saved baseline disables loading and asks for refresh", async () => {
  const h = setup(), sourceRows = [oldReview(), savedReview(), savedReview({ version: 4, note: "Saved in another page" })];
  const rows = await history(h, sourceRows), cards = rows.filter(node => node.classList.contains("history-entry"));
  assert.equal(cards.length, 3); assert.ok(cards.every(card => card.querySelector("button").disabled));
  assert.ok(h.$("history").textContent.includes(words.en.historyOutdated));
  assert.equal(h.current.selected.review.version, 3); assert.equal(h.current.dirty, false); assert.equal(h.writes.length, 0);
  assert.deepEqual(sourceRows.map(row => row.version), [1, 3, 4], "rendering must not reverse the source history array");
});

test("unreadable audio may load valid fix notes but never an approval, score or time markers", async () => {
  const baseline = savedReview({ status: "exclude", score: null, markers: [], trim_start: null, trim_end: null });
  const valid = oldReview({ status: "fix", score: null, markers: [], trim_start: null, trim_end: null });
  const h = setup({ decoded: false, review: baseline }); assert.equal(await load(h, valid), true);
  assert.equal(h.$("score").disabled, true); assert.equal(h.$("trimStart").disabled, true);
  assert.equal(h.decisions.find(input => input.value === "pass").disabled, true); assert.equal(h.writes.length, 0);
  for (const patch of [{ status: "pass" }, { score: 0 }, { markers: [{ time: 0, text: "Note" }] }]) {
    const invalid = setup({ decoded: false, review: baseline });
    assert.equal(await load(invalid, { ...valid, ...patch }), false);
    assert.equal(invalid.current.dirty, false); assert.equal(invalid.$("note").value, baseline.note); assert.equal(invalid.writes.length, 0);
  }
});

test("malformed saved records do not partly replace the current local draft", async () => {
  const candidates = [null, {}, oldReview({ status: "unknown" }), oldReview({ score: NaN }), oldReview({ score: 11 }),
    oldReview({ trim_start: -1 }), oldReview({ trim_end: 11 }), oldReview({ trim_start: 5, trim_end: 4 }),
    oldReview({ issues: ["unknown"] }), oldReview({ note: null }), oldReview({ markers: [{ time: Infinity, text: "Bad" }] }),
    oldReview({ markers: [{ time: 1, text: " " }] }), oldReview({ markers: false }),
    oldReview({ note: "😀".repeat(4001) }), oldReview({ markers: [{ time: 1, text: "🎧".repeat(241) }] })];
  for (const candidate of candidates) {
    const h = setup(); h.edit("Preserve current draft"); const before = h.draftValues();
    assert.equal(await load(h, candidate), false); assert.deepEqual(h.draftValues(), before);
    assert.equal(h.dialogs, 0); assert.equal(h.writes.length, 0);
  }
});

for (const route of ["inline", "pending"]) {
  for (const [label, text] of [["BMP", "声".repeat(241)], ["mixed", "a声🎵".repeat(80) + "z"],
                              ["supplementary", "🎧".repeat(241)]]) {
    test(`Save blocks 241 ${label} codepoints in ${route} notes without writes or truncation`, async () => {
      const h = setup(), before = h.markersView.get();
      let field = h.$("markerInput");
      if (route === "inline") {
        await h.$("markerList").querySelector(".marker-note").emit("click");
        field = h.$("markerList").querySelector(".marker-edit-text");
      }
      field.value = text; await field.emit("input");
      await h.save();
      assert.equal(h.writes.length, 0);
      assert.deepEqual(h.markersView.get(), before);
      assert.equal(field.value, text);
    });
  }
  test(`Save submits exact 240-codepoint ${route} notes once and retains them after a failed request`, async () => {
    const text = "🎧".repeat(240), time = 1.123456789;
    const h = setup({ review: savedReview({ markers: [{ time, text }] }) });
    if (route === "inline") await h.$("markerList").querySelector(".marker-note").emit("click");
    else { h.$("markerInput").value = text; await h.$("markerInput").emit("input"); }
    const saving = h.save();
    const expected = route === "inline" ? [{ time, text }] : [{ time: 0, text }, { time, text }];
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].payload.markers, expected);
    h.writes[0].reject(new Error("synthetic failure")); await saving;
    assert.deepEqual(h.markersView.get(), expected);
    assert.deepEqual(h.current.selected.review.markers, [{ time, text }], "failed Save preserves the committed baseline");
  });
}

test("history restore without input clears a stale note error and retains 4000 supplementary codepoints", async () => {
  const h = setup(); h.edit("x".repeat(4001));
  assert.equal(h.$("note").validationMessage, words.en.noteTooLong);
  const note = "🎧".repeat(4000), restoring = load(h, oldReview({ note }));
  h.answerDiscard(true); assert.equal(await restoring, true);
  assert.equal(h.$("note").value, note); assert.equal(h.$("note").validationMessage, "");
  assert.equal(h.$("note").getAttribute("aria-invalid"), "false"); assert.equal(h.writes.length, 0);
});
test('historical FEFF-only marker loads and saves without being stripped or rejected',async()=>{
 const h=setup(),older=oldReview({markers:[{time:1.123456789,text:'\ufeff'}]});
 assert.equal(await load(h,older),true);assert.equal(h.markersView.get()[0].text,'\ufeff');
 const saving=h.save(false);assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].payload.markers,older.markers);
 h.writes[0].reject(new Error('controlled failure'));await saving;assert.equal(h.markersView.get()[0].text,'\ufeff');
});
