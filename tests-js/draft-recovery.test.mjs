import test from "node:test";
import assert from "node:assert/strict";
import {
  createDraftRecovery, canonicalBaseline, sameDraftBaseline, copyMarkerDraft,
} from "../src/audio_review_desk/static/draft-recovery.js";

const workspaceId = "a".repeat(64), key = "b".repeat(64);
const storageKey = `ard-reload-draft-v1:${workspaceId}`;
const clone = (value) => structuredClone(value);
const review = (patch = {}) => ({
  version: 4, status: "pass", score: 0, trim_start: 0, trim_end: 5.123456789,
  issues: ["noise", "other"], note: "saved note",
  markers: [{ time: 1.123456789, text: "saved marker" }],
  updated_utc: "2026-11-03T22:00:00Z", origin: "human_ui", ...patch,
});
const draft = () => ({
  key, baseline: review(),
  form: { status: "fix", score: "0.", trimStart: " 1e", trimEnd: "-",
    issues: ["other", "noise"], note: "  unfinished\n笔记 👩🏽‍💻  " },
  markers: {
    rows: [{ time: 1.123456789, text: "saved marker" }], input: "  typed but not added  ",
    editing: { index: 0, time: "1:", text: "   ", originalTime: 1.123456789, timeDirty: true },
  },
});
function setup(patch = {}) {
  const values = new Map(), calls = [];
  const storage = {
    getItem(name) { calls.push(["get", name]); return values.get(name) ?? null; },
    setItem(name, value) { calls.push(["set", name, value]); values.set(name, value); },
    removeItem(name) { calls.push(["remove", name]); values.delete(name); },
  };
  return { values, calls, storage,
    recovery: createDraftRecovery({ storage, workspaceId, now: () => 1234.5, ...patch }) };
}
function savedRecord() {
  return setup().recovery.write(draft()).record;
}

test("synchronous reload round trip preserves all raw edits and exact numeric baseline", () => {
  const h = setup(), input = draft(), result = h.recovery.write(input);
  assert.equal(result.status, "saved");
  assert.equal(result.record.schema, 1);
  assert.equal(result.record.workspaceId, workspaceId);
  assert.equal(result.record.updatedAt, 1234.5);
  assert.deepEqual(result.record.form, input.form);
  assert.deepEqual(result.record.markers, input.markers);
  assert.deepEqual(result.record.baseline, canonicalBaseline(input.baseline));
  assert.equal(result.record.baseline.score, 0);
  assert.equal(result.record.baseline.trim_end, 5.123456789);
  const reloaded = createDraftRecovery({ storage: h.storage, workspaceId });
  assert.deepEqual(reloaded.read(), { status: "available", record: result.record });
});

test("empty read and owned clear never touch other workspace or app keys", () => {
  const h = setup();
  h.values.set("foreign", "keep");
  const otherKey = `ard-reload-draft-v1:${"c".repeat(64)}`;
  h.values.set(otherKey, "keep too");
  assert.deepEqual(h.recovery.read(), { status: "empty" });
  assert.equal(h.recovery.write(draft()).status, "saved");
  assert.deepEqual(h.recovery.clear(), { status: "empty" });
  assert.deepEqual(h.recovery.clear(), { status: "empty" });
  assert.equal(h.values.get("foreign"), "keep");
  assert.equal(h.values.get(otherKey), "keep too");
  assert.equal(h.calls.every(([, name]) => name === storageKey), true);
});

test("one owned slot per workspace replaces the previous clip, separate tab stores stay separate", () => {
  const h = setup(), anotherTab = setup(), next = draft();
  h.recovery.write(draft());
  next.key = "d".repeat(64);
  next.form.note = "new clip";
  h.recovery.write(next);
  assert.equal(h.values.size, 1);
  assert.equal(h.recovery.read().record.key, next.key);
  assert.deepEqual(anotherTab.recovery.read(), { status: "empty" });
});

test("stored record contains only allowlisted data, never server metadata", () => {
  const h = setup(), input = draft();
  Object.assign(input.baseline, { session: "secret", path: "/private/audio.wav", audio: "bytes" });
  assert.equal(h.recovery.write(input).status, "saved");
  const stored = h.values.get(storageKey);
  for (const forbidden of ['"updated_utc":', '"origin":', '"session":', '"path":', '"audio":', "secret", "private", "bytes"])
    assert.equal(stored.includes(forbidden), false);
  assert.deepEqual(Object.keys(JSON.parse(stored)), ["schema", "workspaceId", "key", "baseline", "form", "markers", "updatedAt"]);
});

