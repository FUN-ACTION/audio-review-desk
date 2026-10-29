import { analyzeSpectrogram, spectrumColor, SPECTRUM_LIMITS } from "./spectrum-math.js";

const TEXT = {
  zh: {
    waiting: "选择音频后查看频谱", loading: "正在生成频谱…", ready: "频谱 · 80 Hz 起 · −90 至 0 dBFS",
    unavailable: "当前浏览器无法读取音频频谱", failed: "无法生成频谱，请重新选择此音频",
    large: "试听文件超过 32 MiB，请查看波形", empty: "此音频没有可分析的采样",
    capped: "仅分析前 2 分钟", beyond: "当前区间超出已分析范围", label: "音频频谱",
  },
  en: {
    waiting: "Choose audio to view its spectrum", loading: "Building spectrum…", ready: "Spectrum · from 80 Hz · −90 to 0 dBFS",
    unavailable: "Audio spectrum is unavailable in this browser", failed: "Spectrum could not load. Select this audio again.",
    large: "Preview exceeds 32 MiB. Use the waveform view.", empty: "This audio has no samples to analyze",
    capped: "First 2 minutes analyzed", beyond: "This range is outside the analyzed audio", label: "Audio spectrogram",
  },
};

export function mediaPreviewURL(value, base = globalThis.location?.href) {
  try {
    const resolved = new URL(value, base), origin = new URL(base).origin;
    if (resolved.origin !== origin || resolved.username || resolved.password ||
        resolved.search || resolved.hash || !/^\/media\/[a-f0-9]{64}\/[ab]\.wav$/.test(resolved.pathname)) return null;
    return resolved.href;
  } catch { return null; }
}

export async function readBoundedAudio(response, signal, maxBytes = SPECTRUM_LIMITS.bytes) {
  if (!response.ok) throw new Error("http");
  const declared = Number(response.headers?.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("large");
  }
  if (signal.aborted) throw new Error("cancelled");
  if (!response.body?.getReader) {
    const data = await response.arrayBuffer();
    if (data.byteLength > maxBytes) throw new Error("large");
    if (signal.aborted) throw new Error("cancelled");
    return data;
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error("large");
      chunks.push(value);
    }
    if (signal.aborted) throw new Error("cancelled");
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally { reader.releaseLock?.(); }
}

