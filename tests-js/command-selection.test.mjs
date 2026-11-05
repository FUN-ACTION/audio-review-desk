import { normalizeSearch, searchTerms } from "../src/audio_review_desk/static/ui.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readWithRecovery } from "../src/audio_review_desk/static/read-recovery.js";

// Real command rendering/activation and workbench ownership handlers; only DOM,
// media and I/O are doubled. ARD_COMMAND_WORKBENCH accepts an older workbench.js
// file for a negative control without editing the checked-out production source.
const source = readFileSync(process.env.ARD_COMMAND_WORKBENCH
  ? resolve(process.env.ARD_COMMAND_WORKBENCH)
  : new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing source boundary: ${start}`);
  return source.slice(first, last);
}
const commands = readFileSync(new URL("../src/audio_review_desk/static/commands.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replaceAll("export function", "function");
const handlers = [
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
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const row = key => ({ key, label: `audio-${key}.wav`, quality: { decoded: true, duration: 10 },
  review: { note: `saved ${key}`, version: 1, status: "pending", markers: [] } });
const catalog = () => ({ workspace_id: "command-test", items: [row("A"), row("B"), row("C")],
  stats: { review_counts: { pending: 3 } } });
function setup() {
  const reads = [], notices = [], effects = [], elements = new Map();
  let callbacks, dialogs = 0;
  const noop = () => {};
  const effect = name => (...args) => effects.push([name, ...args]);
  const node = () => ({ value: "", hidden: false, disabled: false, elements: [], children: [], listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setCustomValidity: noop, setAttribute: noop, removeAttribute: noop, scrollIntoView: noop, focus: noop,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    close() { this.open = false; }, querySelector: () => null, reportValidity: () => true });
  const $ = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const env = { normalizeSearch, searchTerms, renderExportScope: () => {},
    $, initial: catalog(), draftSession: null, createWaveformReader, readWithRecovery,
    request: path => { const wait = deferred(); reads.push({ path, ...wait }); return wait.promise; },
    post: () => { throw new Error("unexpected write"); },
    notice: (...args) => notices.push(args), t: key => key, language: "en", errorText: error => error.message,
    sessionStorage: { getItem: () => null, setItem: effect("storage.set") },
    matchMedia: () => ({ matches: false }),
    document: { createElement: node, addEventListener: noop, removeEventListener: noop,
      activeElement: null, body: {} },
    openDialog: dialog => { dialog.open = true; dialogs++; },
    audition: { cancel: effect("audition.cancel") }, rememberPosition: effect("remember"),
    media: { paused: true, cancel: effect("media.cancel"), load: effect("media.load") },
    player: { pause: effect("player.pause"), removeAttribute: effect("player.remove"), load: effect("player.load") },
    spectrumView: { setSource: effect("spectrum.source"), setVisible: noop }, waveformView: { cancelDrag() {}, reset: effect("waveform.reset") },
    renderSummary: noop, renderQueue: noop, drawWave: noop, updateIssueCount: noop, updateLibraryToggle: noop,
    invalidateHistory: noop, loadHistory: noop, renderJob: noop,
    markersView: { hasChanges: () => false, flush: () => true, captureFocus: () => null },
    sameReview: (left, right) => left.note === right.note,
    reviewPayload: (target, values) => ({ ...target.review, note: values.note }), resumedTime: () => 0,
    createJobPoller: options => { callbacks = options; return { start: noop }; },
    searchText: item => item.label, openImport: noop, goToNextPending: noop,
  };
  const control = Function(...Object.keys(env), `
    let spectrumVisible = false;
    let state = initial, selected = state.items[0], dirty = false, busy = false,
      generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      pendingCompletion = null, suspendedCompletion = null, variant = 'a', wave = {}, job = null,
      handledJob = null, visibleCache = null;
    const selectedKeys = new Set(), savedThisSession = new Set();
    let listeningMemory = { get: () => ({}) };
    function visibleItems() { return state.items; }
    function draftValues() { return { note: $('note').value }; }
    function renderDetails(restore = true) { if (restore && selected) $('note').value = selected.review.note; }
    ${handlers}
    ${commands}
    ${extract("const commandMenu = mountCommands({", "function notice(")}
    $('note').value = selected.review.note;
    return { refresh, select, setBusy, acceptJob,
      edit(note) { $('note').value = note; markDirty(); },
      answerDiscard(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      openCommand(key) { commandMenu.open(); $('commandInput').value = 'audio-' + key + '.wav'; $('commandInput').listeners.input(); },
      get current() { return { state, selected, dirty, busy, note: $('note').value, generation, refreshGeneration }; }
    };`)(...Object.values(env));
  function activate(method) {
    assert.equal($("commandList").children.length, 1, "query must identify exactly the cached audio command");
    if (method === "click") $("commandList").children[0].listeners.click();
    else $("commandInput").listeners.keydown({ key: "Enter", preventDefault: noop });
  }
  async function finishRead(pending, next) {
    const stateRead = reads.at(-1);
    assert.equal(stateRead.path, "/api/state");
    stateRead.resolve(next); await tick();
    const waveRead = reads.at(-1);
    if (waveRead !== stateRead) {
      assert.ok(waveRead.path.startsWith("/api/wave/"));
      waveRead.resolve({ a: [], b: [] });
    }
    await pending;
  }
  async function finishSelection(pending) {
    await tick();
    const read = reads.at(-1);
    assert.ok(read.path.startsWith("/api/wave/"));
    read.resolve({ a: [], b: [] }); await pending; await tick();
  }
  async function completeJob(next) {
    const pending = callbacks.onSnapshot({ id: "import", state: "succeeded" }, { restoring: false });
    await finishRead(pending, next);
    assert.equal($("commandDialog").open, true, "background completion must leave cached command available");
  }
  return { ...control, get current() { return control.current; }, get dialogs() { return dialogs; },
    reads, notices, effects, activate, finishRead, finishSelection, completeJob };
}

for (const method of ["click", "Enter"]) {
  test(`${method}: cached audio command uses current catalog object after import completion`, async () => {
    const h = setup();
    h.acceptJob({ id: "import", state: "running" }); h.openCommand("A");
    const stale = h.current.selected, fresh = catalog();
    fresh.items[0].review = { ...fresh.items[0].review, version: 9, note: "current review" };
    await h.completeJob(fresh);
    h.activate(method); await h.finishSelection();
    assert.notEqual(h.current.selected, stale);
    assert.equal(h.current.selected, fresh.items[0]);
    assert.equal(h.current.selected.review.version, 9);
    assert.equal(h.current.note, "current review");
    assert.equal(h.current.dirty, false);
  });

  test(`${method}: removed cached command cannot resurrect an absent asset into a clean editor`, async () => {
    const h = setup();
    h.acceptJob({ id: "import", state: "running" }); h.openCommand("A");
    const fresh = catalog(); fresh.items.shift(); await h.completeJob(fresh);
    const before = h.current, effects = h.effects.length, reads = h.reads.length;
    h.activate(method); await tick();
    // Settle an erroneous old-source waveform read too, keeping the negative
    // control deterministic rather than waiting for its recovery timeout.
    if (h.reads.length > reads) {
      h.reads.at(-1).resolve({ a: [], b: [] }); await tick();
    }
    assert.deepEqual(h.current, before);
    assert.equal(h.current.selected, fresh.items[0]);
    assert.equal(h.effects.length, effects); assert.equal(h.reads.length, reads);
    assert.deepEqual(h.notices.at(-1), ["commandUnavailable"]);
  });

  test(`${method}: removed cached command preserves newer dirty draft and has no selection side effects`, async () => {
    const h = setup();
    h.acceptJob({ id: "import", state: "running" }); h.openCommand("A");
    const fresh = catalog(); fresh.items.shift(); await h.completeJob(fresh);
    h.edit("keep this B draft");
    const before = h.current, effects = h.effects.length, reads = h.reads.length, dialogs = h.dialogs;
    h.activate(method); await tick();
    assert.equal(h.dialogs, dialogs, "missing item must not request draft discard");
    assert.deepEqual(h.current, before);
    assert.equal(h.effects.length, effects, "must not touch media, waveform, listening position or storage");
    assert.equal(h.reads.length, reads);
    assert.deepEqual(h.notices.at(-1), ["commandUnavailable"]);
  });
}

test("dirty cancellation keeps the draft when activating a valid cached audio command", async () => {
  const h = setup(); h.openCommand("B"); h.edit("keep A draft");
  const before = h.current.selected, effects = h.effects.length;
  h.activate("click"); await tick();
  assert.equal(h.dialogs, 2); h.answerDiscard(false); await tick();
  assert.equal(h.current.selected, before); assert.equal(h.current.note, "keep A draft");
  assert.equal(h.current.dirty, true); assert.equal(h.effects.length, effects);
});

test("a newer navigation intent wins while the cached command awaits discard", async () => {
  const h = setup(); h.openCommand("B"); h.edit("A draft");
  const before = h.current.selected, effects = h.effects.length;
  h.activate("Enter"); await tick();
  await h.select(h.current.state.items[2]); // Invalidates B; existing discard dialog rejects this second selection.
  h.answerDiscard(true); await tick();
  assert.equal(h.current.selected, before, "obsolete B intent must not select after confirmation");
  assert.equal(h.current.dirty, true, "obsolete discard confirmation must not clear draft ownership");
  assert.equal(h.current.note, "A draft");
  assert.equal(h.effects.length, effects);
});

test("newer refresh during discard prevents a resolved command object from being applied", async () => {
  const h = setup(); h.openCommand("B"); h.edit("A draft");
  const before = h.current.selected, effects = h.effects.length;
  h.activate("click"); await tick();
  assert.equal(await h.refresh(true), false, "dirty draft blocks background refresh but its newer intent wins");
  h.answerDiscard(true); await tick();
  assert.equal(h.current.selected, before);
  assert.equal(h.current.dirty, true, "newer refresh intent must invalidate old discard confirmation");
  assert.equal(h.current.note, "A draft");
  assert.equal(h.effects.length, effects);
});

test("a newer selection wins the clean command's asynchronous discard-check gap", async () => {
  const h = setup(); h.openCommand("B");
  h.activate("click"); const pending = h.select(h.current.state.items[2]);
  await h.finishSelection(pending);
  assert.equal(h.current.selected.key, "C");
  assert.deepEqual(h.reads.map(read => read.path), ["/api/wave/C"]);
});

test("busy activation cannot select or discard a valid cached audio command", async () => {
  const h = setup(); h.openCommand("B"); h.edit("A draft"); h.setBusy(true);
  const before = h.current, effects = h.effects.length, dialogs = h.dialogs;
  h.activate("Enter"); await tick();
  assert.deepEqual(h.current, before); assert.equal(h.effects.length, effects);
  assert.equal(h.dialogs, dialogs); assert.equal(h.reads.length, 0);
});

test("a newer successful refresh wins the clean command's asynchronous check gap", async () => {
  const h = setup(); h.openCommand("B");
  h.activate("Enter");
  const fresh = catalog(); fresh.items[0].review.note = "fresh A";
  const pending = h.refresh(true);
  await h.finishRead(pending, fresh);
  assert.equal(h.current.selected, fresh.items[0]);
  assert.equal(h.current.note, "fresh A");
  assert.deepEqual(h.reads.map(read => read.path), ["/api/state", "/api/wave/A"]);
});


for (const method of ["click", "Enter"]) test(`${method}: busy removed command preserves feedback and the dirty draft`, async () => {
  const h = setup(); h.acceptJob({ id: "import", state: "running" }); h.openCommand("A");
  const fresh = catalog(); fresh.items.shift(); await h.completeJob(fresh);
  h.edit("B draft while saving"); h.setBusy(true);
  const before = h.current, effects = h.effects.length, reads = h.reads.length,
    notices = [...h.notices], dialogs = h.dialogs;
  h.activate(method); await tick();
  assert.deepEqual(h.current, before); assert.equal(h.effects.length, effects);
  assert.equal(h.reads.length, reads); assert.equal(h.dialogs, dialogs);
  assert.deepEqual(h.notices, notices, "busy must not replace existing feedback with unavailable-item notice");
});

test("an obsolete confirmation after a busy operation starts cannot discard the live draft", async () => {
  const h = setup(); h.openCommand("B"); h.edit("A draft");
  h.activate("click"); await tick(); h.setBusy(true);
  const before = h.current.selected, effects = h.effects.length;
  h.answerDiscard(true); await tick();
  assert.equal(h.current.selected, before); assert.equal(h.current.note, "A draft");
  assert.equal(h.current.dirty, true); assert.equal(h.effects.length, effects);
});

test("a current accepted discard still activates the current audio record exactly once", async () => {
  const h = setup(); h.openCommand("B"); h.edit("A draft");
  h.activate("click"); await tick(); h.answerDiscard(true); await h.finishSelection();
  assert.equal(h.current.selected, h.current.state.items[1]);
  assert.equal(h.current.note, "saved B"); assert.equal(h.current.dirty, false);
  assert.deepEqual(h.reads.map(read => read.path), ["/api/wave/B"]);
});
