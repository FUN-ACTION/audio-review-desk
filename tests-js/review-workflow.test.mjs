import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkerTime,
  reviseMarker,
} from "../src/audio_review_desk/static/markers.js";
import {
  filterItems,
  nextPendingItem,
  continueQueue,
  sameReview,
  queueStamp,
} from "../src/audio_review_desk/static/ui.js";
import {
  cleanListeningState,
  resumedTime,
  createListeningMemory,
} from "../src/audio_review_desk/static/listening.js";

test("note times accept seconds or minute timestamps and reject ambiguous input", () => {
  for (const [input, expected] of [
    ["0", 0],
    [" 12.5 ", 12.5],
    ["1:02.007", 62.007],
    ["2:00", 120],
  ])
    assert.equal(parseMarkerTime(input, 120), expected);
  for (const input of [
    "",
    "-1",
    "1:60",
    "1:2:3",
    "3e1",
    "1.2345",
    "NaN",
    "121",
    "Infinity",
  ])
    assert.equal(parseMarkerTime(input, 120), null, input);
  assert.equal(parseMarkerTime("1", NaN), null);
});

test("editing a note preserves the original, trims text and reorders timestamps", () => {
  const saved = [
    { time: 0, text: "start" },
    { time: 1, text: "second" },
  ];
  const edited = reviseMarker(saved, 0, "1.5", "  edited  ", 2);
  assert.deepEqual(edited, [
    { time: 1, text: "second" },
    { time: 1.5, text: "edited" },
  ]);
  assert.equal(saved[0].time, 0);
  edited[0].text = "independent";
  assert.equal(saved[1].text, "second");
  assert.equal(
    reviseMarker(
      [{ time: 0.123456, text: "original" }],
      0,
      0.123456,
      "text only",
      2,
    )[0].time,
    0.123456,
  );
  for (const [index, time, text] of [
    [-1, "0", "x"],
    [0, "3", "x"],
    [0, "0", " "],
    [0, "0", "x".repeat(241)],
  ])
    assert.throws(() => reviseMarker(saved, index, time, text, 2));
  assert.deepEqual(saved, [
    { time: 0, text: "start" },
    { time: 1, text: "second" },
  ]);
});

test("search combines filename, review note and time notes with normalized terms", () => {
  const rows = [
    {
      id: "12",
      label: "Take １２",
      quality: { flags: [] },
      review: {
        status: "pass",
        note: "Needs a tail fade",
        markers: [{ time: 1, text: "门响" }],
      },
    },
    {
      id: "13",
      label: "Take 13",
      quality: { flags: [] },
      review: { status: "pending", note: "", markers: [] },
    },
  ];
  assert.equal(filterItems(rows, "12 门响 fade", "all", new Set())[0], rows[0]);
  assert.equal(filterItems(rows, "", "noted", new Set()).length, 1);
  assert.deepEqual(filterItems(rows, "fade missing", "all", new Set()), []);
  assert.deepEqual(filterItems(rows, "fade", "pending", new Set()), []);
});

test("continue skips reviewed clips, wraps the queue and never selects itself", () => {
  const rows = [
    { key: "a", review: { status: "pending" } },
    { key: "b", review: { status: "pass" } },
    { key: "c", review: { status: "pending" } },
  ];
  assert.equal(nextPendingItem(rows, "a"), rows[2]);
  assert.equal(nextPendingItem(rows, "c"), rows[0]);
  assert.equal(nextPendingItem(rows, "missing"), rows[0]);
  assert.equal(nextPendingItem([rows[0]], "a"), null);
  assert.equal(nextPendingItem([], "a"), null);
});

const memoryStore = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
};
test("continue keeps its place when a saved clip leaves a pending filter", () => {
  const before = ["a", "b", "c"].map((key) => ({
    key,
    review: { status: "pending" },
  }));
  const current = [before[0], before[2]];
  assert.equal(continueQueue(before, current, "b").key, "c");
  assert.equal(continueQueue(before, current, "c").key, "a");
  assert.equal(continueQueue(before, [], "b"), null);
});
test("dirty comparison ignores revision metadata and issue ordering but detects real edits", () => {
  const saved = {
    status: "fix",
    score: 0,
    issues: ["noise", "other"],
    note: "text",
    version: 2,
  };
  assert.equal(
    sameReview(saved, { ...saved, version: 3, issues: ["other", "noise"] }),
    true,
  );
  assert.equal(sameReview(saved, { ...saved, score: null }), false);
  assert.equal(sameReview(saved, { ...saved, note: "changed" }), false);
  assert.equal(
    sameReview(saved, { ...saved, markers: [{ time: 0, text: "note" }] }),
    false,
  );
});
test("list reuse detects a changed label, review or language after a rescan", () => {
  const row = {
    key: "one",
    id: "a",
    label: "take",
    quality: { duration: 1, flags: [] },
    review: { status: "pending", version: 0 },
  };
  const stamp = queueStamp([row], "en");
  assert.equal(queueStamp([{ ...row }], "en"), stamp);
  assert.notEqual(queueStamp([{ ...row, label: "renamed" }], "en"), stamp);
  assert.notEqual(
    queueStamp([{ ...row, review: { status: "pass", version: 1 } }], "en"),
    stamp,
  );
  assert.notEqual(queueStamp([row], "zh"), stamp);
});
test("listening position and preferences survive a new instance and stay workspace scoped", () => {
  const store = memoryStore(),
    first = createListeningMemory(store, "one");
  first.preferences({ speed: 1.25, volume: 0.4, loop: true });
  first.position("key-v1", 2.3456);
  const next = createListeningMemory(store, "one").get();
  assert.equal(resumedTime(next, "key-v1", 10), 2.346);
  assert.equal(resumedTime(next, "key-v2", 10), 0);
  assert.equal(next.speed, 1.25);
  assert.equal(next.volume, 0.4);
  assert.equal(next.loop, true);
  assert.equal(createListeningMemory(store, "two").get().selected, null);
  assert.equal(resumedTime(next, "key-v1", 2), 0);
});

test("turning memory off clears positions while corrupt or unavailable storage is harmless", () => {
  const store = memoryStore(),
    memory = createListeningMemory(store, "one");
  for (let i = 0; i < 80; i++) memory.position(`key-${i}`, i);
  assert.equal(memory.get().positions.length, 64);
  memory.preferences({ remember: false });
  memory.position("last", 3);
  assert.deepEqual(memory.get().positions, []);
  assert.equal(memory.get().selected, "last");
  assert.equal(resumedTime(memory.get(), "last", 5), 0);
  assert.equal(
    cleanListeningState({ speed: 90, volume: -1, loop: "true" }).speed,
    1,
  );
  store.setItem("ard-listening-bad", "{broken");
  assert.equal(createListeningMemory(store, "bad").get().volume, 1);
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
  };
  assert.doesNotThrow(() =>
    createListeningMemory(denied, "one").position("key", 1),
  );
});
