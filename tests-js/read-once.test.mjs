import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readOnce } from "../src/audio_review_desk/static/read-once.js";
import { errorText } from "../src/audio_review_desk/static/errors.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    AbortController,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    get count() { return timers.size; },
    async tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    },
  };
}
function harness({ read, aborted = false } = {}) {
  const runtime = clock(), controller = new AbortController(), reads = [];
  const listeners = new Set();
  if (aborted) controller.abort();
  const signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(type, callback, options) { listeners.add(callback); controller.signal.addEventListener(type, callback, options); },
    removeEventListener(type, callback) { listeners.delete(callback); controller.signal.removeEventListener(type, callback); },
  };
  const promise = readOnce({ signal, read: read || (args => {
    const wait = deferred(); reads.push({ ...wait, ...args }); return wait.promise;
  }) }, runtime);
  const outcome = promise.then(value => ({ value }), error => ({ error }));
  return { runtime, controller, reads, promise, outcome, listeners };
}

test("one read returns its exact result and removes deadline and abort listener", async () => {
  const h = harness(), value = { items: [] }; h.reads[0].resolve(value);
  assert.equal(await h.promise, value); assert.equal(h.runtime.count, 0); assert.equal(h.listeners.size, 0);
  assert.equal(h.reads[0].signal.aborted, false); h.controller.abort(); await h.runtime.tick(60000);
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].signal.aborted, false);
});

for (const synchronous of [false, true]) test(`one ${synchronous ? "synchronous" : "asynchronous"} failure is preserved without retry`, async () => {
  const error = new Error("failed"); let calls = 0;
  const h = harness({ read() { calls++; if (synchronous) throw error; return Promise.reject(error); } });
  assert.equal((await h.outcome).error, error); await h.runtime.tick(60000);
  assert.equal(calls, 1); assert.equal(h.runtime.count, 0); assert.equal(h.listeners.size, 0);
});

for (const late of ["resolve", "reject"]) test(`timeout settles an abort-ignoring read and observes late ${late}`, async () => {
  const h = harness(); let settled = false; h.outcome.then(() => { settled = true; });
  await h.runtime.tick(7999); assert.equal(settled, false); assert.equal(h.reads[0].signal.aborted, false);
  await h.runtime.tick(1); const error = (await h.outcome).error;
  assert.equal(error.name, "TimeoutError"); assert.equal(error.code, "network"); assert.equal(h.reads[0].signal.aborted, true);
  h.reads[0][late](late === "resolve" ? { stale: true } : new Error("late failure")); await h.runtime.tick(60000);
  assert.equal((await h.outcome).error, error); assert.equal(h.reads.length, 1); assert.equal(h.runtime.count, 0); assert.equal(h.listeners.size, 0);
});

test("timeout wins over a synchronous abort-triggered rejection", async () => {
  const h = harness({ read: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cooperative cancellation")), { once: true });
  }) });
  await h.runtime.tick(8000); assert.equal((await h.outcome).error.name, "TimeoutError");
  assert.equal(h.runtime.count, 0); assert.equal(h.listeners.size, 0);
});

for (const aborted of [true, false]) test(`${aborted ? "prior" : "during-read"} cancellation settles immediately without additional reads`, async () => {
  const h = harness({ aborted }); h.controller.abort();
  assert.equal((await h.outcome).error.name, "AbortError");
  if (!aborted) { assert.equal(h.reads[0].signal.aborted, true); h.reads[0].resolve("late"); }
  await h.runtime.tick(60000); assert.equal(h.reads.length, aborted ? 0 : 1);
  assert.equal(h.runtime.count, 0); assert.equal(h.listeners.size, 0);
});

