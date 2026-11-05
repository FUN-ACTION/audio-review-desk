import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountWaveform } from "../src/audio_review_desk/static/waveform.js";

// These assertions inspect actual canvas drawing commands, not screenshots.
function drawing(t) {
  const originals = new Map(["ResizeObserver", "getComputedStyle", "document", "devicePixelRatio"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { ResizeObserver: class { observe() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "#0068d1" }),
    document: { documentElement: {} }, devicePixelRatio: 1 });
  t.after(() => { for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const rectangles = [], views = [];
  const context = { scale() {}, beginPath() {}, fill() {}, roundRect(x, y, width, height) { rectangles.push({ x, y, width, height }); } };
  const canvas = { clientWidth: 3000, clientHeight: 100, getContext: () => context };
  const handle = () => ({ style: {}, attributes: {}, addEventListener() {}, setAttribute(key, value) { this.attributes[key] = String(value); } });
  const start = handle(), end = handle(), seek = {};
  const wave = mountWaveform(canvas, seek, { style: {} }, { style: {} },
    { start, end, pan: {}, onEdit() {}, onView: (...args) => views.push(args) });
  return { wave, start, end, seek, views, rectangles,
    draw(action) { rectangles.length = 0; action(); },
    peaks: () => rectangles.filter(row => row.height > 2).map(row => row.x) };
}
const impulse = (index = 500) => Array.from({ length: 1000 }, (_, n) => n === index ? 1 : 0);

for (const sampleDuration of [0.96, 1, 1.04]) {
  test(`reference duration ${sampleDuration}s keeps its real midpoint on the 1s source timeline`, (t) => {
    const result = drawing(t);
    result.wave.set(impulse(), 1, 0, 1, sampleDuration);
    const expected = sampleDuration * 0.5 * 3000;
    assert.ok(result.peaks().length > 0);
    for (const x of result.peaks()) assert.ok(Math.abs(x - expected) <= 3, `${x} should be near ${expected}`);
    assert.equal(result.seek.max, "1");
    assert.equal(result.end.attributes["aria-valuemax"], "1");
    assert.deepEqual(result.views.at(-1), [0, 1, 1]);
  });
}

test("a shorter reference has no nonzero peaks after its actual end", (t) => {
  const result = drawing(t);
  result.wave.set(Array(1000).fill(1), 1, 0, 1, 0.96);
  assert.ok(result.rectangles.some(row => row.x < 2880 && row.height > 2));
  assert.ok(result.rectangles.filter(row => row.x >= 2880).every(row => row.height === 2));
  assert.equal(result.seek.max, "1");
});

test("the longer reference tail is clipped rather than compressed into the source", (t) => {
  const result = drawing(t);
  result.wave.set(impulse(980), 1, 0, 1, 1.04);
  assert.deepEqual(result.peaks(), []);
});

test("zoom and pan retain reference sample time on the shared source viewport", (t) => {
  const result = drawing(t);
  result.wave.set(impulse(), 1, 0, 1, 0.96);
  result.draw(() => result.wave.zoom(2, 0.5));
  assert.deepEqual(result.views.at(-1), [0.25, 0.75, 2]);
  for (const x of result.peaks()) assert.ok(Math.abs(x - 1380) <= 6);
  assert.ok(result.peaks().length > 0);
  result.draw(() => result.wave.pan(0));
  assert.deepEqual(result.views.at(-1), [0, 0.5, 2]);
  for (const x of result.peaks()) assert.ok(Math.abs(x - 2880) <= 6);
  result.draw(() => result.wave.pan(1));
  assert.deepEqual(result.views.at(-1), [0.5, 1, 2]);
  assert.deepEqual(result.peaks(), []);
});

test("four-argument and invalid sample-duration calls keep the existing timeline mapping", (t) => {
  const result = drawing(t);
  for (const sampleDuration of [undefined, null, 0, -1, NaN, Infinity]) {
    result.draw(() => result.wave.set(impulse(), 1, 0, 1, sampleDuration));
    assert.ok(result.peaks().length > 0);
    for (const x of result.peaks()) assert.ok(Math.abs(x - 1500) <= 3);
  }
});

test("the actual workbench draw handler supplies each variant's sample duration", () => {
  const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
  const body = source.match(/function drawWave\(\) \{([\s\S]*?)\n\}/)[1];
  const execute = Function("range", "wave", "variant", "selected", "waveformView", "media", body);
  const selected = { quality: { duration: 1 }, reference_quality: { duration: 0.96 } };
  const samples = { a: [0.2], b: [0.4] };
  for (const variant of ["a", "b"]) {
    const calls = [];
    execute(() => [0.1, 0.9], samples, variant, selected,
      { set: (...args) => calls.push(args), position() {} }, { currentTime: 0.5 });
    assert.deepEqual(calls[0], [samples[variant], 1, 0.1, 0.9, variant === "a" ? 1 : 0.96]);
  }
});
