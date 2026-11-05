import test from "node:test";
import assert from "node:assert/strict";
import { createJobPoller } from "../src/audio_review_desk/static/job-poller.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    AbortController,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    get count() { return timers.size; },
    get nextDelay() { return timers.size ? Math.min(...[...timers.values()].map((t) => t.at)) - now : null; },
    async tick(ms = 0) {
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
function harness(callbacks = {}) {
  const runtime = clock(), reads = [], snapshots = [], errors = [], callbackErrors = [];
  const poller = createJobPoller({
    read({ signal }) { const read = { ...deferred(), signal }; reads.push(read); return read.promise; },
    onSnapshot(snapshot, context) { snapshots.push({ snapshot, ...context }); },
    onError(error) { errors.push(error); },
    onCallbackError(error) { callbackErrors.push(error); },
    ...callbacks,
  }, runtime);
  return { runtime, reads, snapshots, errors, callbackErrors, ...poller };
}

test("outages retry with capped backoff, notify once, and reset on recovery", async () => {
  const h = harness();
  h.start();
  await h.runtime.tick();
  for (const delay of [700, 1400, 2800, 5600, 10000, 10000, 10000]) {
    h.reads.at(-1).reject(new Error("offline"));
    await flush();
    assert.equal(h.runtime.count, 1);
    assert.equal(h.runtime.nextDelay, delay);
    assert.equal(h.errors.length, 1);
    await h.runtime.tick(delay);
  }
  h.reads.at(-1).resolve({ state: "running" });
  await flush();
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.runtime.nextDelay, 700);
  await h.runtime.tick(700);
  h.reads.at(-1).reject(new Error("new outage"));
  await flush();
  assert.equal(h.errors.length, 2);
  assert.equal(h.runtime.nextDelay, 700);
  h.stop();
  assert.equal(h.runtime.count, 0);
});

test("healthy active states poll once; every terminal or idle state stops", async () => {
  for (const state of ["idle", "succeeded", "failed", "cancelled"]) {
    const h = harness();
    h.start();
    await h.runtime.tick();
    for (const active of ["running", "cancelling"]) {
      h.reads.at(-1).resolve({ state: active });
      await flush();
      assert.equal(h.runtime.count, 1);
      await h.runtime.tick(699);
      const count = h.reads.length;
      await h.runtime.tick(1);
      assert.equal(h.reads.length, count + 1);
    }
    h.reads.at(-1).resolve({ state });
    await flush();
    assert.equal(h.runtime.count, 0);
    await h.runtime.tick(100000);
    assert.equal(h.reads.length, 3);
  }
});

test("stop cancels scheduled reads and deadlines and silences late resolve/reject", async () => {
  for (const settle of ["resolve", "reject"]) {
    const h = harness();
    h.start({ delay: 200 });
    h.stop();
    await h.runtime.tick(200);
    assert.equal(h.reads.length, 0);
    h.start();
    await h.runtime.tick();
    const old = h.reads[0];
    h.stop();
    assert.equal(old.signal.aborted, true);
    assert.equal(h.runtime.count, 0);
    old[settle](settle === "resolve" ? { state: "running" } : new Error("late"));
    await flush();
    await h.runtime.tick(100000);
    assert.deepEqual(h.snapshots, []);
    assert.deepEqual(h.errors, []);
    assert.equal(h.reads.length, 1);
  }
});

test("restart invalidates old reads, errors, deadlines and pending timers", async () => {
  for (const settle of ["resolve", "reject"]) {
    const h = harness();
    h.start();
    await h.runtime.tick();
    const old = h.reads[0];
    h.start({ delay: 200 });
    h.start({ delay: 300 });
    assert.equal(old.signal.aborted, true);
    assert.equal(h.runtime.count, 1);
    await h.runtime.tick(300);
    h.reads[1].resolve({ state: "running", id: "new" });
    await flush();
    old[settle](settle === "resolve" ? { state: "failed", id: "old" } : new Error("old"));
    await flush();
    assert.deepEqual(h.snapshots.map((s) => s.snapshot.id), ["new"]);
    assert.deepEqual(h.errors, []);
    assert.equal(h.runtime.count, 1);
    assert.equal(h.runtime.nextDelay, 700);
    h.stop();
  }
});