test("write output, read outputs, baseline and marker copies have no shared mutable state", () => {
  const h = setup(), input = draft(), result = h.recovery.write(input), expected = clone(result.record);
  input.form.note = "input mutated";
  input.form.issues.push("lyrics");
  input.baseline.markers[0].text = "input changed";
  input.markers.editing.text = "input editor changed";
  result.record.baseline.markers[0].text = "output changed";
  result.record.markers.rows[0].time = 999;
  result.record.form.note = "output changed";
  assert.deepEqual(h.recovery.read().record, expected);
  const firstRead = h.recovery.read();
  firstRead.record.markers.editing.time = "changed";
  firstRead.record.form.issues.pop();
  assert.deepEqual(h.recovery.read().record, expected);
  const baseline = review(), copied = canonicalBaseline(baseline);
  copied.markers[0].text = "different";
  copied.issues.pop();
  assert.equal(baseline.markers[0].text, "saved marker");
  assert.equal(baseline.issues.length, 2);
  const snapshot = draft().markers, markerCopy = copyMarkerDraft(snapshot);
  markerCopy.rows[0].text = "different";
  markerCopy.editing.text = "different";
  assert.deepEqual(snapshot, draft().markers);
});

test("baseline identity includes version AND canonical content, ignores only metadata/order", () => {
  const record = savedRecord(), current = review({ origin: "restore", updated_utc: "later", issues: ["other", "noise"] });
  assert.equal(sameDraftBaseline(record, current), true);
  for (const patch of [
    { version: 5 }, { status: "fix" }, { score: 1 }, { trim_start: 0.000000001 },
    { trim_end: 5.123456788 }, { issues: ["noise"] }, { note: "saved note " },
    { markers: [{ time: 1.123456788, text: "saved marker" }] },
    { markers: [{ time: 1.123456789, text: "changed" }] },
  ]) assert.equal(sameDraftBaseline(record, review(patch)), false, JSON.stringify(patch));
  const unsorted = review({ markers: [{ time: 5, text: "last" }, { time: 1, text: "first" }] });
  assert.deepEqual(canonicalBaseline(unsorted).markers, [{ time: 1, text: "first" }, { time: 5, text: "last" }]);
  assert.equal(sameDraftBaseline({ baseline: canonicalBaseline(unsorted) }, { ...unsorted, markers: [...unsorted.markers].reverse() }), true);
  for (const invalid of [null, {}, { baseline: {} }]) assert.equal(sameDraftBaseline(invalid, current), false);
});

test("raw numeric inputs may be blank, invalid, unfinished or outside backend ranges", () => {
  for (const raw of ["", " ", "-", ".", "1e", "1:", "NaN", "Infinity", "999999999999", "10.001", "  0.00000001  ", "数字"] ) {
    const h = setup(), input = draft();
    input.form.score = input.form.trimStart = input.form.trimEnd = raw;
    input.markers.editing.time = raw;
    input.markers.editing.text = "";
    input.markers.input = "   ";
    assert.equal(h.recovery.write(input).status, "saved", raw);
    assert.deepEqual(h.recovery.read().record.form, input.form);
    assert.deepEqual(h.recovery.read().record.markers, input.markers);
  }
});

test("pending/null baseline and marker-free draft round trip", () => {
  const h = setup(), input = draft();
  input.baseline = review({ version: 0, status: "pending", score: null, trim_start: null, trim_end: null, note: "", issues: [], markers: [] });
  input.markers = { rows: [], input: "", editing: null };
  input.form = { status: "pending", score: "", trimStart: "", trimEnd: "", issues: [], note: "" };
  assert.equal(h.recovery.write(input).status, "saved");
  assert.equal(sameDraftBaseline(h.recovery.read().record, input.baseline), true);
});

