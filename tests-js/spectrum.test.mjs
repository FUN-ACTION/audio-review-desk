import test from "node:test";
import assert from "node:assert/strict";
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
