import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createSpectrumAnalyzer, logFrequencyBins, spectrumLevels,
  analyzeSpectrogram, spectrumColor, SPECTRUM_LIMITS,
} from "../src/audio_review_desk/static/spectrum-math.js";
import {
  mountSpectrogram, mediaPreviewURL, readBoundedAudio,
} from "../src/audio_review_desk/static/spectrogram.js";

const URL_A = `/media/${"a".repeat(64)}/a.wav`;
const URL_B = `/media/${"b".repeat(64)}/b.wav`;
const samples = (hz, rate = 16000, count = 16000) =>
  Float32Array.from({ length: count }, (_, n) => Math.sin(2 * Math.PI * hz * n / rate));

test("Hann FFT finds a real 1 kHz sine at its correct frequency and amplitude", () => {
  const magnitude = createSpectrumAnalyzer(1024)(samples(1000));
  const peak = magnitude.indexOf(Math.max(...magnitude));
  assert.equal(peak * 16000 / 1024, 1000);
  assert.ok(Math.abs(magnitude[peak] - 1) < 0.001);
  assert.ok(magnitude[peak] > magnitude[peak - 8] * 1000);
});

test("silence stays at the absolute dB floor instead of being auto-brightened", () => {
  const magnitude = createSpectrumAnalyzer()(new Float32Array(1024));
  const { bins } = logFrequencyBins(16000);
  const levels = spectrumLevels(magnitude, bins);
  assert.ok([...magnitude].every(Number.isFinite));
  assert.ok([...levels].every(value => value === 0));
  assert.deepEqual(spectrumColor(0), [8, 17, 33]);
  assert.deepEqual(spectrumColor(255), [246, 242, 210]);
});

test("a -20 dBFS sine keeps its measured level and the scale stops at Nyquist", () => {
  const mono = samples(1000).map(value => value * 0.1);
  const magnitude = createSpectrumAnalyzer()(mono);
  const db = 20 * Math.log10(magnitude[64]);
  assert.ok(Math.abs(db + 20) < 0.01);
  const scale = logFrequencyBins(16000);
  assert.equal(scale.low, 80); assert.equal(scale.high, 8000);
  assert.equal(scale.bins.at(-1), 512);
});

test("analysis respects a short time bound and returns real nonempty frequency data", async () => {
  const result = await analyzeSpectrogram(samples(1000), 16000, {
    columns: 16, rows: 32, maxSeconds: 0.5, yieldControl: async () => {},
  });
  assert.equal(result.seconds, 0.5); assert.equal(result.fullDuration, 1);
  assert.equal(result.data.length, 16 * 32);
  assert.ok(result.data.some(value => value > 150));
  await assert.rejects(analyzeSpectrogram(new Float32Array(1), 16000, { columns: 513 }), RangeError);
  assert.throws(() => createSpectrumAnalyzer(1000), RangeError);
});

test("cooperative cancellation stops analysis before the next batch", async () => {
  let cancelled = false, yields = 0;
  const result = await analyzeSpectrogram(samples(1000), 16000, {
    cancelled: () => cancelled,
    yieldControl: async () => { yields++; cancelled = true; },
  });
  assert.equal(result, null); assert.equal(yields, 1);
});

test("only normalized same-origin preview routes can be analyzed", () => {
  const base = "http://127.0.0.1:8765/";
  assert.equal(mediaPreviewURL(URL_A, base), base.slice(0, -1) + URL_A);
  for (const path of ["https://example.com" + URL_A, "/api/export", URL_A + "?token=x", URL_A + "#x",
    `http://user:password@127.0.0.1:8765${URL_A}`, "/media/abc/a.wav", "file:///private/audio.wav"])
    assert.equal(mediaPreviewURL(path, base), null, path);
});

test("declared and streamed oversize previews are rejected without consuming the full body", async () => {
  const signal = new AbortController().signal;
  let reads = 0, cancellations = 0;
  const response = {
    ok: true, headers: { get: () => null },
    body: { async cancel() { cancellations++; }, getReader: () => ({
      async read() { reads++; return { done: false, value: new Uint8Array(6) }; },
      async cancel() { cancellations++; }, releaseLock() {},
    }) },
  };
  await assert.rejects(readBoundedAudio(response, signal, 10), /large/);
  assert.equal(reads, 2); assert.equal(cancellations, 1);
  response.headers.get = () => "11";
  await assert.rejects(readBoundedAudio(response, signal, 10), /large/);
  assert.equal(reads, 2); assert.equal(cancellations, 2);
});

