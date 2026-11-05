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
  let dialogs = 0;
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
    reveal: noop, words, localStorage: { setItem: noop }, clearTimeout: noop, transport: { refresh: noop }, commandMenu: { refresh: noop }, openDialog: () => { dialogs++; },
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

    function notice(message = '', ...args) {
      noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null;
      if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice();
    }

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
      feedback: notice, saving: () => savingReview, batch, selectedKeys, savedThisSession, retryWave, undo, save, refresh, select, visibleItems, draftValues,
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      get current() { return { state, selected, dirty, busy, form: draftValues() }; }
    };`)(...Object.values(env));
  return { ...control, document, focusListeners, get current() { return control.current; }, $, reads, writes, notices, renders, histories, feedback: control.feedback, get dialogs() { return dialogs; } };
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

test("batch applies every committed review before the first unlocked render", async () => {
  const h = setup(), selected = h.current.selected, local = [...h.current.state.items], { pending } = await commit(h);
  const unlocked = h.renders.find(row => !row.busy);
  await failCatalog(h, pending);
  assert.equal(h.current.selected, selected); local.forEach((row, i) => assert.equal(h.current.state.items[i], row));
  assert.deepEqual(h.current.state.items.map(row => row.review), [committed("A"), committed("B")]);
  assert.deepEqual(unlocked.rows, [["A", "exclude", 5], ["B", "exclude", 5]]);
  assert.equal(unlocked.form.status, "exclude"); assert.equal(h.current.dirty, false); assert.equal(h.current.busy, false);
});

test("batch updates both detached selected and catalog objects without replacing them", async () => {
  const h = setup({ detached: true }), selected = h.current.selected, local = h.current.state.items[0];
  assert.notEqual(selected, local); const { pending } = await commit(h); await failCatalog(h, pending);
  assert.equal(h.current.selected, selected); assert.equal(h.current.state.items[0], local);
  assert.deepEqual(selected.review, committed()); assert.deepEqual(local.review, committed());
});

test("batch renders retained zero scores, precise trims, issues, notes and markers", async () => {
  const h = setup(), { pending } = await commit(h); await failCatalog(h, pending);
  assert.deepEqual(h.current.form, { status: "exclude", score: "0", trimStart: "0", trimEnd: "5.123456", note: "keep note", issues: ["noise"], markers: [{ time: 0.125, text: "keep marker" }] });
});

test("batch handles null scores, empty notes and untrimmed unannotated reviews", async () => {
  const empty = review({ score: null, note: "", issues: [], markers: [], trim_start: null, trim_end: null });
  const h = setup({ initial: catalog(empty) }), saved = { ...empty, status: "exclude", version: 5, origin: "batch_ui" };
  const { pending } = await commit(h, { saved: 1, reviews: [{ key: "A", review: saved }] }, ["A"]); await failCatalog(h, pending);
  assert.deepEqual(h.current.form, { status: "exclude", score: "", trimStart: "", trimEnd: "", note: "", issues: [], markers: [] });
});

test("batch invalidates cached status and search lists after committed updates", async () => {
  for (const [filter, search] of [["exclude", ""], ["all", "keep note"]]) {
    const h = setup(); h.$("filter").value = filter; h.$("search").value = search; const before = h.visibleItems();
    const { pending } = await commit(h); await failCatalog(h, pending);
    assert.notEqual(h.visibleItems(), before); assert.equal(h.visibleItems().length, 2);
  }
});

test("batch keeps a clip open when it leaves the active filter", async () => {
  const h = setup(); h.$("filter").value = "pass"; h.visibleItems();
  const { pending } = await commit(h); await failCatalog(h, pending);
  assert.deepEqual(h.visibleItems(), []); assert.equal(h.current.selected.key, "A");
  assert.equal(h.$("outsideFilter").hidden, false); assert.equal(h.$("detailPanel").hidden, false);
  assert.equal(h.$("nextPending").disabled, true);
});

test("batch does not replace an unaffected open review or its fields", async () => {
  const h = setup(); await h.select(h.current.state.items[1]);
  const selected = h.current.selected, before = structuredClone(h.current.form), reviewBefore = selected.review;
  const { pending } = await commit(h, result(["A"]), ["A"]); await failCatalog(h, pending);
  assert.equal(h.current.selected, selected); assert.equal(selected.review, reviewBefore); assert.deepEqual(h.current.form, before);
  assert.deepEqual(h.current.state.items[0].review, committed());
});

test("batch clears only acknowledged checked keys and records their session saves", async () => {
  const h = setup(), { pending } = await start(h, ["A"]); h.selectedKeys.add("B");
  h.writes[0].resolve(result(["A"])); await tick(); await failCatalog(h, pending);
  assert.deepEqual([...h.selectedKeys], ["B"]); assert.deepEqual([...h.savedThisSession], ["A"]);
});

test("next Save after catalog failure uses the committed review and version", async () => {
  const h = setup(), { pending } = await commit(h); await failCatalog(h, pending);
  h.edit("next draft"); const saving = h.save(); await tick(); const write = h.writes.at(-1);
  write.reject(new Error("stop after payload capture")); await saving;
  assert.equal(write.path, "/api/review"); assert.equal(write.payload.expected_version, 5);
  assert.equal(write.payload.status, "exclude"); assert.equal(write.payload.score, 0); assert.equal(write.payload.trim_end, 5.123456);
  assert.equal(write.payload.note, "next draft"); assert.deepEqual(write.payload.markers, committed().markers);
});

test("next Undo after catalog failure uses the committed version", async () => {
  const h = setup(), { pending } = await commit(h); await failCatalog(h, pending);
  const undoing = h.undo(); await tick(); const write = h.writes.at(-1); write.reject(new Error("stop")); await undoing;
  assert.deepEqual(write.payload, { key: "A", expected_version: 5 });
});

test("next Batch after catalog failure uses every committed version", async () => {
  const h = setup(), { pending } = await commit(h); await failCatalog(h, pending);
  const next = await start(h), write = h.writes.at(-1); write.reject(new Error("stop")); await next.pending;
  assert.deepEqual(write.payload.changes, [{ key: "A", expected_version: 5 }, { key: "B", expected_version: 5 }]);
});

test("failed totals refresh reports a persistent bilingual committed-batch warning", async () => {
  for (const language of ["en", "zh"]) {
    const h = setup({ language }), stats = structuredClone(h.current.state.stats), { pending } = await commit(h); await failCatalog(h, pending);
    assert.equal(typeof words[language].batchRefresh, "string"); assert.deepEqual(h.notices.at(-1), [words[language].batchRefresh]);
    assert.deepEqual(h.current.state.stats, stats); assert.equal(h.histories.length, 1); assert.equal(h.writes.length, 1);
  }
});

test("rejected batch retains current reviews and checks and never reads the catalog", async () => {
  const h = setup(), before = structuredClone(h.current.form), { pending } = await start(h);
  h.writes[0].reject(new Error("batch conflict")); await pending;
  assert.deepEqual(h.current.form, before); assert.deepEqual(h.current.selected.review, review());
  assert.deepEqual([...h.selectedKeys], ["A", "B"]); assert.deepEqual([...h.savedThisSession], []);
  assert.deepEqual(h.reads, []); assert.deepEqual(h.notices.at(-1), ["batch conflict"]); assert.equal(h.current.busy, false);
});

test("declined discard preserves the draft and sends no batch", async () => {
  const h = setup(); h.edit("keep draft"); const { pending } = await start(h); assert.equal(h.dialogs, 1);
  h.answerDiscard(false); await pending;
  assert.equal(h.current.form.note, "keep draft"); assert.equal(h.current.dirty, true); assert.deepEqual(h.writes, []);
});

test("accepted discard restores saved fields before the batch response is applied", async () => {
  const h = setup(); h.edit("discard draft"); const { pending } = await start(h); h.answerDiscard(true); await tick();
  h.writes[0].resolve(result()); await tick(); await failCatalog(h, pending);
  assert.equal(h.current.form.note, "keep note"); assert.equal(h.current.form.status, "exclude"); assert.equal(h.current.dirty, false);
});

test("successful refresh uses authoritative totals and singular or plural success feedback", async () => {
  for (const keys of [["A"], ["A", "B"]]) {
    const h = setup(), { pending } = await commit(h, result(keys), keys), next = catalog(committed());
    next.stats.review_counts = { pass: 0, pending: 1, fix: 0, exclude: 1 }; next.stats.human_approved_seconds = 0;
    await completeCatalog(h, pending, next);
    assert.equal(h.current.state, next); assert.deepEqual(h.notices.at(-1), [`${keys.length} ${keys.length === 1 ? "review updated" : "reviews updated"}`, true]);
    assert.equal(h.histories.length, 0);
  }
});

test("new edits during batch refresh preserve their draft and feedback", async () => {
  for (const failure of [false, true]) {
    const h = setup(), { pending } = await commit(h); h.edit("newer draft"); h.feedback("newer feedback");
    if (failure) h.reads[0].reject(new Error("obsolete")); else h.reads[0].resolve(catalog()); await pending;
    assert.equal(h.current.form.note, "newer draft"); assert.equal(h.current.dirty, true);
    assert.deepEqual(h.notices.at(-1), ["newer feedback"]); assert.equal(h.histories.length, 0);
  }
});

test("new navigation during batch refresh retains selection and feedback", async () => {
  for (const failure of [false, true]) {
    const h = setup(), { pending } = await commit(h), next = h.current.state.items[1]; await h.select(next); h.feedback("new selection");
    if (failure) h.reads[0].reject(new Error("obsolete")); else h.reads[0].resolve(catalog()); await pending;
    assert.equal(h.current.selected, next); assert.deepEqual(h.notices.at(-1), ["new selection"]); assert.equal(h.histories.length, 0);
  }
});

test("new manual refresh owns the catalog and feedback after batch", async () => {
  const h = setup(), { pending } = await commit(h), newer = h.refresh(true), next = catalog(committed());
  await completeCatalog(h, newer, next); h.feedback("new refresh"); h.reads[0].reject(new Error("obsolete")); await pending;
  assert.equal(h.current.state, next); assert.deepEqual(h.notices.at(-1), ["new refresh"]); assert.equal(h.histories.length, 0);
});

test("new mutation revokes pending batch refresh feedback", async () => {
  const h = setup(), { pending } = await commit(h); h.edit("next save"); const saving = h.save(); h.feedback("saving now");
  h.reads[0].reject(new Error("obsolete")); await pending;
  assert.equal(h.current.busy, true); assert.deepEqual(h.notices.at(-1), ["saving now"]); assert.equal(h.histories.length, 0);
  h.writes.at(-1).reject(new Error("stop save")); await saving;
});

test("waveform failure after a successful catalog keeps its error and remains retryable", async () => {
  const h = setup(), { pending } = await commit(h), next = catalog(committed()); h.reads[0].resolve(next); await tick();
  h.reads[1].reject(new Error("waveform unavailable")); await pending;
  assert.equal(h.current.state, next); assert.deepEqual(h.notices.at(-1), ["waveform unavailable"]);
  assert.equal(h.$("retryWave").hidden, false);
  const retry = h.retryWave(); await tick(); assert.equal(h.reads[2].path, "/api/wave/A");
  h.reads[2].resolve({ a: [0], b: [] }); await retry; assert.equal(h.$("retryWave").hidden, true);
  assert.equal(h.writes.length, 1);
});

test("count-only older responses recover through a successful catalog read", async () => {
  const h = setup(), { pending } = await commit(h, { saved: 2 }), next = catalog(committed());
  assert.deepEqual(h.current.selected.review, review()); await completeCatalog(h, pending, next);
  assert.equal(h.current.state, next); assert.deepEqual(h.notices.at(-1), ["2 reviews updated", true]); assert.equal(h.writes.length, 1);
});

test("count-only older responses never invent reviews when the catalog is unavailable", async () => {
  for (const language of ["en", "zh"]) {
    const h = setup({ language }), { pending } = await commit(h, { saved: 2 }); await failCatalog(h, pending);
    assert.deepEqual(h.current.selected.review, review()); assert.equal(typeof words[language].batchReviewRefresh, "string");
    assert.deepEqual(h.notices.at(-1), [words[language].batchReviewRefresh]); assert.equal(h.writes.length, 1);
  }
});

test("incomplete duplicate or unexpected review keys never partially reconcile a batch", async () => {
  for (const rows of [result(["A"]).reviews, [result().reviews[0], result().reviews[0]], [result().reviews[0], { key: "other", review: committed() }]]) {
    const h = setup(), { pending } = await commit(h, { saved: 2, reviews: rows }); await failCatalog(h, pending);
    assert.deepEqual(h.current.selected.review, review()); assert.deepEqual(h.notices.at(-1), [words.en.batchReviewRefresh]); assert.equal(h.writes.length, 1);
  }
});

test("an inconsistent saved count does not claim success or clear checked clips", async () => {
  const h = setup({ translateErrors: true }), { pending } = await start(h); h.writes[0].resolve({ ...result(), saved: 1 }); await tick();
  // Settle the old implementation's unexpected GET so the baseline failure is
  // an assertion, not a dangling-promise cancellation.
  if (h.reads.length) h.reads[0].reject(new Error("unexpected catalog read"));
  await pending;
  assert.deepEqual(h.current.selected.review, review()); assert.deepEqual([...h.selectedKeys], ["A", "B"]);
  assert.deepEqual([...h.savedThisSession], []); assert.deepEqual(h.reads, []);
  assert.deepEqual(h.notices.at(-1), [actualErrorText({ code: "batch_unconfirmed" }, "en")]); assert.equal(h.writes.length, 1);
});

test("malformed committed records never corrupt selected or catalog reviews", async () => {
  for (const malformed of [true, "saved", {}, [], { ...committed("B"), issues: null }, { ...committed("B"), markers: [null] },
    { ...committed("B"), note: null }, { ...committed("B"), score: "0" }, { ...committed("B"), trim_end: {} },
    { ...committed("B"), version: 4 }, { ...committed("B"), version: 5.5 }, { ...committed("B"), status: "pass" },
    { ...committed("B"), updated_utc: null }, { ...committed("B"), origin: "human_ui" }]) {
    const h = setup(), before = structuredClone(h.current.form), response = result(); response.reviews[1].review = malformed;
    const { pending } = await commit(h, response); await failCatalog(h, pending);
    assert.deepEqual(h.current.selected.review, review()); assert.deepEqual(h.current.form, before);
    assert.deepEqual(h.current.state.items.map(row => row.review), catalog().items.map(row => row.review));
    assert.deepEqual(h.notices.at(-1), [words.en.batchReviewRefresh]); assert.equal(h.writes.length, 1);
  }
});

test("unconfirmed result uses the real bilingual error translator without suggesting a blind retry", async () => {
  for (const language of ["en", "zh"]) {
    const h = setup({ language, translateErrors: true }), { pending } = await start(h);
    h.writes[0].resolve(null); await pending;
    assert.deepEqual(h.notices.at(-1), [actualErrorText({ code: "batch_unconfirmed" }, language)]);
    assert.notEqual(h.notices.at(-1)[0], actualErrorText(new Error("raw text"), language));
    assert.deepEqual(h.reads, []); assert.equal(h.writes.length, 1);
  }
});

// Model native disabled-control blur and focusin ownership, not browser/AT output.
test("failed batch restores its enabled trigger and removes focus tracking", async () => {
  const h = setup(); h.$("applyBatch").focus(); const { pending } = await start(h);
  assert.equal(h.document.activeElement, h.document.body); assert.equal(h.$("applyBatch").disabled, true);
  h.writes[0].reject(new Error("conflict")); await pending;
  assert.equal(h.document.activeElement, h.$("applyBatch")); assert.equal(h.focusListeners.size, 0);
});

for (const outcome of ["success", "catalog failure", "waveform failure"]) test(`batch success returns to queue before ${outcome}, without reclaiming later focus`, async () => {
  const h = setup(); h.$("applyBatch").focus(); const { pending } = await commit(h);
  assert.equal(h.$("batchBar").hidden, true); assert.equal(h.document.activeElement, h.$("selectAll"));
  assert.equal(h.focusListeners.size, 0); h.$("search").focus();
  if (outcome === "catalog failure") await failCatalog(h, pending);
  else if (outcome === "waveform failure") {
    h.reads[0].resolve(catalog(committed())); await tick();
    h.reads.at(-1).reject(new Error("wave unavailable")); await pending;
  } else await completeCatalog(h, pending);
  assert.equal(h.document.activeElement, h.$("search"));
});

for (const fallback of ["empty filter", "hidden select all", "both hidden"]) test(`batch fallback respects ${fallback}`, async () => {
  const h = setup();
  if (fallback === "empty filter") h.$("search").value = "does not match any clip";
  else h.$("selectAll").hidden = true;
  if (fallback === "both hidden") h.$("search").hidden = true;
  h.$("applyBatch").focus(); const { pending } = await commit(h);
  assert.equal(h.document.activeElement, fallback === "both hidden" ? h.document.body : h.$("search"));
  await failCatalog(h, pending);
});

for (const success of [false, true]) for (const blur of [false, true]) test(`batch respects moved focus (success=${success}, later blur=${blur})`, async () => {
  const h = setup(); h.$("applyBatch").focus(); const { pending } = await start(h);
  h.$("search").focus(); if (blur) h.$("search").blur();
  if (success) { h.writes[0].resolve(result()); await tick(); await failCatalog(h, pending); }
  else { h.writes[0].reject(new Error("conflict")); await pending; }
  assert.equal(h.document.activeElement, blur ? h.document.body : h.$("search"));
  assert.equal(h.focusListeners.size, 0);
});

for (const success of [false, true]) test(`detached batch origin does not claim focus on success=${success}`, async () => {
  const h = setup(); h.$("applyBatch").focus(); const { pending } = await start(h);
  h.$("applyBatch").isConnected = false;
  if (success) { h.writes[0].resolve(result()); await tick(); await failCatalog(h, pending); }
  else { h.writes[0].reject(new Error("conflict")); await pending; }
  assert.equal(h.document.activeElement, h.document.body); assert.equal(h.focusListeners.size, 0);
});

test("cancelled discard never installs batch focus ownership", async () => {
  const h = setup(); h.edit("keep draft"); h.$("applyBatch").focus(); const { pending } = await start(h);
  assert.equal(h.document.activeElement, h.$("keepEditing")); assert.equal(h.focusListeners.size, 0);
  h.$("note").focus(); h.answerDiscard(false); await pending;
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(h.writes.length, 0);
});

test("new save during batch refresh keeps its own focus ownership", async () => {
  const h = setup(); h.$("applyBatch").focus(); const { pending } = await commit(h);
  h.$("note").focus(); h.edit("next draft"); const saving = h.save(); await tick();
  assert.equal(h.document.activeElement, h.document.body);
  h.reads[0].reject(new Error("obsolete refresh")); await pending;
  assert.equal(h.document.activeElement, h.document.body);
  h.writes.at(-1).reject(new Error("save stopped")); await saving;
  assert.equal(h.document.activeElement, h.$("note")); assert.equal(h.focusListeners.size, 0);
});

for (const mobile of [true, false]) for (const moved of [true, false]) test(`batch automatic refresh keeps queue focus visible (mobile=${mobile}, delayed search focus=${moved})`, async () => {
  const h = setup({ mobile }); h.$("applyBatch").focus(); const { pending } = await commit(h);
  assert.equal(h.document.activeElement, h.$("selectAll"));
  if (moved) h.$("search").focus();
  await completeCatalog(h, pending);
  const target = h.$(moved ? "search" : "selectAll");
  assert.equal(h.document.activeElement, target); assert.ok(target.getClientRects().length);
  assert.equal(h.document.body.classList.contains("mobile-library-collapsed"), false);
});

// Actual save, renderDetails, queue input and language handlers with deferred I/O.
// These checks concern truthful operation state, not native live-region delivery.
for (const language of ["en", "zh"]) for (const id of ["search", "filter", "sort"]) test(`saving status survives ${id} redraw (${language})`, async () => {
  const h = setup({ language }); h.edit("Uncommitted note");
  const saving = h.save(false); await tick();
  assert.equal(h.$(id).disabled, false);
  h.$(id).value = id === "search" ? "A" : id === "filter" ? "pending" : "name";
  h.$(id).listeners.get(id === "search" ? "input" : "change")();
  assert.equal(h.$("saveState").textContent, words[language].saving);
  assert.equal(h.current.busy, true); assert.equal(h.current.form.note, "Uncommitted note");
  assert.equal(h.writes.length, 1);
  h.writes[0].reject(new Error("controlled rejection")); await saving;
  assert.equal(h.$("saveState").textContent, words[language].unsaved); assert.equal(h.saving(), null);
});
for (const failure of [false, true]) test(`saving status survives translation and pending catalog (failure=${failure})`, async () => {
  const h = setup(); h.edit("Committed note"); const saving = h.save(false); await tick();
  h.translateTo("zh"); assert.equal(h.$("saveState").textContent, words.zh.saving);
  h.writes[0].resolve({ review: review({ note: "Committed note", version: 5 }) }); await tick();
  assert.equal(h.current.dirty, false); assert.equal(h.current.busy, true);
  h.translateTo("en"); assert.equal(h.$("saveState").textContent, words.en.saving);
  if (failure) h.reads[0].reject(new Error("catalog unavailable"));
  else h.reads[0].resolve(catalog(review({ note: "Committed note", version: 5 })));
  await saving;
  assert.equal(h.$("saveState").textContent, words.en.saved); assert.equal(h.current.busy, false); assert.equal(h.saving(), null);
  assert.equal(h.current.form.note, "Committed note");
  h.translateTo("zh"); assert.equal(h.$("saveState").textContent, words.zh.saved);
});
test("rejected save restores localized dirty status and later save acquires fresh ownership", async () => {
  const h = setup(); h.edit("Retry note"); const first = h.save(false); await tick();
  const firstOwner = h.saving(); h.translateTo("zh");
  h.writes[0].reject(new Error("version conflict")); await first;
  assert.equal(h.$("saveState").textContent, words.zh.unsaved); assert.equal(h.saving(), null);
  const retry = h.save(false); await tick(); assert.notEqual(h.saving(), firstOwner);
  assert.equal(h.writes[1].payload.expected_version, 4); assert.equal(h.$("saveState").textContent, words.zh.saving);
  h.writes[1].reject(new Error("end retry")); await retry; assert.equal(h.saving(), null);
});
test("overlapping Save, Undo and Batch cannot replace active save ownership", async () => {
  const h = setup(); h.edit("Save once"); const saving = h.save(false); await tick(); const owner = h.saving();
  h.selectedKeys.add("A"); await Promise.all([h.save(false), h.save(true), h.undo(), h.batch()]);
  assert.equal(h.saving(), owner); assert.equal(h.writes.length, 1); assert.equal(h.$("saveState").textContent, words.en.saving);
  h.writes[0].reject(new Error("end save")); await saving; assert.equal(h.saving(), null);
});
for (const action of ["undo", "batch"]) test(`${action} busy status never masquerades as saving`, async () => {
  const h = setup(); h.selectedKeys.add("A"); h.$("batchStatus").value = "exclude";
  const pending = h[action](); await tick(); assert.equal(h.current.busy, true); assert.equal(h.saving(), null);
  h.translateTo("zh"); assert.equal(h.$("saveState").textContent, words.zh.saved);
  h.writes[0].reject(new Error("end other operation")); await pending;
  assert.equal(h.saving(), null); assert.equal(h.$("saveState").textContent, words.zh.saved);
});
test("invalid form and unflushed marker early exits never acquire saving ownership", async () => {
  const h = setup(); h.$("reviewForm").reportValidity = () => false;
  await h.save(false); assert.equal(h.saving(), null); assert.equal(h.writes.length, 0);
  assert.equal(h.$("saveState").textContent, words.en.saved);
  const blocked = setup({ markerFlush: false }); await blocked.save(false);
  assert.equal(blocked.saving(), null); assert.equal(blocked.writes.length, 0);
});
test("older Save-and-continue waveform completion cannot clear a newer save status", async () => {
  const initial = catalog(); initial.items[1] = item("B", true);
  const h = setup({ initial }); h.edit("First save"); const first = h.save(true); await tick();
  const saved = review({ note: "First save", version: 5 });
  h.writes[0].resolve({ review: saved }); await tick();
  const refreshed = catalog(saved); refreshed.items[1] = item("B", true);
  h.reads[0].resolve(refreshed); await tick();
  assert.equal(h.current.selected.key, "B"); assert.equal(h.current.busy, false);
  assert.equal(h.saving(), null, "persistence has settled before next clip's waveform load");
  assert.match(h.reads[1].path, /^\/api\/wave\//);
  h.edit("Second save"); const second = h.save(false); await tick(); const owner = h.saving();
  h.reads[1].resolve({ a: [], b: [] }); await first;
  assert.equal(h.saving(), owner); assert.equal(h.$("saveState").textContent, words.en.saving);
  assert.equal(h.writes.length, 2); assert.equal(h.writes[1].payload.key, "B");
  h.writes[1].reject(new Error("end second save")); await second; assert.equal(h.saving(), null);
});

for (const language of ["en", "zh"]) test(`export scope follows clean/draft/save/failure and language (${language})`, async () => {
  const h = setup({ language }), scope = h.$("exportScope");
  assert.equal(scope.textContent, words[language].exportScopeSaved);
  h.$("exportMenu").open = true; h.$("exportMenu").listeners.get("toggle")();
  assert.equal(scope.textContent, words[language].exportScopeSaved); assert.equal(h.writes.length, 0);
  h.edit("Unsaved change"); assert.equal(scope.textContent, words[language].exportScopeDraft);
  const other = language === "en" ? "zh" : "en"; h.translateTo(other);
  assert.equal(scope.textContent, words[other].exportScopeDraft); assert.equal(h.current.form.note, "Unsaved change");
  const saving = h.save(false); await tick(); assert.equal(scope.textContent, words[other].exportScopeSaving);
  h.$("exportMenu").listeners.get("toggle")(); assert.equal(h.writes.length, 1, "opening export never auto-saves");
  h.translateTo(language); assert.equal(scope.textContent, words[language].exportScopeSaving);
  h.writes[0].reject(new Error("save failed")); await saving;
  assert.equal(scope.textContent, words[language].exportScopeDraft); assert.equal(h.current.form.note, "Unsaved change");
  h.edit("keep note"); assert.equal(scope.textContent, words[language].exportScopeSaved);
});
for (const failure of [false, true]) test(`export scope settles only after committed save catalog read (failure=${failure})`, async () => {
  const h = setup(); h.edit("Committed change"); const saving = h.save(false); await tick();
  h.writes[0].resolve({ review: review({ note: "Committed change", version: 5 }) }); await tick();
  assert.equal(h.current.dirty, false); assert.equal(h.$("exportScope").textContent, words.en.exportScopeSaving);
  if (failure) h.reads[0].reject(new Error("catalog unavailable"));
  else h.reads[0].resolve(catalog(review({ note: "Committed change", version: 5 })));
  await saving; assert.equal(h.$("exportScope").textContent, words.en.exportScopeSaved);
  h.translateTo("zh"); assert.equal(h.$("exportScope").textContent, words.zh.exportScopeSaved);
});
for (const kind of ["status", "trim", "marker"]) test(`export scope detects ${kind} draft without changing saved records`, () => {
  const h = setup({ markerChanges: kind === "marker" });
  if (kind === "status") for (const input of h.document.querySelectorAll('input[name=decision]')) input.checked = input.value === "exclude";
  if (kind === "trim") h.$("trimStart").value = "2";
  h.edit("keep note");
  assert.equal(h.$("exportScope").textContent, words.en.exportScopeDraft); assert.equal(h.writes.length, 0);
  assert.equal(h.current.selected.review.status, "pass"); assert.equal(h.current.selected.review.trim_start, 0);
});
for (const action of ["undo", "batch"]) test(`export scope does not label ${action} as an active save`, async () => {
  const h = setup(); h.selectedKeys.add("A"); h.$("batchStatus").value = "exclude";
  const pending = h[action](); await tick(); h.translateTo("zh");
  assert.equal(h.$("exportScope").textContent, words.zh.exportScopeSaved);
  h.writes[0].reject(new Error("end operation")); await pending;
});
test("all three export links remain direct downloads described by the saved-scope hint", () => {
  const html = readFileSync(new URL("../src/audio_review_desk/static/workbench.html", import.meta.url), "utf8");
  const menu = html.match(/<details class="export-menu"[\s\S]*?<\/details>/)[0];
  const links = [...menu.matchAll(/<a\s+([^>]+)>/g)].map(match => match[1]);
  assert.equal(links.length, 3);
  for (const link of links) { assert.match(link, /\bdownload\b/); assert.match(link, /aria-describedby="exportScope"/); assert.doesNotMatch(link, /aria-disabled|\bdisabled\b|tabindex/); }
  assert.deepEqual(links.map(link => link.match(/href="([^"]+)"/)[1]), ["/api/export?format=csv&amp;status=pass", "/api/export?format=csv&amp;status=all", "/api/export"]);
  assert.match(menu, /<p id="exportScope" class="export-scope">/);
  assert.doesNotMatch(menu, /role="alert"|aria-live|tabindex/);
});
