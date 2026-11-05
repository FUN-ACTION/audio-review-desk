import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Execute the actual workbench callbacks with DOM/request doubles. These are
// integration logic checks, not a claim of native browser rendering coverage.
const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const invalidateSource = source.slice(source.indexOf("let refreshLoadError ="), source.indexOf("async function refresh("));
const statusSource = source.slice(source.indexOf("let jobPollError ="), source.indexOf("function markBoundary"));
const rescanReceiptSource = source.slice(source.indexOf("function paintRescanReceipt()"), source.indexOf("for (const name of issueNames)"));
const importResultSource = source.slice(source.indexOf("function clearPreviousImportResult("), source.indexOf("// A native picker can return paths"));
const browseSource = source.slice(source.indexOf("async function browse("), source.indexOf('$("chooseFiles").addEventListener'));
const actionSource = source.slice(source.indexOf('$("cancelImport").addEventListener'), source.indexOf('$("language").addEventListener'));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function setup({ refreshResult = true, post: postImpl, dirty = false } = {}) {
  const elements = new Map(), calls = [], notices = [], starts = [], refreshes = [], reads = [];
  let callbacks, renders = 0;
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: "", checked: false, hidden: false, dataset: {},
      addEventListener(type, callback) { this[type] = callback; }, focus() {} });
    return elements.get(id);
  };
  $("importDialog").open = true;
  const env = {
    $, createJobPoller(options) { callbacks = options; return { start: options => starts.push(options), stop() {} }; },
    request: async (...args) => { reads.push(args); return { state: "idle" }; },
    post: async (...args) => { calls.push(args); return postImpl ? postImpl(...args) : args[0] === "/api/rescan" ? { id: "a".repeat(32), state: "running", phase: "reading", done: 0, total: 0, label: "folder", error: null, error_code: null } : { id: "new", state: "running" }; },
    notice: (...args) => notices.push(args), t: key => key, errorText: error => error.code,
    renderJob: () => { renders++; }, refresh: async (value, { feedback }) => { feedback.owner = { publish: (message, ...args) => notices.push([typeof message === "function" ? message() : message, ...args]) }; refreshes.push(value); return refreshResult; },
    closeDialog(node) { node.open = false; }, dismissImportDialog() { $("importDialog").open = false; }, showImportError: error => notices.push([error.code]), renderSummary() {},
    discardAllowed: async () => true, openImport: async () => {},
  };
  const control = Function(...Object.keys(env), `let refreshController = null, refreshRead = null, pendingCompletion = null, suspendedCompletion = null, refreshGeneration = 0, job = null, handledJob = null, dirty = ${dirty}, busy = false, choosing = false, pickedImport = null, importSubmitting = false, rescanSubmitting = false, importEditGeneration = 0, importDialogGeneration = 0, importDialogClosing = false, noticeGeneration = 0, language = "en";
    const importing = () => job && ["running", "cancelling"].includes(job.state);
    ${rescanReceiptSource}\n${importResultSource}\n${invalidateSource}\n${statusSource}\n${browseSource}\n${actionSource}
    return { acceptJob, startImport, browse, get job() { return job; } };`)(...Object.values(env));
  return { ...control, get job() { return control.job; }, $, calls, notices, starts, refreshes, reads, callbacks, get renders() { return renders; } };
}

test("status reads pass abort signals and accepted POST snapshots replace the observation generation", async () => {
  const h = setup(), signal = new AbortController().signal;
  await h.callbacks.read({ signal });
  assert.deepEqual(h.reads, [["/api/job", { signal }]]);
  const next = { id: "new", state: "running" };
  h.acceptJob(next);
  assert.equal(h.job, next);
  assert.deepEqual(h.starts, [{ delay: 200 }]);
  assert.equal(h.renders, 1);
});

test("restored terminal jobs stay quiet while newly observed completion refreshes exactly once", async () => {
  const h = setup();
  await h.callbacks.onSnapshot({ id: "old", state: "succeeded" }, { restoring: true });
  assert.deepEqual(h.refreshes, []);
  assert.deepEqual(h.notices, []);
  await h.callbacks.onSnapshot({ id: "active", state: "running" }, { restoring: true });
  const done = { id: "active", state: "succeeded" };
  await h.callbacks.onSnapshot(done, { restoring: false });
  await h.callbacks.onSnapshot(done, { restoring: false });
  assert.deepEqual(h.refreshes, [true]);
  assert.deepEqual(h.notices, [["jobDone", true]]);
});

test("completed imports preserve a dirty review draft instead of refreshing it", async () => {
  const h = setup({ dirty: true });
  await h.callbacks.onSnapshot({ id: "done", state: "succeeded" }, { restoring: false });
  assert.deepEqual(h.refreshes, []);
  assert.deepEqual(h.notices, [["refreshDraft", true]]);
});