function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
}
function fakeRuntime({ context = true } = {}) {
  const fetches = [], contexts = [], layers = [], handlers = new Map(), attributes = new Map();
  const paints = [], drawCalls = [], status = { textContent: "" };
  const painter = {
    fillRect() {}, fillText() {}, measureText: value => ({ width: value.length * 5 }),
    drawImage(layer, ...rectangle) { paints.push(layer); drawCalls.push(rectangle); },
  };
  const canvas = {
    dataset: {}, width: 200, height: 100, hidden: false,
    getContext: () => painter,
    getBoundingClientRect: () => ({ width: 200, height: 100, left: 0 }),
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: key => attributes.get(key),
    addEventListener: (key, value) => handlers.set(key, value),
    removeEventListener: key => handlers.delete(key),
    ownerDocument: { createElement() {
      const layer = { width: 0, height: 0 };
      layer.getContext = () => ({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData(pixels) { layer.pixels = pixels.data; },
      });
      layers.push(layer); return layer;
    } },
  };
  class AudioContext {
    constructor() { contexts.push(this); }
    decodeAudioData(bytes) {
      return Promise.resolve({ length: 16000, sampleRate: 16000, numberOfChannels: 1,
        duration: 1, getChannelData: () => samples(new Uint8Array(bytes)[0] === 1 ? 1000 : 2000) });
    }
    close() { this.closed = true; return Promise.resolve(); }
  }
  const runtime = {
    location: { href: "http://127.0.0.1:8765/" }, devicePixelRatio: 1,
    AudioContext: context ? AudioContext : undefined,
    fetch(url, options) { const task = deferred(); fetches.push({ url, options, ...task }); return task.promise; },
    setTimeout: callback => callback(),
  };
  const response = value => ({ ok: true, headers: { get: () => "1" }, arrayBuffer: async () => Uint8Array.of(value).buffer });
  return { canvas, status, runtime, fetches, contexts, paints, drawCalls, layers, handlers, attributes, response };
}
async function flush() { for (let i = 0; i < 240; i++) await Promise.resolve(); }

test("viewer fetches only when visible, renders actual PCM and reuses its one-source cache", async () => {
  const env = fakeRuntime();
  const viewer = mountSpectrogram(env, env.runtime);
  viewer.setSource(URL_A, "a"); assert.equal(env.fetches.length, 0);
  viewer.setView({ start: 0, end: 1, duration: 1 }); viewer.setVisible(true);
  assert.equal(env.fetches.length, 1);
  env.fetches[0].resolve(env.response(1)); await flush();
  assert.equal(env.canvas.dataset.state, "ready"); assert.equal(env.layers.length, 1);
  assert.ok(env.layers[0].pixels.some((value, i) => i % 4 !== 3 && value > 200));
  assert.ok(env.contexts.every(context => context.closed));
  viewer.setVisible(false); viewer.setVisible(true); viewer.setView({ start: 0.2, end: 0.7, duration: 1 });
  assert.equal(env.fetches.length, 1); assert.ok(env.paints.length >= 2);
  viewer.setLanguage("en"); assert.match(env.status.textContent, /Spectrum/);
  viewer.dispose(); assert.equal(env.handlers.size, 0);
});

test("a replaced source aborts its request and a late response cannot paint the new source", async () => {
  const env = fakeRuntime(), viewer = mountSpectrogram(env, env.runtime);
  viewer.setVisible(true); viewer.setSource(URL_A, "old");
  const old = env.fetches[0]; viewer.setSource(URL_B, "new");
  assert.equal(old.options.signal.aborted, true);
  env.fetches[1].resolve(env.response(2)); await flush();
  const latest = env.layers[0]; assert.equal(env.layers.length, 1);
  old.resolve(env.response(1)); await flush();
  assert.equal(env.layers.length, 1); assert.equal(env.paints.at(-1), latest);
  assert.equal(env.canvas.dataset.state, "ready"); viewer.dispose();
});