test("deadline retries reads that ignore abort and discards their eventual results", async () => {
  for (const settle of ["resolve", "reject"]) {
    const h = harness();
    h.start();
    await h.runtime.tick();
    const old = h.reads[0];
    await h.runtime.tick(7999);
    assert.equal(h.errors.length, 0);
    await h.runtime.tick(1);
    assert.equal(h.errors[0].name, "TimeoutError");
    assert.equal(h.errors[0].code, "network");
    assert.equal(old.signal.aborted, true);
    assert.equal(h.runtime.nextDelay, 700);
    await h.runtime.tick(700);
    h.reads[1].resolve({ state: "succeeded" });
    await flush();
    old[settle](settle === "resolve" ? { state: "running" } : new Error("late"));
    await flush();
    assert.equal(h.snapshots.length, 1);
    assert.equal(h.errors.length, 1);
    assert.equal(h.runtime.count, 0);
  }
});

test("timeout stays a timeout when abort immediately rejects the read", async () => {
  const h = harness({ read({ signal }) {
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("abort"))));
  } });
  h.start();
  await h.runtime.tick(8000);
  assert.equal(h.errors[0].name, "TimeoutError");
  assert.equal(h.runtime.nextDelay, 700);
  h.stop();
});

test("restoration survives outages but is consumed by first accepted snapshot", async () => {
  for (const initial of ["idle", "succeeded", "running", "cancelling"]) {
    const h = harness();
    h.start({ restoring: true });
    await h.runtime.tick();
    h.reads[0].reject(new Error("offline"));
    await flush();
    await h.runtime.tick(700);
    h.reads[1].resolve({ state: initial });
    await flush();
    assert.equal(h.snapshots[0].restoring, true);
    if (["running", "cancelling"].includes(initial)) {
      await h.runtime.tick(700);
      h.reads[2].resolve({ state: "succeeded" });
      await flush();
      assert.equal(h.snapshots[1].restoring, false);
    }
    assert.equal(h.runtime.count, 0);
  }
});

test("snapshot callback errors halt without network notices or retries", async () => {
  for (const asynchronous of [false, true]) {
    const error = new Error("render failed");
    const h = harness({ onSnapshot() { if (asynchronous) return Promise.reject(error); throw error; } });
    h.start();
    await h.runtime.tick();
    h.reads[0].resolve({ state: "running" });
    await flush();
    assert.deepEqual(h.callbackErrors, [error]);
    assert.deepEqual(h.errors, []);
    assert.equal(h.runtime.count, 0);
  }
});

test("error callback failures are programmer failures and reporting rejection is contained", async () => {
  for (const asynchronous of [false, true]) {
    const error = new Error("notice failed"), reported = [];
    const h = harness({
      onError() { if (asynchronous) return Promise.reject(error); throw error; },
      onCallbackError(value) { reported.push(value); return Promise.reject(new Error("report failed")); },
    });
    h.start();
    await h.runtime.tick();
    h.reads[0].reject(new Error("offline"));
    await flush();
    assert.deepEqual(reported, [error]);
    assert.equal(h.runtime.count, 0);
  }
});

test("async snapshot callback is serialized and stop/restart silences its later failure", async () => {
  const callback = deferred();
  const h = harness({ onSnapshot: () => callback.promise });
  h.start();
  await h.runtime.tick();
  h.reads[0].resolve({ state: "running" });
  await flush();
  assert.equal(h.runtime.count, 0);
  await h.runtime.tick(30000);
  assert.equal(h.reads.length, 1);
  h.start();
  await h.runtime.tick();
  callback.reject(new Error("obsolete callback"));
  await flush();
  assert.deepEqual(h.callbackErrors, []);
  assert.equal(h.reads[1].signal.aborted, false);
  h.stop();
});

test("restarting inside callbacks cannot schedule an obsolete chain", async () => {
  for (const callback of ["onSnapshot", "onError"]) {
    let h;
    h = harness({ [callback]: async () => { h.start({ delay: 123 }); } });
    h.start();
    await h.runtime.tick();
    if (callback === "onSnapshot") h.reads[0].resolve({ state: "running" });
    else h.reads[0].reject(new Error("offline"));
    await flush();
    assert.equal(h.runtime.count, 1);
    assert.equal(h.runtime.nextDelay, 123);
    await h.runtime.tick(123);
    assert.equal(h.reads.length, 2);
    h.stop();
  }
});

test("synchronous read failures use the same bounded retry path", async () => {
  const h = harness({ read() { throw new Error("read failed synchronously"); } });
  h.start();
  await h.runtime.tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.runtime.nextDelay, 700);
  await h.runtime.tick(700);
  assert.equal(h.errors.length, 1);
  assert.equal(h.runtime.nextDelay, 1400);
  h.stop();
});