test("failed catalog refreshes do not replace the error with a false completion notice", async () => {
  const h = setup({ refreshResult: false });
  await h.callbacks.onSnapshot({ id: "done", state: "succeeded" }, { restoring: false });
  assert.deepEqual(h.refreshes, [true]);
  assert.deepEqual(h.notices, []);
});

test("a delayed completion refresh cannot announce success over a newer accepted job", async () => {
  const wait = deferred(), h = setup({ refreshResult: wait.promise });
  const completion = h.callbacks.onSnapshot({ id: "old", state: "succeeded" }, { restoring: false });
  h.acceptJob({ id: "new", state: "running" });
  wait.resolve(true); await completion;
  assert.equal(h.job.id, "new");
  assert.deepEqual(h.notices, []);
});

test("manual import posts once and hands its accepted snapshot to the watcher", async () => {
  const h = setup();
  h.$("importKind").value = "files";
  h.$("importPath").value = " /audio/a.wav \n\n /audio/b.wav ";
  h.$("appendImport").checked = true;
  await h.startImport({ preventDefault() {} });
  assert.deepEqual(h.calls, [["/api/import", { kind: "files", path: ["/audio/a.wav", "/audio/b.wav"], append: true }]]);
  assert.equal(h.job.id, "new");
  assert.deepEqual(h.starts, [{ delay: 200 }]);
});

test("native picker imports and rescans both start observation without replaying mutations", async () => {
  const h = setup({ post: async path => path === "/api/browse" ? { path: ["/audio/a.wav"] } : { id: "picked", state: "running" } });
  await h.browse("files", true);
  assert.deepEqual(h.calls.map(([path]) => path), ["/api/browse", "/api/import"]);
  assert.equal(h.job.id, "picked");
  assert.deepEqual(h.starts, [{ delay: 200 }]);
  const rescan = setup();
  await rescan.$("rescan").click();
  assert.deepEqual(rescan.calls, [["/api/rescan", {}]]);
  assert.deepEqual(rescan.starts, [{ delay: 200 }]);
});

test("both accepted and failed cancellation resume status reads without repeating the POST", async () => {
  for (const failed of [false, true]) {
    const h = setup({ post: async () => {
      if (failed) throw { code: "import_finished" };
      return { id: "running", state: "cancelling" };
    } });
    h.acceptJob({ id: "running", state: "running" });
    await h.$("cancelImport").click();
    assert.deepEqual(h.calls, [["/api/cancel-import", { id: "running" }]]);
    assert.equal(h.starts.length, 2);
    assert.deepEqual(h.starts[1], failed ? undefined : { delay: 200 });
    assert.equal(h.job.state, failed ? "running" : "cancelling");
  }
});

test("page cache lifecycle stops observation and resumes without hiding an active job's completion", () => {
  const code = source.slice(source.indexOf('window.addEventListener("pagehide", (event)'), source.indexOf('document.addEventListener("visibilitychange", () => {\n  spectrumView'));
  const listeners = {}, starts = []; let stops = 0;
  const invoke = Function("window", "jobPoller", "audition", "spectrumView", "job", "spectrumVisible", "selected", "$", `const draftSession = null; // Reload-draft behavior has its own integration suite.
const waveformReader = { cancel() {} }; let refreshRead=null, refreshGeneration=0, dirty=false, pendingCompletion=null, suspendedCompletion=null; const invalidateRefresh=()=>{refreshGeneration++;}; ${code}`);
  const run = job => invoke({ addEventListener: (type, fn) => { listeners[type] = fn; } },
    { stop: () => { stops++; }, start: options => starts.push(options) }, { cancel() {} },
    { setVisible() {}, dispose() {} }, job, false, null, () => ({ hidden: true }));
  run({ id: "active", state: "running" });
  listeners.pagehide({ persisted: true }); listeners.pageshow({ persisted: true });
  assert.equal(stops, 1); assert.deepEqual(starts, [{ restoring: false }]);
  run(null); listeners.pageshow({ persisted: true });
  assert.deepEqual(starts[1], { restoring: true });
});

test("actual refresh reports a failed read and busy skip as false", async () => {
  const code = source.slice(source.indexOf("let refreshLoadError ="), source.indexOf("function setBusy"));
  const notices = [], env = { noticeGeneration: 0, noticeResolver: null, refreshGeneration: 0, refreshController: null, refreshRead: null, suspendedCompletion: null, dirty: false, state: null, selected: null, busy: false, discardAllowed: async () => true,
    request: async () => { throw { code: "network" }; }, notice: error => notices.push(typeof error === "function" ? error() : error),
    errorText: error => error.code, language: "en", t: key => key,
    $: () => ({ querySelector: () => ({}) }) };
  const refresh = Function(...Object.keys(env), `${code}; return refresh;`)(...Object.values(env));
  assert.equal(await refresh(true), false);
  assert.deepEqual(notices, ["network"]);
  env.busy = true;
  const busyRefresh = Function(...Object.keys(env), `${code}; return refresh;`)(...Object.values(env));
  assert.equal(await busyRefresh(true), false);
  assert.deepEqual(notices, ["network"]);
});
