import test from "node:test";
import {
  sortItems,
  playbackRange,
} from "../src/audio_review_desk/static/ui.js";
import assert from "node:assert/strict";
import {
  formatTime,
  filterItems,
  reviewPayload,
} from "../src/audio_review_desk/static/ui.js";

test("time formatting handles minutes, zero and invalid values", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(125.9), "2:05");
  assert.equal(formatTime(NaN), "—");
  assert.equal(formatTime(-1), "—");
});
const rows = [
  {
    id: "a",
    label: "中文 Clean",
    review: { status: "pending", version: 0 },
    quality: { flags: [] },
  },
  {
    id: "b",
    label: "Clipped",
    review: { status: "fix", version: 3 },
    quality: { flags: ["near_full_scale"] },
  },
];
test("search, status, warning and duplicate queues compose", () => {
  assert.deepEqual(
    filterItems(rows, "中文", "all", new Set()).map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(
    filterItems(rows, "", "warnings", new Set()).map((x) => x.id),
    ["b"],
  );
  assert.deepEqual(
    filterItems(rows, "", "fix", new Set()).map((x) => x.id),
    ["b"],
  );
  assert.deepEqual(
    filterItems(rows, "", "duplicates", new Set(["a"])).map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(filterItems(rows, "missing", "all", new Set()), []);
});
test("a real zero score is preserved and an empty score stays unscored", () => {
  const values = {
    status: "fix",
    score: "0",
    trimStart: "",
    trimEnd: "",
    issues: ["noise"],
    note: "keep zero",
  };
  const result = reviewPayload({ ...rows[1], key: "version-key" }, values);
  assert.equal(result.score, 0);
  assert.equal(result.expected_version, 3);
  assert.equal(result.trim_start, null);
  assert.equal(result.trim_end, null);
  assert.equal(reviewPayload(rows[0], { ...values, score: "" }).score, null);
});

test("file sorting leaves the original catalog order intact", () => {
  const input = [
    { id: "b", label: "take 10", quality: { duration: 1, rms_dbfs: -20 } },
    { id: "a", label: "take 2", quality: { duration: 3, rms_dbfs: -40 } },
  ];
  assert.deepEqual(
    sortItems(input, "name").map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(
    sortItems(input, "duration").map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(
    sortItems(input, "level").map((x) => x.id),
    ["b", "a"],
  );
  assert.equal(input[0].id, "b");
});
test("loop ranges clamp invalid suggestions without zero-length playback", () => {
  assert.deepEqual(playbackRange(5, 1, 3), [1, 3]);
  assert.deepEqual(playbackRange(5, -1, NaN), [0, 5]);
  assert.deepEqual(playbackRange(5, 6, 2), [0, 2]);
  assert.deepEqual(playbackRange(5, 2, 1), [2, 5]);
});
