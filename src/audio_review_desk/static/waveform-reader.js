// One bounded read of the current clip's stored peaks. Never retries a request
// automatically and never loads media or changes a review.
export function createWaveformReader({ read, onChange }, runtime = globalThis) {
  let active = null;
  // The workbench renders synchronously. A rendering failure must not strand
  // the read promise or become an unobserved rejection of its read handler.
  const notify = (snapshot) => {
    try { onChange(snapshot); return true; }
    catch (error) {
      // A ready callback may fail while painting peaks. Its error branch does
      // not paint them and can still expose Retry. Make only one best effort.
      if (snapshot.phase === "loading" || snapshot.phase === "ready") {
        try { onChange({ key: snapshot.key, selection: snapshot.selection, phase: "error", error }); }
        catch {}
      }
      return false;
    }
  };
  const cancel = (announce = true) => {
    if (!active) return;
    const attempt = active;
    active = null;
    runtime.clearTimeout(attempt.timer);
    attempt.resolve(false);
    attempt.controller.abort();
    if (announce) notify({ ...attempt.owner, phase: "interrupted" });
  };
  return {
    load({ key, selection }) {
      if (active?.owner.key === key && active.owner.selection === selection)
        return active.promise;
      cancel(false);
      const controller = new (runtime.AbortController || AbortController)();
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      const attempt = { owner: { key, selection }, controller, promise, resolve, timer: null };
      active = attempt;
      const settle = (phase, value) => {
        if (active !== attempt) return;
        active = null;
        runtime.clearTimeout(attempt.timer);
        const rendered = notify({ ...attempt.owner, phase, ...(phase === "ready" ? { data: value } : { error: value }) });
        resolve(phase === "ready" && rendered);
        if (!rendered) controller.abort();
      };
      attempt.timer = runtime.setTimeout(() => {
        const error = Object.assign(new Error("Waveform read timed out"), { code: "network" });
        // Claim the timeout before a cooperative abort rejects the read.
        settle("error", error);
        controller.abort();
      }, 8000);
      if (!notify({ ...attempt.owner, phase: "loading" })) {
        cancel(false);
        return promise;
      }
      try {
        // read() includes JSON decoding, so the deadline covers the whole body.
        Promise.resolve(read(key, { signal: controller.signal })).then((data) => {
          if (active !== attempt) return;
          if (![data?.a, data?.b].every((samples) => Array.isArray(samples) &&
              samples.every((sample) => typeof sample === "number" && Number.isFinite(sample)))) {
            settle("error", new Error("Invalid waveform response"));
          } else settle("ready", data);
        }, (error) => settle("error", error));
      } catch (error) { settle("error", error); }
      return promise;
    },
    cancel,
  };
}