test("maximum valid Unicode notes and 100 markers fit without truncation", () => {
  const h = setup(), input = draft();
  const rows = Array.from({ length: 100 }, (_, index) => ({ time: index, text: "🎵".repeat(240) }));
  input.baseline = review({ note: "🎵".repeat(4000), markers: rows });
  input.form.note = "🎵".repeat(4000);
  input.markers = { rows: clone(rows), input: "🎵".repeat(240), editing: { index: 99, time: "9".repeat(128), text: "🎵".repeat(240), originalTime: 99, timeDirty: false } };
  assert.equal(h.recovery.write(input).status, "saved");
  assert.deepEqual(h.recovery.read().record.markers, input.markers);
  assert.equal(h.recovery.read().record.form.note, input.form.note);
  assert.ok(Buffer.byteLength(h.values.get(storageKey), "utf8") <= 256 * 1024);
});

test("size envelope rejects huge serialized records and expansion without replacing prior recovery", () => {
  const h = setup(), prior = h.recovery.write(draft()).record, input = draft();
  const rows = Array.from({ length: 100 }, (_, index) => ({ time: index, text: "\0".repeat(240) }));
  input.baseline.markers = rows;
  input.markers = { rows: clone(rows), input: "", editing: null };
  assert.equal(h.recovery.write(input).status, "invalid");
  assert.deepEqual(h.recovery.read().record, prior);
  for (const raw of [" ".repeat(256 * 1024 + 1), `"${"🎵".repeat(70_000)}"`]) {
    h.values.set(storageKey, raw);
    assert.deepEqual(h.recovery.read(), { status: "invalid" });
    assert.equal(h.values.get(storageKey), raw);
  }
});

const invalidDrafts = [
  ["unknown root field", (x) => { x.session = "never store"; }],
  ["whole item key", (x) => { x.key = { key }; }],
  ["nonhex key", (x) => { x.key = "g".repeat(64); }],
  ["uppercase key", (x) => { x.key = "B".repeat(64); }],
  ["short key", (x) => { x.key = "b".repeat(63); }],
  ["bad baseline version", (x) => { x.baseline.version = -1; }],
  ["fractional version", (x) => { x.baseline.version = 1.5; }],
  ["unsafe version", (x) => { x.baseline.version = Number.MAX_SAFE_INTEGER + 1; }],
  ["missing baseline field", (x) => { delete x.baseline.note; }],
  ["bad baseline status", (x) => { x.baseline.status = "approved"; }],
  ["bad baseline score", (x) => { x.baseline.score = 11; }],
  ["nonfinite baseline score", (x) => { x.baseline.score = NaN; }],
  ["boolean baseline score", (x) => { x.baseline.score = false; }],
  ["nonfinite trim", (x) => { x.baseline.trim_start = Infinity; }],
  ["negative trim", (x) => { x.baseline.trim_end = -1; }],
  ["unsafe trim", (x) => { x.baseline.trim_end = Number.MAX_VALUE; }],
  ["unknown baseline issue", (x) => { x.baseline.issues = ["unknown"]; }],
  ["duplicate baseline issues", (x) => { x.baseline.issues = ["noise", "noise"]; }],
  ["long baseline note", (x) => { x.baseline.note = "x".repeat(4001); }],
  ["unknown form field", (x) => { x.form.markers = []; }],
  ["missing form field", (x) => { delete x.form.score; }],
  ["unknown form status", (x) => { x.form.status = "approve"; }],
  ["non-string score", (x) => { x.form.score = 1; }],
  ["long raw numeric text", (x) => { x.form.trimStart = "0".repeat(129); }],
  ["long raw note", (x) => { x.form.note = "🎵".repeat(4001); }],
  ["non-string note", (x) => { x.form.note = null; }],
  ["unknown form issue", (x) => { x.form.issues = ["unknown"]; }],
  ["duplicate form issues", (x) => { x.form.issues = ["noise", "noise"]; }],
  ["sparse issues", (x) => { x.form.issues = Array(1); }],
  ["missing marker editor", (x) => { delete x.markers.editing; }],
  ["unknown marker field", (x) => { x.markers.path = "/private.wav"; }],
  ["long marker input", (x) => { x.markers.input = "x".repeat(241); }],
  ["non-string marker input", (x) => { x.markers.input = 1; }],
  ["too many rows", (x) => { x.markers.rows = Array.from({ length: 101 }, () => ({ time: 1, text: "x" })); }],
  ["sparse rows", (x) => { x.markers.rows = Array(1); }],
  ["negative row time", (x) => { x.markers.rows[0].time = -1; }],
  ["nonfinite row time", (x) => { x.markers.rows[0].time = Infinity; }],
  ["string row time", (x) => { x.markers.rows[0].time = "1"; }],
  ["empty row text", (x) => { x.markers.rows[0].text = "  "; }],
  ["long row text", (x) => { x.markers.rows[0].text = "🎵".repeat(241); }],
  ["unknown row field", (x) => { x.markers.rows[0].audio = "bytes"; }],
  ["negative editor index", (x) => { x.markers.editing.index = -1; }],
  ["out-of-range editor index", (x) => { x.markers.editing.index = 1; }],
  ["fractional editor index", (x) => { x.markers.editing.index = 0.5; }],
  ["mismatched original time", (x) => { x.markers.editing.originalTime = 1.123; }],
  ["nonfinite original time", (x) => { x.markers.editing.originalTime = NaN; }],
  ["non-string editor time", (x) => { x.markers.editing.time = 1; }],
  ["long editor time", (x) => { x.markers.editing.time = "0".repeat(129); }],
  ["long editor text", (x) => { x.markers.editing.text = "x".repeat(241); }],
  ["missing timeDirty", (x) => { delete x.markers.editing.timeDirty; }],
  ["non-boolean timeDirty", (x) => { x.markers.editing.timeDirty = 1; }],
];
for (const [label, corrupt] of invalidDrafts) {
  test(`malformed write is atomic: ${label}`, () => {
    const h = setup(), previous = h.recovery.write(draft()).record, input = draft();
    h.calls.length = 0;
    corrupt(input);
    assert.deepEqual(h.recovery.write(input), { status: "invalid" });
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.recovery.read().record, previous);
  });
}