export function mountSpectrogram({ canvas, status, onSeek, language = "zh", alignWaveform = false }, runtime = globalThis) {
  let lang = TEXT[language] ? language : "en", visible = false, disposed = false;
  let source = null, cache = null, image = null, request = null, generation = 0;
  let decoder = null;
  const closedDecoders = new WeakSet();
  let phase = "waiting", error = null;
  let view = { start: 0, end: 0, duration: 0 };
  const text = key => TEXT[lang][key];
  const ctx = canvas.getContext("2d");
  canvas.setAttribute("aria-label", text("label"));
  canvas.tabIndex = onSeek ? 0 : -1;
  if (onSeek) canvas.setAttribute("role", "slider");
  async function closeDecoder(context) {
    if (!context || closedDecoders.has(context)) return;
    closedDecoders.add(context);
    try { await context.close(); } catch {}
  }
  function cancelRequest() {
    generation++; request?.abort(); request = null;
    const oldDecoder = decoder; decoder = null;
    closeDecoder(oldDecoder);
  }

  function inform() {
    let message = text(error || phase);
    if (cache) {
      message = text("ready");
      if (cache.fullDuration > cache.seconds + 0.001) message += " · " + text("capped");
      if (view.start >= cache.seconds) message += " · " + text("beyond");
    }
    if (status) status.textContent = message;
    canvas.dataset.state = error ? "error" : phase;
  }
  function clear() {
    if (!ctx) return;
    ctx.fillStyle = "#081121"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  function paint() {
    inform();
    if (!visible || disposed || !ctx) return;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(runtime.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    clear();
    if (!cache || !image) return;
    const start = Math.max(0, view.start), end = Math.max(start, view.end || cache.fullDuration);
    if (end <= start) return;
    if (onSeek) {
      canvas.setAttribute("aria-valuemin", String(start));
      canvas.setAttribute("aria-valuemax", String(end));
      canvas.setAttribute("aria-valuenow", String(start));
      canvas.setAttribute("aria-valuetext", `${start.toFixed(2)} s`);
    }
    const analyzedEnd = Math.min(end, cache.seconds);
    // In waveform-overlay mode, every horizontal pixel has exactly the same
    // time mapping as the waveform selection, seek control and playhead.
    const padding = alignWaveform ? { left: 0, right: 0, top: 0, bottom: 0 } :
      { left: 42 * ratio, right: 8 * ratio, top: 12 * ratio, bottom: 24 * ratio };
    const width = canvas.width - padding.left - padding.right, height = canvas.height - padding.top - padding.bottom;
    if (width <= 0 || height <= 0) return;
    if (analyzedEnd > start) {
      const x = start / cache.seconds * cache.columns;
      const sourceWidth = (analyzedEnd - start) / cache.seconds * cache.columns;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(image, x, 0, sourceWidth, cache.rows, padding.left, padding.top,
        (analyzedEnd - start) / (end - start) * width, height);
    }
    ctx.font = `${10 * ratio}px system-ui, sans-serif`;
    ctx.fillStyle = "#aabbd0";
    ctx.textBaseline = "middle";
    for (const hz of [100, 1000, 4000, 10000]) {
      if (hz < cache.minHz || hz > cache.maxHz) continue;
      const normalized = Math.log(hz / cache.minHz) / Math.log(cache.maxHz / cache.minHz);
      const y = padding.top + height * (1 - normalized);
      ctx.fillText(hz < 1000 ? `${hz}` : `${hz / 1000}k`, 7 * ratio, y);
      ctx.fillStyle = "#d0dded12"; ctx.fillRect(padding.left, y, width, ratio); ctx.fillStyle = "#aabbd0";
    }
    if (!alignWaveform) {
      ctx.textBaseline = "bottom";
      ctx.fillText(`${start.toFixed(2)} s`, padding.left, canvas.height - 3 * ratio);
      const endText = `${end.toFixed(2)} s`;
      ctx.fillText(endText, canvas.width - padding.right - ctx.measureText(endText).width, canvas.height - 3 * ratio);
    }
  }
  function makeImage(data) {
    const layer = canvas.ownerDocument.createElement("canvas");
    layer.width = data.columns; layer.height = data.rows;
    const target = layer.getContext("2d");
    if (!target) throw new Error("unavailable");
    const pixels = target.createImageData(data.columns, data.rows);
    const colors = Array.from({ length: 256 }, (_, value) => spectrumColor(value));
    for (let x = 0; x < data.columns; x++) for (let y = 0; y < data.rows; y++) {
      const offset = ((data.rows - y - 1) * data.columns + x) * 4;
      pixels.data.set(colors[data.data[x * data.rows + y]], offset);
      pixels.data[offset + 3] = 255;
    }
    target.putImageData(pixels, 0, 0);
    return layer;
  }
  async function load() {
    if (!visible || disposed || !source || cache || request || error) { paint(); return; }
    const Context = runtime.AudioContext || runtime.webkitAudioContext;
    if (!ctx || !Context) { error = "unavailable"; paint(); return; }
    const token = generation, controller = new AbortController();
    request = controller; phase = "loading"; paint();
    let audioContext = null;
    const stale = () => disposed || generation !== token || controller.signal.aborted;
    try {
      const response = await runtime.fetch(source.url, { signal: controller.signal, credentials: "same-origin" });
      const bytes = await readBoundedAudio(response, controller.signal);
      if (stale()) return;
      audioContext = new Context();
      decoder = audioContext;
      const decoded = await audioContext.decodeAudioData(bytes);
      if (stale()) return;
      if (!decoded.length || !(decoded.sampleRate > 0) || !decoded.numberOfChannels) throw new Error("empty");
      if (decoded.numberOfChannels > 8) throw new Error("unavailable");
      const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * SPECTRUM_LIMITS.seconds));
      const samples = new Float32Array(length);
      // Analyze channel energy instead of a mono sum, so opposite-phase channels
      // cannot cancel. Each time-frequency cell takes the strongest channel.
      const channels = Math.min(decoded.numberOfChannels, 8);
      let combined = null;
      for (let channel = 0; channel < channels; channel++) {
        samples.set(decoded.getChannelData(channel).subarray(0, length));
        const result = await analyzeSpectrogram(samples, decoded.sampleRate, {
          cancelled: stale,
          yieldControl: () => new Promise(resolve => runtime.setTimeout(resolve, 0)),
        });
        if (!result || stale()) return;
        if (!combined) combined = result;
        else for (let i = 0; i < result.data.length; i++) combined.data[i] = Math.max(combined.data[i], result.data[i]);
      }
      combined.fullDuration = decoded.duration;
      if (stale()) return;
      const rendered = makeImage(combined);
      cache = combined; image = rendered; phase = "ready"; error = null;
    } catch (failure) {
      if (!stale()) { error = TEXT[lang][failure.message] ? failure.message : "failed"; phase = "waiting"; }
    } finally {
      await closeDecoder(audioContext);
      if (decoder === audioContext) decoder = null;
      if (request === controller) request = null;
      if (!stale()) paint();
    }
  }
  const click = event => {
    if (!onSeek || !cache || !visible) return;
    const box = canvas.getBoundingClientRect(), left = alignWaveform ? 0 : 42;
    const width = box.width - (alignWaveform ? 0 : 50);
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left - left) / Math.max(1, width)));
    const seconds = view.start + fraction * ((view.end || cache.fullDuration) - view.start);
    canvas.setAttribute("aria-valuenow", String(seconds));
    canvas.setAttribute("aria-valuetext", `${seconds.toFixed(2)} s`);
    onSeek(seconds);
  };
  const keydown = event => {
    if (!onSeek || !cache || !visible) return;
    const start = view.start, end = view.end || cache.fullDuration;
    const current = Number(canvas.getAttribute("aria-valuenow")) || start;
    const step = event.shiftKey ? 5 : 0.1;
    const next = event.key === "Home" ? start : event.key === "End" ? end :
      event.key === "ArrowLeft" ? Math.max(start, current - step) :
      event.key === "ArrowRight" ? Math.min(end, current + step) : null;
    if (next === null) return;
    event.preventDefault();
    canvas.setAttribute("aria-valuenow", String(next));
    canvas.setAttribute("aria-valuetext", `${next.toFixed(2)} s`);
    onSeek(next);
  };
  canvas.addEventListener("click", click);
  canvas.addEventListener("keydown", keydown);
  const resize = typeof runtime.ResizeObserver === "function" ? new runtime.ResizeObserver(paint) : null;
  resize?.observe(canvas);
  inform();
  return {
    setSource(url, identity = url) {
      const resolved = url ? mediaPreviewURL(url, runtime.location?.href) : null;
      if (source?.url === resolved && source?.identity === identity) return;
      cancelRequest();
      source = resolved ? { url: resolved, identity } : null;
      cache = null; image = null; phase = "waiting"; error = url && !resolved ? "failed" : null;
      clear(); inform(); load();
    },
    setView(next) {
      view = { start: Math.max(0, Number(next.start) || 0), end: Math.max(0, Number(next.end) || 0),
        duration: Math.max(0, Number(next.duration) || 0) };
      paint();
    },
    setVisible(value) {
      visible = Boolean(value); canvas.hidden = !visible;
      if (!visible && request) {
        cancelRequest(); phase = "waiting";
      }
      if (visible) load();
    },
    setLanguage(value) { lang = TEXT[value] ? value : "en"; canvas.setAttribute("aria-label", text("label")); paint(); },
    dispose() {
      disposed = true; cancelRequest();
      cache = null; image = null; resize?.disconnect();
      canvas.removeEventListener("click", click); canvas.removeEventListener("keydown", keydown);
    },
  };
}