// Exercise the actual network wrapper, including its fetch and JSON lifecycle.
const source = readFileSync(process.env.ARD_READ_WORKBENCH || new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const requestCode = source.slice(source.indexOf("async function request("), source.indexOf("const post ="));
function network() {
  const runtime = clock(), fetches = [];
  const request = Function("fetch", "errorText", "language", "readOnce", `${requestCode}; return request;`)(
    (path, options) => { const wait = deferred(); fetches.push({ path, options, ...wait }); return wait.promise; },
    errorText, "en", args => readOnce(args, runtime));
  return { runtime, fetches, request };
}
for (const path of ["/api/state", "/api/history/A", "/api/job", "/api/wave/A"]) {
  for (const stage of ["fetch", "body"]) test(`${path} deadline covers pending ${stage} without retry`, async () => {
    const h = network(), body = deferred(), pending = h.request(path), outcome = pending.catch(error => error);
    if (stage === "body") { h.fetches[0].resolve({ ok: true, json: () => body.promise }); await flush(); }
    await h.runtime.tick(8000);
    // Assert before awaiting the outcome so a broken old implementation fails
    // deterministically instead of leaving a dangling test promise.
    assert.equal(h.fetches[0].options.signal.aborted, true);
    assert.equal((await outcome).code, "network"); assert.equal(h.runtime.count, 0);
    if (stage === "fetch") h.fetches[0].resolve({ ok: true, json: async () => "late" }); else body.reject(new Error("late body"));
    await h.runtime.tick(60000); assert.equal(h.fetches.length, 1);
  });
}

test("GET preserves headers/options, forwards cancellation and never modifies the caller's object", async () => {
  const h = network(), controller = new AbortController(), options = { method: "get", signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" };
  const pending = h.request("/api/state", options).catch(error => error);
  assert.equal(h.fetches[0].options.headers, options.headers); assert.equal(h.fetches[0].options.cache, "no-store");
  assert.notEqual(h.fetches[0].options.signal, options.signal); controller.abort();
  assert.equal((await pending).code, "network"); assert.equal(h.fetches[0].options.signal.aborted, true);
  assert.equal(options.signal, controller.signal); assert.equal(h.runtime.count, 0);
  h.fetches[0].reject(new Error("late")); await flush();
});

test("successful GET preserves result and application errors preserve server codes", async () => {
  for (const ok of [true, false]) {
    const h = network(), result = ok ? { items: [] } : { code: "workspace_busy" };
    const pending = h.request("/api/state").then(value => ({ value }), error => ({ error }));
    h.fetches[0].resolve({ ok, json: async () => result }); const outcome = await pending;
    if (ok) assert.equal(outcome.value, result); else assert.equal(outcome.error.code, result.code);
    assert.equal(h.runtime.count, 0);
  }
});

for (const method of ["POST", "post"]) test(`${method} write has no read deadline or automatic retry`, async () => {
  const h = network(), controller = new AbortController(), options = { method, body: "{}", signal: controller.signal };
  let settled = false; const pending = h.request("/api/review", options).then(value => { settled = true; return value; });
  assert.equal(h.fetches[0].options, options); assert.equal(h.runtime.count, 0);
  await h.runtime.tick(60000); assert.equal(settled, false); assert.equal(h.fetches.length, 1); assert.equal(controller.signal.aborted, false);
  const result = { review: { version: 2 } }; h.fetches[0].resolve({ ok: true, json: async () => result });
  assert.equal(await pending, result); assert.equal(h.runtime.count, 0);
});

for (const initial of [null, { workspace_id: 'ready', items: [{ key: 'A' }], stats: { files: 1 } }]) {
  for (const stage of ['fetch', 'body']) test(`${initial ? 'manual' : 'initial'} refresh recovers from stalled ${stage} without accepting late state`, async () => {
    const h = network(), notices = [], nodes = new Map(), body = deferred();
    const $ = id => {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '', querySelector: () => $('bootText') });
      return nodes.get(id);
    };
    const code = source.slice(source.indexOf('let refreshLoadError ='), source.indexOf('function setBusy(value)'));
    const control = Function('request', '$', 'initial', 'captureNotice', 'errorText', `
      let noticeGeneration = 0, noticeResolver = null;
      function notice(message) { noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null; captureNotice(noticeResolver ? noticeResolver() : message); }
      const draftSession = null; // This harness isolates bounded state reads.
      let busy = false, dirty = false, state = initial, selected = initial?.items[0] || null,
        refreshGeneration = 0, refreshController = null, refreshRead = null, suspendedCompletion = null;
      const language = 'en', t = key => key, discardAllowed = async () => true;
      const selectedKeys = new Set(), listeningMemory = { get: () => ({}) },
        sessionStorage = { getItem: () => null }, visibleItems = () => state.items,
        waveformReader = { cancel() {} }, waveformView = { cancelDrag() {} }, spectrumView = { setSource() {}, setVisible() {} };
      function renderSummary() { $('bootStatus').hidden = true; $('retryLoad').hidden = true; }
      function renderQueue() {}
      ${code}
      return { refresh, get current() { return { state, selected, refreshController, refreshRead }; } };
    `)(h.request, $, initial, (...args) => notices.push(args), errorText);
    let settled = false; const pending = control.refresh(true).then(value => { settled = true; return value; });
    await flush(); assert.equal(h.fetches.length, 1); assert.equal(settled, false);
    if (stage === 'body') { h.fetches[0].resolve({ ok: true, json: () => body.promise }); await flush(); }
    await h.runtime.tick(8000); assert.equal(settled, true, 'the actual refresh must terminate on its read deadline');
    assert.equal(await pending, false); assert.equal(control.current.state, initial);
    assert.equal(control.current.selected, initial?.items[0] || null);
    assert.equal(control.current.refreshRead, null); assert.equal(control.current.refreshController, null);
    if (!initial) { assert.equal($('retryLoad').hidden, false); assert.equal($('bootText').textContent, 'loadError'); }
    assert.equal(notices.length, 1); assert.equal(notices[0][0], errorText({ code: 'network' }, 'en'));
    const retry = control.refresh(true), next = { workspace_id: 'new', items: [], stats: { files: 0 } };
    h.fetches[1].resolve({ ok: true, json: async () => next });
    assert.equal(await retry, true); assert.equal(control.current.state, next);
    assert.equal($('bootStatus').hidden, true); assert.equal($('retryLoad').hidden, true);
    if (stage === 'fetch') h.fetches[0].resolve({ ok: true, json: async () => ({ items: [{ key: 'STALE' }] }) });
    else body.resolve({ items: [{ key: 'STALE' }] });
    await flush(); assert.equal(control.current.state, next); assert.equal(h.runtime.count, 0);
  });
}