test("marker copy rejects corruption atomically and does not reorder or coerce raw state", () => {
  const snapshot = draft().markers;
  snapshot.rows.push({ time: 0, text: "  original whitespace  " });
  const copied = copyMarkerDraft(snapshot);
  assert.deepEqual(copied, snapshot);
  assert.equal(copied.rows[0].time, 1.123456789);
  for (const [, corrupt] of invalidDrafts.filter(([label]) => /marker|row|editor|original|timeDirty/.test(label))) {
    const input = draft();
    corrupt(input);
    assert.equal(copyMarkerDraft(input.markers), null);
  }
});

test("invalid or different-schema stored records are rejected without deleting or repairing", () => {
  const mutations = [
    (x) => { x.schema = 2; }, (x) => { x.schema = "1"; },
    (x) => { x.workspaceId = "c".repeat(64); }, (x) => { x.workspaceId = "bad"; },
    (x) => { x.session = "secret"; }, (x) => { delete x.key; },
    (x) => { x.updatedAt = -1; }, (x) => { x.updatedAt = "123"; },
    (x) => { x.baseline.origin = "unexpected stored metadata"; },
    (x) => { x.form.issues = ["unknown"]; },
    (x) => { x.markers.editing.index = 500; },
  ];
  const h = setup();
  const values = ["", "not json", "null", "[]", "true", "{}", ...mutations.map((change) => { const value = savedRecord(); change(value); return JSON.stringify(value); })];
  for (const raw of values) {
    h.values.set(storageKey, raw);
    h.calls.length = 0;
    assert.deepEqual(h.recovery.read(), { status: "invalid" });
    assert.equal(h.values.get(storageKey), raw);
    assert.deepEqual(h.calls, [["get", storageKey]]);
  }
});

test("invalid workspace cannot read, write or clear any storage key", () => {
  for (const workspaceId of [undefined, null, "", "workspace-name", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), {}]) {
    const h = setup({ workspaceId });
    assert.deepEqual(h.recovery.read(), { status: "invalid" });
    assert.deepEqual(h.recovery.write(draft()), { status: "invalid" });
    assert.deepEqual(h.recovery.clear(), { status: "unavailable" });
    assert.deepEqual(h.calls, []);
  }
  assert.deepEqual(createDraftRecovery(null).read(), { status: "invalid" });
});

test("throwing default sessionStorage getter is caught, and later availability can recover", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"), h = setup();
  try {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("denied"); } });
    const recovery = createDraftRecovery({ workspaceId });
    assert.deepEqual(recovery.read(), { status: "unavailable" });
    assert.deepEqual(recovery.write(draft()), { status: "unavailable" });
    assert.deepEqual(recovery.clear(), { status: "unavailable" });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: h.storage });
    assert.deepEqual(recovery.read(), { status: "empty" });
    assert.equal(recovery.write(draft()).status, "saved");
  } finally {
    if (before) Object.defineProperty(globalThis, "sessionStorage", before);
    else delete globalThis.sessionStorage;
  }
});

