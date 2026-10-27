import test from "node:test";
import assert from "node:assert/strict";
import {
  clampStoryTime,
  moveStoryEdge,
  closestStoryEdge,
  storyKeyRange,
  storyTimeAt,
  storyTimeLabel,
  MIN_STORY_RANGE,
} from "../src/audio_review_desk/static/tour/story-math.js";

test("timeline coordinates retain the point grabbed on an existing handle", () => {
  const start = 4;
  const left = 30,
    width = 720;
  const clicked = left + (start / 12) * width + 7;
  const offset = storyTimeAt(clicked, left, width) - start;
  assert.ok(Math.abs(storyTimeAt(clicked, left, width, offset) - start) < 1e-9);
  assert.ok(
    Math.abs(storyTimeAt(clicked + 60, left, width, offset) - 5) < 1e-9,
  );
  assert.equal(storyTimeAt(-200, left, width, offset), 0);
  assert.equal(storyTimeAt(2000, left, width, offset), 12);
  for (const bad of [
    [2, 0, 0],
    [NaN, 0, 20],
    [3, 0, Infinity],
  ]) {
    assert.throws(() => storyTimeAt(...bad), RangeError);
  }
});

test("range handles cannot cross or leave the twelve-second source", () => {
  assert.deepEqual(moveStoryEdge({ start: 2, end: 7 }, "start", 10), {
    start: 7 - MIN_STORY_RANGE,
    end: 7,
  });
  assert.deepEqual(moveStoryEdge({ start: 2, end: 7 }, "end", -10), {
    start: 2,
    end: 2 + MIN_STORY_RANGE,
  });
  let range = { start: 0, end: 12 };
  for (let i = 0; i < 500; i++) {
    range = moveStoryEdge(
      range,
      i % 2 ? "start" : "end",
      Math.sin(i * 3.1) * 30,
    );
    assert.ok(Number.isFinite(range.start) && Number.isFinite(range.end));
    assert.ok(range.start >= 0 && range.end <= 12);
    assert.ok(range.end - range.start >= MIN_STORY_RANGE - 1e-9);
  }
  for (const invalid of [
    { start: -1, end: 4 },
    { start: 3, end: 3 },
    { start: 0, end: NaN },
  ]) {
    assert.throws(() => moveStoryEdge(invalid, "start", 2), RangeError);
  }
});

test("keyboard movement uses tenths, supports boundaries, and leaves other keys alone", () => {
  const original = { start: 2, end: 8 };
  assert.deepEqual(storyKeyRange(original, "start", "ArrowRight"), {
    start: 2.1,
    end: 8,
  });
  assert.deepEqual(storyKeyRange(original, "end", "ArrowLeft", true), {
    start: 2,
    end: 7,
  });
  assert.deepEqual(storyKeyRange(original, "start", "Home"), {
    start: 0,
    end: 8,
  });
  assert.deepEqual(storyKeyRange(original, "end", "End"), {
    start: 2,
    end: 12,
  });
  assert.equal(storyKeyRange(original, "start", "Tab"), null);
  assert.deepEqual(original, { start: 2, end: 8 });
  assert.throws(() => storyKeyRange(original, "bad", "Home"));
});

test("time labels and external seek values stay finite and bounded", () => {
  for (const invalid of [NaN, Infinity, -Infinity])
    assert.equal(clampStoryTime(invalid), 0);
  assert.equal(clampStoryTime(20), 12);
  assert.equal(storyTimeLabel(4.25), "0:04.25");
  assert.equal(storyTimeLabel(12), "0:12.00");
  assert.equal(storyTimeLabel(4, 0), "0:04");
  assert.throws(() => storyTimeLabel(4, -1));
});

test("overlapping handle hit targets still choose the closest range edge", () => {
  const narrow = { start: 4, end: 4.15 };
  assert.equal(closestStoryEdge(narrow, 4.02), "start");
  assert.equal(closestStoryEdge(narrow, 4.13), "end");
  assert.equal(closestStoryEdge(narrow, -2), "start");
  assert.equal(closestStoryEdge(narrow, 20), "end");
  assert.throws(() => closestStoryEdge(narrow, NaN));
});