test("hiding or disposing cancels pending work, and unavailable decoding has a useful state", async () => {
  const env = fakeRuntime(), viewer = mountSpectrogram(env, env.runtime);
  viewer.setSource(URL_A); viewer.setVisible(true);
  viewer.setVisible(false); assert.equal(env.fetches[0].options.signal.aborted, true);
  env.fetches[0].resolve(env.response(1)); await flush(); assert.equal(env.layers.length, 0);
  viewer.setVisible(true); assert.equal(env.fetches.length, 2);
  viewer.dispose(); env.fetches[1].resolve(env.response(1)); await flush();
  assert.equal(env.layers.length, 0);
  const unsupported = fakeRuntime({ context: false });
  const fallback = mountSpectrogram({ ...unsupported, language: "en" }, unsupported.runtime);
  fallback.setSource(URL_A); fallback.setVisible(true);
  assert.match(unsupported.status.textContent, /unavailable/); assert.equal(unsupported.fetches.length, 0);
  fallback.dispose();
});

test("hostile preview URL never triggers a fetch", () => {
  const env = fakeRuntime(), viewer = mountSpectrogram(env, env.runtime);
  viewer.setVisible(true); viewer.setSource("https://example.com/private.wav");
  assert.equal(env.fetches.length, 0); assert.equal(env.canvas.dataset.state, "error"); viewer.dispose();
});

test("replacement closes a pending decoder immediately and discards its late PCM", async () => {
  const env = fakeRuntime(), pending = deferred();
  const normalDecode = env.runtime.AudioContext.prototype.decodeAudioData;
  let decodes = 0;
  env.runtime.AudioContext.prototype.decodeAudioData = function (bytes) {
    return ++decodes === 1 ? pending.promise : normalDecode.call(this, bytes);
  };
  const viewer = mountSpectrogram(env, env.runtime);
  viewer.setVisible(true); viewer.setSource(URL_A);
  env.fetches[0].resolve(env.response(1)); await flush();
  assert.equal(env.contexts.length, 1); assert.equal(env.contexts[0].closed, undefined);
  viewer.setSource(URL_B); assert.equal(env.contexts[0].closed, true);
  env.fetches[1].resolve(env.response(2)); await flush();
  assert.equal(env.canvas.dataset.state, "ready"); assert.equal(env.layers.length, 1);
  pending.resolve({ length: 16000, sampleRate: 16000, numberOfChannels: 1,
    duration: 1, getChannelData: () => samples(1000) });
  await flush(); assert.equal(env.layers.length, 1);
  assert.ok(env.contexts.every(context => context.closed)); viewer.dispose();
});

