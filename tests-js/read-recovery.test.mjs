import test from "node:test";
import assert from "node:assert/strict";
import { readWithRecovery } from "../src/audio_review_desk/static/read-recovery.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const network = () => Object.assign(new Error("offline"), { code: "network" });
function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    AbortController,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    get count() { return timers.size; },
    get nextDelay() { return timers.size ? Math.min(...[...timers.values()].map((t) => t.at)) - now : null; },
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry;
        now = timer.at;
        timers.delete(id);
        timer.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
function harness(options = {}) {
  const runtime = clock(), controller = new AbortController(), reads = [], retries = [];
  let listeners = 0;
  const signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(...args) { listeners++; controller.signal.addEventListener(...args); },
    removeEventListener(...args) { listeners--; controller.signal.removeEventListener(...args); },
  };
  const promise = readWithRecovery({
    signal,
    read(args) { const read = { ...deferred(), ...args }; reads.push(read); return read.promise; },
    onRetry(error) { retries.push(error); },
    ...options,
  }, runtime);
  // Observe immediately so cancellation/error assertions can be made after ticks.
  const outcome = promise.then((value) => ({ value }), (error) => ({ error }));
  return { runtime, controller, reads, retries, promise, outcome, get listeners() { return listeners; } };
}

test("success returns identity with no timers or external listeners", async () => {
  const h = harness(), result = { clips: [] };
  h.reads[0].resolve(result);
  assert.equal(await h.promise, result);
  assert.equal(h.runtime.count, 0);
  assert.equal(h.listeners, 0);
  assert.equal(h.retries.length, 0);
});

test("network recovery caps backoff, notifies once, and only calls the read capability", async () => {
  const calls = [], h = harness({ read(args) { calls.push(args); return Promise.reject(network()); } });
  await flush();
  for (const delay of [700, 1400, 2800, 5600, 10000, 10000, 10000]) {
    assert.equal(h.runtime.nextDelay, delay);
    assert.equal(h.runtime.count, 1);
    assert.equal(h.retries.length, 1);
    const count = calls.length;
    await h.runtime.tick(delay - 1);
    assert.equal(calls.length, count);
    await h.runtime.tick(1);
    assert.equal(calls.length, count + 1);
  }
  for (const args of calls) {
    assert.deepEqual(Object.keys(args), ["signal"]); // No path, body, method, or mutation capability.
    assert.ok(args.signal instanceof AbortSignal);
  }
  assert.notEqual(calls[0].signal, calls[1].signal);
  h.controller.abort();
  assert.equal((await h.outcome).error.name, "AbortError");
  assert.equal(h.runtime.count, 0);
  assert.equal(h.listeners, 0);
});

test("network failure can recover successfully without notifying again", async () => {
  const h = harness();
  h.reads[0].reject(network());
  await flush();
  await h.runtime.tick(700);
  h.reads[1].resolve("catalog");
  assert.equal(await h.promise, "catalog");
  assert.equal(h.retries.length, 1);
  assert.equal(h.runtime.count, 0);
});

test("API, programmer, and unrelated timeout or abort failures never retry", async () => {
  for (const error of [new TypeError("bug"), Object.assign(new Error("API"), { code: "conflict" }),
    Object.assign(new Error("other timeout"), { name: "TimeoutError" }),
    Object.assign(new Error("other abort"), { name: "AbortError" })]) {
    for (const sync of [true, false]) {
      const h = harness({ read() { if (sync) throw error; return Promise.reject(error); } });
      assert.equal((await h.outcome).error, error);
      assert.equal(h.runtime.count, 0);
      assert.equal(h.listeners, 0);
      assert.equal(h.retries.length, 0);
    }
  }
});

test("the deadline covers unresolved fetch and unresolved JSON decode", async () => {
  for (const decoding of [false, true]) {
    const pending = deferred();
    let attemptSignal;
    const h = harness({ read: async ({ signal }) => {
      attemptSignal = signal;
      if (!decoding) return pending.promise;
      const response = await Promise.resolve({ json: () => pending.promise });
      return response.json();
    } });
    await flush();
    await h.runtime.tick(7999);
    assert.equal(h.retries.length, 0);
    await h.runtime.tick(1);
    assert.equal(attemptSignal.aborted, true);
    assert.equal(h.retries[0].name, "TimeoutError");
    assert.equal(h.retries[0].code, "network");
    assert.equal(h.runtime.nextDelay, 700);
    h.controller.abort();
    assert.equal((await h.outcome).error.name, "AbortError");
    pending.reject(new Error("late decode/fetch failure"));
    await flush();
    assert.equal(h.runtime.count, 0);
  }
});

test("deadline wins over synchronous abort-triggered rejection", async () => {
  const h = harness({ read: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }) });
  await h.runtime.tick(8000);
  assert.equal(h.retries[0].name, "TimeoutError");
  assert.equal(h.runtime.nextDelay, 700);
  h.controller.abort();
  await h.outcome;
});

test("external abort during read or backoff settles immediately and ignores late outcomes", async () => {
  for (const backoff of [false, true]) for (const late of ["resolve", "reject"]) {
    const h = harness();
    if (backoff) { h.reads[0].reject(network()); await flush(); }
    h.controller.abort("custom reason must still become AbortError");
    assert.equal((await h.outcome).error.name, "AbortError");
    if (!backoff) assert.equal(h.reads[0].signal.aborted, true);
    assert.equal(h.runtime.count, 0);
    assert.equal(h.listeners, 0);
    h.reads[0][late](late === "resolve" ? "stale catalog" : network());
    await h.runtime.tick(50000);
    assert.equal(h.reads.length, 1);
    assert.equal(h.retries.length, backoff ? 1 : 0);
  }
});

test("late timed-out reads cannot affect a newer successful attempt", async () => {
  for (const late of ["resolve", "reject"]) {
    const h = harness();
    await h.runtime.tick(8700);
    assert.equal(h.reads.length, 2);
    h.reads[0][late](late === "resolve" ? "stale" : network());
    await flush();
    assert.equal(h.runtime.nextDelay, 8000);
    h.reads[1].resolve("current");
    assert.equal(await h.promise, "current");
    assert.equal(h.runtime.count, 0);
    assert.equal(h.listeners, 0);
  }
});

test("already-aborted signals perform no read and allocate no timers", async () => {
  const controller = new AbortController();
  controller.abort();
  const runtime = clock();
  await assert.rejects(readWithRecovery({ signal: controller.signal, read() { assert.fail("unexpected read"); } }, runtime), { name: "AbortError" });
  assert.equal(runtime.count, 0);
});

test("callback throws and rejections are terminal, even with network codes", async () => {
  for (const async of [false, true]) {
    const error = network();
    const h = harness({ onRetry() { if (async) return Promise.reject(error); throw error; } });
    h.reads[0].reject(network());
    assert.equal((await h.outcome).error, error);
    assert.equal(h.runtime.count, 0);
    assert.equal(h.listeners, 0);
    await h.runtime.tick(50000);
    assert.equal(h.reads.length, 1);
  }
});

test("abort while awaiting retry callback ignores its late resolution or rejection", async () => {
  for (const late of ["resolve", "reject"]) {
    const callback = deferred(), h = harness({ onRetry: () => callback.promise });
    h.reads[0].reject(network());
    await flush();
    assert.equal(h.runtime.count, 0);
    h.controller.abort();
    assert.equal((await h.outcome).error.name, "AbortError");
    callback[late](network());
    await h.runtime.tick(50000);
    assert.equal(h.reads.length, 1);
    assert.equal(h.runtime.count, 0);
    assert.equal(h.listeners, 0);
  }
});
