import test from "node:test";
import assert from "node:assert/strict";
import { createWaveformReader } from "../src/audio_review_desk/static/waveform-reader.js";
import { readFileSync } from "node:fs";
import { readOnce } from "../src/audio_review_desk/static/read-once.js";
import { readWithRecovery } from "../src/audio_review_desk/static/read-recovery.js";

// Actual workbench control flow with deferred I/O and small DOM/render doubles.
// These tests cover ownership and draft safety, not browser rendering.
const source = readFileSync(process.env.ARD_COMPLETION_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = [
  extract("let discardResolver =", "function translate()"),
  extract("function markDirty()", "function range()"),
  extract("async function select(item", "function showCompletion("),
  extract("let jobPollError =", "async function startImport("),
  extract('window.addEventListener("pagehide", (event)', 'document.addEventListener("visibilitychange", () => {\n  spectrumView'),
].join("\n");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const row = (key, decoded = false) => ({ key, label: key, quality: { decoded, duration: 10 }, review: { note: `saved ${key}`, version: 1, markers: [] } });
const catalog = (version, decoded = false) => ({ version, workspace_id: "test", items: [row("A", decoded), row("B", decoded)], stats: { review_counts: { pending: 2 } } });
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
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
const offline = () => Object.assign(new Error("offline"), { code: "network" });
function setup({ decoded = false, requestImpl = null } = {}) {
  const reads = [], writes = [], notices = [], elements = new Map(), starts = [];
  let callbacks, dialogs = 0;
  const runtime = clock(), listeners = {};
  const noop = () => {};
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, elements: [], disabled: false,
      setCustomValidity() {}, setAttribute() {}, querySelector: () => null, reportValidity: () => true, focus: noop });
    return elements.get(id);
  };
  const env = { renderExportScope: () => {},
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    invalidateHistory: () => {}, loadHistory: () => {}, $, initial: catalog("initial", decoded), AbortController,
    readWithRecovery: options => readWithRecovery(options, runtime),
    createWaveformReader: options => createWaveformReader(options, runtime),
    window: { addEventListener(type, fn) { listeners[type] = fn; } },
    request: (path, options) => { if (requestImpl) return requestImpl(path, options); const wait = deferred(); reads.push({ path, signal: options?.signal, ...wait }); return wait.promise; },
    post: (path, payload) => { const wait = deferred(); writes.push({ path, payload, ...wait }); return wait.promise; },
    captureNotice: (...args) => { $("notice").textContent = args[0] || ""; notices.push(args); }, errorText: error => error.message, language: "en", t: key => key,
    sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: false }),
    document: { addEventListener: noop, removeEventListener: noop, activeElement: null, body: {} }, openDialog: () => { dialogs++; },
    audition: { cancel: noop }, rememberPosition: noop, media: { cancel: noop, load: noop },
    player: { pause: noop, removeAttribute: noop, load: noop }, updateLibraryToggle: noop,
    spectrumView: { setSource: noop, setVisible: noop, dispose: noop }, waveformView: { cancelDrag() {}, reset: noop },
    renderSummary: noop, renderQueue: noop, drawWave: noop, updateIssueCount: noop,
    markersView: { hasChanges: () => false, flush: () => true, captureFocus: () => null },
    sameReview: (left, right) => left.note === right.note,
    reviewPayload: (target, values) => ({ ...target.review, note: values.note }),
    resumedTime: () => 0, renderJob: noop,
    createJobPoller: options => { callbacks = options; return { start: value => starts.push(value), stop: noop }; },
  };
  const control = Function(...Object.keys(env), `
    let noticeResolver = null;
    function notice(message = '', ...args) { noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null; if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice(); }
    let state = initial, selected = state.items[0], dirty = false, busy = false,
      generation = 0, refreshGeneration = 0, variant = 'a', wave = {}, job = null,
      handledJob = null, visibleCache = null, refreshController = null, refreshRead = null, pendingCompletion = null, suspendedCompletion = null, spectrumVisible = false;
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
  return { ...control, get current() { return control.current; }, reads, writes, notices, starts, callbacks, runtime, listeners, $, feedback: message => control.notice(message), get dialogs() { return dialogs; } };
}

const terminal = (id = "done") => ({ id, state: "succeeded" });
const complete = (h, next = terminal()) => h.callbacks.onSnapshot(next, { restoring: false });
const stateReads = h => h.reads.filter(({ path }) => path === "/api/state");
const hasDone = h => h.notices.some(([text]) => text === "jobDone");

test("completion recovers its state read once without replaying mutations", async () => {
  const h = setup(), done = terminal(), pending = complete(h, done);
  h.reads[0].reject(offline()); await tick();
  await h.runtime.tick(700);
  assert.equal(stateReads(h).length, 2);
  assert.deepEqual(h.notices, [["jobRefreshing"]]);
  h.reads[1].resolve(catalog("recovered")); await pending;
  assert.equal(h.current.state.version, "recovered");
  assert.equal(h.notices.filter(([text]) => text === "jobDone").length, 1);
  await complete(h, done); await h.runtime.tick(20000);
  assert.equal(stateReads(h).length, 2); assert.deepEqual(h.writes, []);
  assert.equal(h.runtime.count, 0);
});

test("repeated outages show one recovery notice and retain original catalog until recovery", async () => {
  const h = setup(), pending = complete(h);
  for (const delay of [700, 1400, 2800]) {
    h.reads.at(-1).reject(offline()); await tick();
    assert.equal(h.current.state.version, "initial");
    assert.equal(h.notices.filter(([text]) => text === "jobRefreshing").length, 1);
    await h.runtime.tick(delay);
  }
  h.reads.at(-1).resolve(catalog("recovered")); await pending;
  assert.equal(h.current.state.version, "recovered"); assert.deepEqual(h.writes, []);
});

for (const stage of ["read", "backoff"]) {
  for (const action of ["edit", "edit-revert", "select", "save", "new-refresh", "new-job"]) {
    test(`${action} during completion ${stage} cancels recovery without reclaiming ownership`, async () => {
      const h = setup(), pending = complete(h), first = h.reads[0];
      if (stage === "backoff") { first.reject(offline()); await tick(); }
      if (action === "edit") h.edit("precious draft");
      if (action === "edit-revert") { h.edit("temporary"); h.edit("saved A"); }
      if (action === "select") await h.select(h.current.state.items[1]);
      if (action === "save") {
        const save = h.save(); h.writes[0].reject(new Error("save rejected")); await save;
      }
      if (action === "new-refresh") {
        const newer = h.refresh(true); h.reads.at(-1).resolve(catalog("newer")); await newer;
      }
      if (action === "new-job") h.acceptJob({ id: "new", state: "running" });
      const expected = h.current, readCount = h.reads.length, noticeCount = h.notices.length;
      if (stage === "read") first.resolve(catalog("stale"));
      await pending; await h.runtime.tick(60000);
      assert.equal(h.reads.length, readCount); assert.equal(h.notices.length, noticeCount);
      assert.equal(h.current.state, expected.state); assert.equal(h.current.selected, expected.selected);
      assert.equal(h.current.note, expected.note); assert.equal(h.current.dirty, expected.dirty);
      assert.equal(hasDone(h), false); assert.equal(h.runtime.count, 0);
      if (stage === "read") assert.equal(first.signal.aborted, true);
    });
  }
}

test("dirty and restored completed jobs never start a state recovery", async () => {
  const dirty = setup(); dirty.edit("keep me"); await complete(dirty);
  assert.deepEqual(dirty.reads, []); assert.equal(dirty.dialogs, 0);
  assert.deepEqual(dirty.notices, [["refreshDraft", true]]);
  const restored = setup(); await restored.callbacks.onSnapshot(terminal(), { restoring: true });
  await complete(restored); assert.deepEqual(restored.reads, []); assert.deepEqual(restored.notices, []);
});

test("current non-network state errors report once without a retry or success notice", async () => {
  const h = setup(), pending = complete(h);
  h.reads[0].reject(Object.assign(new Error("state rejected"), { code: "workspace_invalid" }));
  await pending; await h.runtime.tick(20000);
  assert.equal(h.reads.length, 1); assert.deepEqual(h.notices, [["state rejected"]]);
});

test("pagehide cancels the read and silences late response", async () => {
  const h = setup(), pending = complete(h), first = h.reads[0];
  h.listeners.pagehide({ persisted: false });
  first.resolve(catalog("hidden")); await pending; await h.runtime.tick(60000);
  assert.equal(h.current.state.version, "initial"); assert.equal(first.signal.aborted, true);
  assert.equal(h.runtime.count, 0); assert.deepEqual(h.notices, []);
});

test("BFCache resumes only its suspended same-job unapplied state read", async () => {
  const h = setup(), done = terminal(), pending = complete(h, done);
  h.reads[0].reject(offline()); await tick();
  h.listeners.pagehide({ persisted: true }); await pending;
  assert.equal(h.runtime.count, 0);
  h.listeners.pageshow({ persisted: true });
  const resumed = complete(h, { ...done });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog("resumed")); await resumed;
  assert.equal(h.current.state.version, "resumed");
  await complete(h, { ...done }); assert.equal(h.reads.length, 2);
});

for (const action of ["edit", "select", "new-job"]) {
  test(`BFCache suspension cannot survive newer ${action} ownership`, async () => {
    const h = setup(), pending = complete(h);
    h.listeners.pagehide({ persisted: true }); await pending;
    if (action === "edit") h.edit("new draft");
    if (action === "select") await h.select(h.current.state.items[1]);
    if (action === "new-job") h.acceptJob({ id: "replacement", state: "running" });
    h.listeners.pageshow({ persisted: true }); await complete(h);
    assert.equal(h.reads.length, 1); assert.equal(hasDone(h), false);
  });
}

test("pagehide after catalog application does not suspend a waveform-only wait", async () => {
  const h = setup({ decoded: true }), pending = complete(h);
  h.reads[0].resolve(catalog("applied", true)); await tick();
  assert.equal(h.reads[1].path, "/api/wave/A");
  h.listeners.pagehide({ persisted: true });
  h.reads[1].resolve({ a: [], b: [] }); await pending;
  h.listeners.pageshow({ persisted: true }); await complete(h);
  assert.equal(stateReads(h).length, 1); assert.equal(hasDone(h), false);
});

test("completion does not replace a current waveform failure with its success notice", async () => {
  const h = setup({ decoded: true }), pending = complete(h);
  h.reads[0].reject(offline()); await tick(); await h.runtime.tick(700);
  h.reads[1].resolve(catalog("imported", true)); await tick();
  assert.equal(h.reads[2].path, "/api/wave/A");
  h.reads[2].reject(new Error("wave failed")); await pending;
  assert.equal(h.current.state.version, "imported"); assert.deepEqual(h.notices.at(-1), ["wave failed"]);
  assert.equal(hasDone(h), false);
});

for (const hungStage of ["fetch", "JSON body"]) {
  test(`completion deadline covers a hung ${hungStage} through the actual request function`, async () => {
    const fetches = [], body = deferred();
    const requestImpl = Function("fetch", "errorText", "language", "readOnce", `${extract("async function request(", "const post =")}; return request;`)(
      (path, options) => { const wait = deferred(); fetches.push({ path, ...options, ...wait }); return wait.promise; },
      error => error.code, "en", readOnce);
    const h = setup({ requestImpl }), pending = complete(h);
    if (hungStage === "JSON body") { fetches[0].resolve({ ok: true, json: () => body.promise }); await tick(); }
    await h.runtime.tick(7999); assert.equal(fetches.length, 1);
    assert.equal(fetches[0].signal.aborted, false);
    await h.runtime.tick(1); assert.equal(fetches[0].signal.aborted, true);
    assert.equal(h.notices.filter(([text]) => text === "jobRefreshing").length, 1);
    await h.runtime.tick(700); assert.equal(fetches.length, 2);
    fetches[1].resolve({ ok: true, json: async () => catalog("recovered") }); await pending;
    assert.equal(h.current.state.version, "recovered"); assert.equal(hasDone(h), true);
    if (hungStage === "fetch") fetches[0].resolve({ ok: true, json: async () => catalog("late") });
    else body.resolve(catalog("late"));
    await tick(); assert.equal(h.current.state.version, "recovered");
    assert.equal(h.runtime.count, 0); assert.deepEqual(h.writes, []);
    assert.deepEqual(fetches.map(({ path }) => path), ["/api/state", "/api/state"]);
  });
}

test("editing cancels and clears only the recovery notice it owns", async () => {
  const h = setup(), pending = complete(h);
  h.reads[0].reject(offline()); await tick();
  assert.equal(h.$("notice").textContent, "jobRefreshing");
  const before = h.notices.length;
  h.edit("keep this draft"); await pending; await h.runtime.tick(60000);
  assert.equal(h.$("notice").textContent, "");
  assert.deepEqual(h.notices.slice(before), [[]]);
  assert.equal(h.current.note, "keep this draft"); assert.equal(h.reads.length, 1);
});

test("cancelling old recovery preserves later unrelated feedback", async () => {
  const h = setup(), pending = complete(h);
  h.reads[0].reject(offline()); await tick();
  assert.equal(h.$("notice").textContent, "jobRefreshing");
  h.feedback("newer save or error feedback"); const before = h.notices.length;
  h.edit("keep this draft"); await pending; await h.runtime.tick(60000);
  assert.equal(h.$("notice").textContent, "newer save or error feedback");
  assert.equal(h.notices.length, before);
  assert.equal(h.current.note, "keep this draft"); assert.equal(h.reads.length, 1);
});