test("click and keyboard seek use the plotted time window, including its label gutter", async () => {
  const env = fakeRuntime(), seeks = [];
  const viewer = mountSpectrogram({ ...env, onSeek: value => seeks.push(value) }, env.runtime);
  viewer.setSource(URL_A); viewer.setVisible(true);
  env.fetches[0].resolve(env.response(1)); await flush();
  viewer.setView({ start: 0.2, end: 0.8, duration: 1 });
  env.handlers.get("click")({ clientX: 42 + 150 / 2 });
  assert.ok(Math.abs(seeks.at(-1) - 0.5) < 1e-12);
  let prevented = false;
  env.handlers.get("keydown")({ key: "End", preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(seeks.at(-1), 0.8);
  viewer.dispose();
});

test("waveform overlay maps the entire plot width to the identical viewport with no label gutter", async () => {
  const env = fakeRuntime(), seeks = [];
  const viewer = mountSpectrogram({ ...env, alignWaveform: true, onSeek: seconds => seeks.push(seconds) }, env.runtime);
  viewer.setSource(URL_A); viewer.setVisible(true);
  env.fetches[0].resolve(env.response(1)); await flush();
  viewer.setView({ start: 0.2, end: 0.8, duration: 1 });
  const [sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height] = env.drawCalls.at(-1);
  assert.ok(Math.abs(sourceX - 0.2 * SPECTRUM_LIMITS.columns) < 1e-10);
  assert.ok(Math.abs(sourceWidth - 0.6 * SPECTRUM_LIMITS.columns) < 1e-10);
  assert.deepEqual([sourceY, sourceHeight, x, y, width, height], [0, SPECTRUM_LIMITS.rows, 0, 0, 200, 100]);
  for (const clientX of [0, 100, 200]) env.handlers.get("click")({ clientX });
  assert.deepEqual(seeks, [0.2, 0.5, 0.8]);
  assert.equal(Number(env.attributes.get("aria-valuenow")), 0.8);
  viewer.dispose();
});

for (const succeeds of [true, false]) test(`explicit same-source retry can ${succeeds ? "recover" : "fail again without looping"}`, async () => {
  const env = fakeRuntime(), viewer = mountSpectrogram({ ...env, language: "en" }, env.runtime);
  viewer.setSource(URL_A, "clip"); viewer.setVisible(true);
  viewer.setSource(URL_A, "clip", { retryFailed: true });
  assert.equal(env.fetches.length, 1, "initial in-flight request is deduplicated");
  env.fetches[0].resolve({ ok: false }); await flush();
  assert.equal(env.canvas.dataset.state, "error");
  assert.match(env.status.textContent, /Select this audio again/);
  viewer.setSource(URL_A, "clip"); viewer.setVisible(false); viewer.setVisible(true);
  viewer.setView({ start: 0, end: 1 }); viewer.setLanguage("zh");
  assert.equal(env.fetches.length, 1, "ordinary refresh/display changes do not retry");
  viewer.setSource(URL_A, "clip", { retryFailed: true });
  assert.equal(env.fetches.length, 2); assert.equal(env.canvas.dataset.state, "loading");
  viewer.setSource(URL_A, "clip", { retryFailed: true });
  assert.equal(env.fetches.length, 2, "in-flight retry is deduplicated");
  env.fetches[1].resolve(succeeds ? env.response(1) : { ok: false }); await flush();
  assert.equal(env.canvas.dataset.state, succeeds ? "ready" : "error");
  viewer.setVisible(false); viewer.setVisible(true); assert.equal(env.fetches.length, 2);
  if (succeeds) {
    const layer = env.layers[0];
    viewer.setSource(URL_A, "clip", { retryFailed: true });
    assert.equal(env.fetches.length, 2); assert.equal(env.paints.at(-1), layer);
  }
  viewer.dispose();
});

test("hidden explicit retry waits until visible and source replacement owns late responses", async () => {
  const env = fakeRuntime(), viewer = mountSpectrogram(env, env.runtime);
  viewer.setSource(URL_A, "clip"); viewer.setVisible(true);
  env.fetches[0].resolve({ ok: false }); await flush(); viewer.setVisible(false);
  viewer.setSource(URL_A, "clip", { retryFailed: true }); assert.equal(env.fetches.length, 1);
  viewer.setVisible(true); assert.equal(env.fetches.length, 2); const retry = env.fetches[1];
  viewer.setSource(URL_B, "other"); assert.equal(retry.options.signal.aborted, true);
  env.fetches[2].resolve(env.response(2)); await flush(); const layer = env.layers[0];
  retry.resolve(env.response(1)); await flush();
  assert.equal(env.layers.length, 1); assert.equal(env.paints.at(-1), layer);
  assert.equal(env.canvas.dataset.state, "ready"); viewer.dispose();
});

for (const kind of ["unavailable", "large", "empty"]) test(`same-source retry does not reset permanent ${kind} state`, async () => {
  const env = fakeRuntime({ context: kind !== "unavailable" });
  if (kind === "empty") env.runtime.AudioContext.prototype.decodeAudioData = async () => ({ length: 0 });
  const viewer = mountSpectrogram({ ...env, language: "en" }, env.runtime);
  viewer.setSource(URL_A, "clip"); viewer.setVisible(true);
  if (kind !== "unavailable") {
    env.fetches[0].resolve(kind === "large" ? { ok: true, headers: { get: () => String(SPECTRUM_LIMITS.bytes + 1) } } : env.response(1));
    await flush();
  }
  const message = env.status.textContent, requests = env.fetches.length;
  viewer.setSource(URL_A, "clip", { retryFailed: true }); viewer.setVisible(false); viewer.setVisible(true);
  assert.equal(env.fetches.length, requests); assert.equal(env.status.textContent, message);
  assert.equal(env.canvas.dataset.state, "error"); viewer.dispose();
});

test("workbench requests transient recovery only for explicit selection, not catalog refresh", () => {
  const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
  const statement = source.match(/spectrumView\.setSource\(item\.quality\.decoded[\s\S]*?;/)?.[0];
  assert.ok(statement);
  const item = { key: "a".repeat(64), quality: { decoded: true } }, calls = [];
  const selectSource = Function("spectrumView", "item", "refreshTurn", statement);
  for (const turn of [null, 0, 42]) selectSource({ setSource: (...args) => calls.push(args) }, item, turn);
  assert.deepEqual(calls.map(args => args[2].retryFailed), [true, false, false]);
  assert.ok(calls.every(args => args[0] === URL_A && args[1] === `${item.key}:a`));
});

// Execute the production selection source statement and complete variant action
// against the real viewer. Deferred fetch and PCM doubles stay entirely offline.
function productionSources(viewer) {
  const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
  const selection = source.match(/spectrumView\.setSource\(item\.quality\.decoded[\s\S]*?;/)?.[0];
  const start = source.indexOf("async function switchVariant(next)");
  const end = source.indexOf("function showImportError(", start);
  assert.ok(selection && start >= 0 && end > start);
  const noop = () => {};
  return Function("spectrumView", "audition", "$", "media", "renderDetails", "updateTime", `
    let selected, variant = 'a';
    ${source.slice(start, end)}
    return {
      select(item, refreshTurn = null) { selected = item; variant = 'a'; ${selection} },
      switchVariant,
    };
  `)(viewer, { cancel: noop }, () => ({}), { load: noop }, noop, noop);
}
const spectrumItem = key => ({ key, quality: { decoded: true, duration: 1 }, reference_quality: { decoded: true, duration: 1 } });

for (const phase of ["ready", "loading", "error"]) test(`A → B → A keeps ${phase} spectrum through catalog refresh`, async () => {
  const env = fakeRuntime(), viewer = mountSpectrogram(env, env.runtime), actions = productionSources(viewer);
  const item = spectrumItem("a".repeat(64)); viewer.setVisible(true);
  actions.select(item); await actions.switchVariant("b"); await actions.switchVariant("a");
  assert.equal(env.fetches.length, 3);
  assert.deepEqual(env.fetches.map(row => new URL(row.url).pathname), [URL_A, URL_A.replace('/a.wav', '/b.wav'), URL_A]);
  assert.ok(env.fetches.slice(0, 2).every(row => row.options.signal.aborted));
  const current = env.fetches[2];
  if (phase !== "loading") { current.resolve(phase === "ready" ? env.response(1) : { ok: false }); await flush(); }
  assert.equal(env.canvas.dataset.state, phase);
  const image = env.layers.at(-1), message = env.status.textContent;
  actions.select(item, 12); viewer.setVisible(true); await flush();
  assert.equal(env.fetches.length, 3, "refresh is not a new identity or retry");
  assert.equal(current.options.signal.aborted, false);
  assert.equal(env.canvas.dataset.state, phase); assert.equal(env.status.textContent, message);
  if (phase === "ready") assert.equal(env.layers.at(-1), image);
  if (phase === "loading") { current.resolve(env.response(1)); await flush(); assert.equal(env.canvas.dataset.state, "ready"); }
  if (phase === "error") {
    actions.select(item); assert.equal(env.fetches.length, 4, "explicit reselection still retries");
    env.fetches[3].resolve(env.response(1)); await flush(); assert.equal(env.canvas.dataset.state, "ready");
  }
  for (const old of env.fetches.slice(0, 2)) old.resolve(env.response(2));
  await flush(); assert.equal(env.layers.length, 1, "obsolete variants cannot publish");
  viewer.dispose();
});

test("canonical A identity still replaces different clips and resets a B refresh to A", async () => {
  const env = fakeRuntime(), viewer = mountSpectrogram(env, env.runtime), actions = productionSources(viewer);
  const first = spectrumItem("a".repeat(64)), second = spectrumItem("b".repeat(64));
  viewer.setVisible(true); actions.select(first); env.fetches[0].resolve(env.response(1)); await flush();
  const oldImage = env.layers[0];
  actions.select(second, 10); assert.equal(env.fetches.length, 2);
  assert.equal(new URL(env.fetches[1].url).pathname, `/media/${second.key}/a.wav`);
  await actions.switchVariant("b"); assert.equal(env.fetches[1].options.signal.aborted, true);
  assert.equal(new URL(env.fetches[2].url).pathname, URL_B);
  actions.select(second, 11); assert.equal(env.fetches.length, 4);
  assert.equal(env.fetches[2].options.signal.aborted, true);
  assert.equal(new URL(env.fetches[3].url).pathname, `/media/${second.key}/a.wav`);
  env.fetches[3].resolve(env.response(2)); await flush();
  assert.notEqual(env.paints.at(-1), oldImage); assert.equal(env.canvas.dataset.state, "ready");
  for (const old of env.fetches.slice(1, 3)) old.resolve(env.response(1));
  await flush(); assert.equal(env.layers.length, 2); viewer.dispose();
});
