const POLL_INTERVAL = 700;
const REQUEST_DEADLINE = 8000;
const MAX_RETRY_DELAY = 10000;
const CANCELLED = Symbol("cancelled poll");

// This controller only reads status. Mutations must never be retried here.
export function createJobPoller(
  { read, onSnapshot, onError = () => {}, onCallbackError = () => {} },
  runtime = globalThis,
) {
  let generation = 0, timer = null, pending = null;
  const current = (turn) => turn === generation;
  const clear = () => {
    if (timer !== null) runtime.clearTimeout(timer);
    timer = null;
    if (pending) {
      const previous = pending;
      pending = null;
      // Settle our waiter even when the read ignores its AbortSignal.
      previous.cancel();
      previous.controller.abort();
    }
  };
  const stop = () => {
    generation++;
    clear();
  };
  const callbackFailure = async (error, turn) => {
    if (!current(turn)) return;
    stop();
    // An error reporter must not create an unhandled rejection of its own.
    try { await onCallbackError(error); } catch {}
  };
  const readWithDeadline = () => new Promise((resolve, reject) => {
    const controller = new (runtime.AbortController || globalThis.AbortController)();
    let settled = false, deadline;
    const request = { controller, cancel: () => finish(resolve, CANCELLED) };
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      runtime.clearTimeout(deadline);
      if (pending === request) pending = null;
      settle(value);
    };
    pending = request;
    deadline = runtime.setTimeout(() => {
      const error = new Error("Job status request timed out");
      error.name = "TimeoutError";
      error.code = "network";
      // Record the timeout before abort can reject a cooperative read.
      finish(reject, error);
      controller.abort();
    }, REQUEST_DEADLINE);
    try {
      Promise.resolve(read({ signal: controller.signal })).then(
        (snapshot) => finish(resolve, snapshot),
        (error) => finish(reject, error),
      );
    } catch (error) {
      finish(reject, error);
    }
  });
  const start = ({ restoring = false, delay = 0 } = {}) => {
    stop();
    const turn = generation;
    let failures = 0;
    const schedule = (wait) => {
      if (!current(turn)) return;
      timer = runtime.setTimeout(() => {
        timer = null;
        void poll();
      }, wait);
    };
    const poll = async () => {
      if (!current(turn)) return;
      let snapshot;
      try {
        snapshot = await readWithDeadline();
      } catch (error) {
        if (!current(turn)) return;
        failures++;
        if (failures === 1) {
          try { await onError(error); }
          catch (callbackError) {
            await callbackFailure(callbackError, turn);
            return;
          }
        }
        schedule(Math.min(POLL_INTERVAL * 2 ** Math.min(failures - 1, 4), MAX_RETRY_DELAY));
        return;
      }
      if (!current(turn) || snapshot === CANCELLED) return;
      failures = 0;
      try {
        await onSnapshot(snapshot, { restoring });
      } catch (error) {
        await callbackFailure(error, turn);
        return;
      }
      if (!current(turn)) return;
      restoring = false;
      if (snapshot?.state === "running" || snapshot?.state === "cancelling") {
        schedule(POLL_INTERVAL);
      }
    };
    schedule(Math.max(0, delay));
  };
  return { start, stop };
}