test("throwing injected resolver, option getter and storage method getter never escape", () => {
  const fail = () => { throw new Error("blocked"); };
  for (const options of [
    { workspaceId, storage: fail },
    { workspaceId, get storage() { return fail(); } },
    { workspaceId, storage: { get getItem() { return fail(); }, get setItem() { return fail(); }, get removeItem() { return fail(); } } },
    { workspaceId, storage: null },
  ]) {
    const recovery = createDraftRecovery(options);
    assert.deepEqual(recovery.read(), { status: "unavailable" });
    assert.deepEqual(recovery.write(draft()), { status: "unavailable" });
    assert.deepEqual(recovery.clear(), { status: "unavailable" });
  }
  const h = setup(), recovery = createDraftRecovery({ workspaceId, storage: () => h.storage });
  assert.equal(recovery.write(draft()).status, "saved");
});

test("read/write/quota/delete failures never report success or clear unrelated keys", () => {
  for (const failing of ["getItem", "setItem", "removeItem"]) {
    const h = setup();
    h.recovery.write(draft());
    const previous = h.values.get(storageKey);
    h.values.set("foreign", "untouched");
    h.storage[failing] = () => { const error = new Error("denied or quota"); error.name = "QuotaExceededError"; throw error; };
    const operation = { getItem: "read", setItem: "write", removeItem: "clear" }[failing];
    assert.deepEqual(h.recovery[operation](draft()), { status: "unavailable" });
    assert.equal(h.values.get(storageKey), previous);
    assert.equal(h.values.get("foreign"), "untouched");
  }
});

test("silent no-op writes/deletes and failed confirmation reads are not claimed successful", () => {
  const h = setup();
  h.storage.setItem = () => {};
  assert.deepEqual(h.recovery.write(draft()), { status: "unavailable" });
  h.values.set(storageKey, JSON.stringify(savedRecord()));
  h.storage.removeItem = () => {};
  assert.deepEqual(h.recovery.clear(), { status: "unavailable" });
  const uncertain = setup();
  uncertain.storage.getItem = () => { throw new Error("read denied after mutation"); };
  assert.deepEqual(uncertain.recovery.write(draft()), { status: "unavailable" });
  assert.equal(uncertain.values.has(storageKey), true);
  assert.deepEqual(uncertain.recovery.clear(), { status: "unavailable" });
  assert.equal(uncertain.values.has(storageKey), false);
});

test("invalid clocks do not write and throwing clocks report unavailable", () => {
  for (const value of [NaN, Infinity, -1, Number.MAX_VALUE, "123", null]) {
    const h = setup({ now: () => value });
    assert.deepEqual(h.recovery.write(draft()), { status: "invalid" });
    assert.deepEqual(h.calls, []);
  }
  const h = setup({ now: () => { throw new Error("clock failed"); } });
  assert.deepEqual(h.recovery.write(draft()), { status: "unavailable" });
  assert.deepEqual(h.calls, []);
});

test("hostile data getters, prototypes and cycles are rejected without invoking getters", () => {
  const h = setup();
  let invoked = 0;
  const input = draft();
  Object.defineProperty(input.form, "note", { enumerable: true, get() { invoked++; throw new Error("getter"); } });
  assert.deepEqual(h.recovery.write(input), { status: "invalid" });
  assert.equal(invoked, 0);
  const marker = draft().markers;
  Object.defineProperty(marker.rows, "0", { enumerable: true, get() { invoked++; throw new Error("array getter"); } });
  assert.equal(copyMarkerDraft(marker), null);
  assert.equal(invoked, 0);
  assert.equal(canonicalBaseline(Object.create(review())), null);
  const cyclic = draft();
  cyclic.markers.editing.text = cyclic;
  assert.deepEqual(h.recovery.write(cyclic), { status: "invalid" });
  const throwing = new Proxy({}, { getPrototypeOf() { throw new Error("proxy"); } });
  assert.equal(canonicalBaseline(throwing), null);
  assert.equal(copyMarkerDraft(throwing), null);
  assert.deepEqual(h.recovery.write(throwing), { status: "invalid" });
  assert.deepEqual(h.calls, []);
});
