const READ_DEADLINE = 8000;
const RETRY_DELAYS = [700, 1400, 2800, 5600, 10000];

// Only for read-only completed-import catalog refreshes. The caller owns the
// GET and its JSON decoding; mutations must never be passed to this helper.
export async function readWithRecovery(
  { read, signal, onRetry = () => {} },
  runtime = globalThis,
) {
  return new Promise((resolve, reject) => {
    let done = false, timer = null, active = null, failures = 0;
    const clearTimer = () => {
      if (timer !== null) runtime.clearTimeout(timer);
      timer = null;
    };
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      clearTimer();
      signal?.removeEventListener("abort", cancel);
      active = null;
      settle(value);
    };
    const cancel = () => {
      const controller = active;
      const error = new Error("Catalog refresh aborted");
      error.name = "AbortError";
      // Settle independently of whether the supplied read honors cancellation.
      finish(reject, error);
      controller?.abort();
    };
    const schedule = () => {
      if (done) return;
      const delay = RETRY_DELAYS[Math.min(failures - 1, RETRY_DELAYS.length - 1)];
      timer = runtime.setTimeout(() => { timer = null; attempt(); }, delay);
    };
    const failed = (error) => {
      if (done) return;
      if (error?.code !== "network") { finish(reject, error); return; }
      failures++;
      if (failures !== 1) { schedule(); return; }
      // Callback failures are terminal, even if they resemble network errors.
      // Observe async callbacks too, including those settling after cancellation.
      try {
        Promise.resolve(onRetry(error)).then(schedule, (error) => finish(reject, error));
      } catch (error) { finish(reject, error); }
    };
    const attempt = () => {
      if (done) return;
      const controller = new (runtime.AbortController || globalThis.AbortController)();
      active = controller;
      let settled = false;
      const settleAttempt = (success, value) => {
        if (done || settled) return;
        settled = true;
        clearTimer();
        active = null;
        if (success) finish(resolve, value);
        else failed(value);
      };
      timer = runtime.setTimeout(() => {
        const error = new Error("Catalog refresh timed out");
        error.name = "TimeoutError";
        error.code = "network";
        // Claim the outcome before abort can reject a cooperative read.
        settleAttempt(false, error);
        controller.abort();
      }, READ_DEADLINE);
      try {
        Promise.resolve(read({ signal: controller.signal })).then(
          (value) => settleAttempt(true, value),
          (error) => settleAttempt(false, error),
        );
      } catch (error) { settleAttempt(false, error); }
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    attempt();
  });
}
