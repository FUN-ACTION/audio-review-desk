import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleSignal,
  signalPeaks,
  moveSampleEdge,
  clampSampleTime,
  sampleDuration,
} from "../src/audio_review_desk/static/tour/studio-signal.js";

test("the two sample versions are finite, level matched and leave headroom", () => {
  const first = sampleSignal(8000, "a"),
    second = sampleSignal(8000, "b");
  const rms = (values) =>
    Math.sqrt(
      values.reduce((sum, value) => sum + value * value, 0) / values.length,
    );
  assert.equal(first.length, sampleDuration * 8000);
  assert.notDeepEqual(first, second);
  for (const signal of [first, second]) {
    assert.ok(signal.every(Number.isFinite));
    assert.ok(signal.every((value) => Math.abs(value) < 0.95));
    assert.ok(Math.abs(rms(signal) - 0.095) < 1e-6);
  }
  assert.throws(() => sampleSignal(0));
  assert.throws(() => sampleSignal(8000, "unknown"));
});
test("waveform peaks include the final partial bin", () => {
  assert.deepEqual(
    signalPeaks(new Float32Array([0, -0.5, 0, 0.25, 1]), 2),
    [0.5, 1],
  );
  assert.throws(() => signalPeaks(new Float32Array(2), 3));
});
test("range edges retain a playable interval when dragged past one another", () => {
  assert.deepEqual(moveSampleEdge(2, 8, "start", 20), [7.75, 8]);
  assert.deepEqual(moveSampleEdge(2, 8, "end", -2), [2, 2.25]);
  assert.deepEqual(moveSampleEdge(2, 8, "start", -2), [0, 8]);
  assert.deepEqual(moveSampleEdge(2, 8, "end", 20), [2, 12]);
  assert.throws(() => moveSampleEdge(2, 2, "start", 1));
  assert.throws(() => moveSampleEdge(2, 8, "other", 1));
});
test("nonfinite seek positions cannot escape the sample", () => {
  assert.equal(clampSampleTime(NaN), 0);
  assert.equal(clampSampleTime(Infinity), 0);
  assert.equal(clampSampleTime(-1), 0);
  assert.equal(clampSampleTime(40), 12);
});
