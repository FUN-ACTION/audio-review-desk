// One bounded read, including body decoding. No retries and no write capability.
// Settle independently of whether the underlying transport honors cancellation.
export function readOnce({ read, signal }, runtime = globalThis) {
  return new Promise((resolve, reject) => {
    const controller = new (runtime.AbortController || AbortController)();
    let done = false, timer = null;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      if (timer !== null) runtime.clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      settle(value);
    };
    const cancel = () => {
      const error = Object.assign(new Error("Read interrupted"), { name: "AbortError", code: "network" });
      finish(reject, error);
      controller.abort();
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    timer = runtime.setTimeout(() => {
      const error = Object.assign(new Error("Read timed out"), { name: "TimeoutError", code: "network" });
      // Claim timeout before abort can synchronously reject a cooperative read.
      finish(reject, error);
      controller.abort();
    }, 8000);
    try {
      Promise.resolve(read({ signal: controller.signal })).then(
        value => finish(resolve, value),
        error => finish(reject, error),
      );
    } catch (error) { finish(reject, error); }
  });
}
