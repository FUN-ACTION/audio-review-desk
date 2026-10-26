import test from "node:test";
import assert from "node:assert/strict";
import {
  viewportRange,
  editRange,
} from "../src/audio_review_desk/static/wave-math.js";

test("zoom window clamps at either recording edge and caps magnification", () => {
  assert.deepEqual(viewportRange(80, 2, 0), [0, 40]);
  assert.deepEqual(viewportRange(80, 2, 80), [40, 80]);
  assert.deepEqual(viewportRange(80, 100, 40), [35, 45]);
  assert.deepEqual(viewportRange(80, 0.5, 25), [0, 80]);
  assert.deepEqual(viewportRange(80, 2, NaN), [20, 60]);
  for (const duration of [0, -1, NaN, Infinity])
    assert.deepEqual(viewportRange(duration), [0, 0]);
});
test("trim handles cannot cross or leave the recording", () => {
  assert.deepEqual(editRange(10, 2, 8, "start", 9), [7.999, 8]);
  assert.deepEqual(editRange(10, 2, 8, "end", -1), [2, 2.001]);
  assert.deepEqual(editRange(10, 2, 8, "start", -2), [0, 8]);
  assert.deepEqual(editRange(10, 2, 8, "end", 20), [2, 10]);
  assert.deepEqual(editRange(0.0005, 0, 0.0005, "start", 1), [0, 0.0005]);
  assert.deepEqual(editRange(10, NaN, NaN, "start", NaN), [0, 10]);
  assert.deepEqual(editRange(0, 0, 0, "start", 1), [0, 0]);
});
