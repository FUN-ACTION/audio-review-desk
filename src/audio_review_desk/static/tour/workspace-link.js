// A static localhost preview is not evidence that a review workspace is running.
// Never probe the visitor's computer from a public website or another origin.
export async function probeLocalWorkspace(runtime = globalThis, timeoutMs = 1500) {
  let url;
  try {
    url = new URL("/api/version", runtime.location?.href);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password ||
      typeof runtime.fetch !== "function" || typeof runtime.AbortController !== "function") return false;
  const controller = new runtime.AbortController();
  let timer, body, reader;
  const cancelBody = (currentReader = reader, currentBody = body) => {
    try {
      const cancellation = currentBody?.locked ? currentReader?.cancel() : currentBody?.cancel();
      Promise.resolve(cancellation).catch(() => {});
    } catch {}
  };
  const releaseReader = currentReader => { try { currentReader?.releaseLock(); } catch {} };
  try {
    const deadline = new Promise(resolve => {
      timer = runtime.setTimeout(() => { controller.abort(); resolve(false); },
        Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1500);
    });
    const request = Promise.resolve(runtime.fetch(url.href, {
      signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
      headers: { Accept: "application/json" },
    })).then(async response => {
      body = response.body;
      // A late response may arrive after a test double or platform ignores abort.
      if (controller.signal.aborted) { cancelBody(); return false; }
      if (!response.ok || response.redirected) return false;
      const length = Number(response.headers?.get("content-length"));
      if (Number.isFinite(length) && length > 4096) return false;
      // Header length is only a hint. Bound actual decoded response-body bytes,
      // including chunked responses and incorrect or omitted Content-Length.
      if (typeof body?.getReader !== "function") return false;
      const currentReader = body.getReader(); reader = currentReader;
      const bytes = new Uint8Array(4096); let size = 0;
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await currentReader.read();
          if (controller.signal.aborted) return false;
          if (done) {
            const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
            return data?.application === "audio-review-desk" &&
              typeof data.version === "string" && data.version.trim().length > 0;
          }
          if (!(value instanceof Uint8Array) || !value.byteLength || size + value.byteLength > bytes.length) return false;
          bytes.set(value, size); size += value.byteLength;
        }
        return false;
      } finally {
        cancelBody(currentReader, body); releaseReader(currentReader);
        if (reader === currentReader) reader = null;
      }
    });
    return await Promise.race([request, deadline]);
  } catch {
    return false;
  } finally {
    runtime.clearTimeout(timer);
    controller.abort(); cancelBody(); releaseReader(reader);
  }
}
