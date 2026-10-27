import test from "node:test";
import assert from "node:assert/strict";
import {
  playbackTime,
  rebaseLoop,
} from "../src/audio_review_desk/static/tour/sample-playback.js";

test("editing a loop after it has wrapped preserves the audible time", () => {
  const original = {
    playing: true,
    loop: true,
    offset: 2,
    started: 0,
    start: 2,
    end: 8,
  };
  assert.equal(playbackTime(original, 8), 4);
  const next = {
    ...original,
    ...rebaseLoop(original, { start: 3, end: 7 }, 8),
  };
  assert.equal(playbackTime(next, 8), 4);
  assert.equal(playbackTime(next, 9), 5);
  assert.equal(playbackTime(next, 11), 3);
});
test("loop endpoint wraps exactly and an excluded playhead moves to the new start", () => {
  const state = {
    playing: true,
    loop: true,
    offset: 2,
    started: 0,
    start: 2,
    end: 8,
  };
  assert.equal(playbackTime(state, 6), 2);
  const next = { ...state, ...rebaseLoop(state, { start: 6, end: 9 }, 8) };
  assert.equal(playbackTime(next, 8), 6);
});
test("paused, ended and backwards clock readings remain bounded", () => {
  assert.equal(playbackTime({ playing: false, position: 4.25 }, 100), 4.25);
  assert.equal(
    playbackTime({ playing: true, loop: false, offset: 11, started: 10 }, 14),
    12,
  );
  assert.equal(
    playbackTime({ playing: true, loop: false, offset: 3, started: 10 }, 9),
    3,
  );
});
test("invalid clocks and zero-width loops cannot produce NaN or divide by zero", () => {
  assert.throws(
    () =>
      playbackTime(
        { playing: true, loop: true, offset: 0, started: 0, start: 3, end: 3 },
        1,
      ),
    RangeError,
  );
  assert.throws(
    () => rebaseLoop({ playing: false, position: 4 }, { start: 0, end: 13 }, 1),
    RangeError,
  );
  assert.throws(
    () => playbackTime({ playing: false, position: 4 }, NaN),
    RangeError,
  );
});
