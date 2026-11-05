import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTrimEditor } from "../src/audio_review_desk/static/trim.js";
import { mountWaveform } from "../src/audio_review_desk/static/waveform.js";
import { formatMarkerTime, reviseMarker } from "../src/audio_review_desk/static/markers.js";
import { reviewPayload } from "../src/audio_review_desk/static/ui.js";
import { quietRange } from "../src/audio_review_desk/static/audition.js";

const field = (initial = "") => ({
  _value: initial,
  validityMessage: "previous error",
  get value() { return this._value; },
  set value(value) { this._value = String(value); },
  setCustomValidity(message) { this.validityMessage = message; },
});
function editor(duration, left = "", right = "") {
  const start = field(left), end = field(right);
  let changes = 0;
  const edit = createTrimEditor({ start, end, duration: () => duration, onChange: () => changes++ });
  return { start, end, edit, changes: () => changes };
}

test("generated boundaries retain exact clip ends and submillisecond precision", () => {
  for (const duration of [1.0004, 1.0006, 1 / 44100]) {
    const { start, end, edit } = editor(duration);
    assert.equal(edit.range(0, duration), true);
    assert.equal(Number(start.value), 0);
    assert.equal(Number(end.value), duration);
    assert.ok(Number(end.value) > Number(start.value));
    assert.equal(end.validityMessage, "");
  }
});

test("single-boundary edits preserve opposite blank, invalid and exact values", () => {
  for (const other of ["", "-1", "9", "0.123456789"]) {
    for (const side of ["start", "end"]) {
      const context = editor(2, other, other);
      context.edit.boundary(side, 0.000456789);
      const opposite = side === "start" ? "end" : "start";
      assert.equal(context[side].value, "0.000456789");
      assert.equal(context[side].validityMessage, "");
      assert.equal(context[opposite].value, other);
      assert.equal(context[opposite].validityMessage, "previous error");
      assert.equal(context.changes(), 1);
    }
  }
});

test("generated out-of-bounds positions clamp without reordering invalid intent", () => {
  const { start, end, edit } = editor(1.0006);
  edit.boundary("start", -5);
  edit.boundary("end", 5);
  assert.equal(start.value, "0");
  assert.equal(end.value, "1.0006");
  edit.range(0.8, 0.2);
  assert.equal(start.value, "0.8");
  assert.equal(end.value, "0.2");
});

test("invalid generated times leave both fields and dirty state unchanged", () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    const context = editor(duration, "0.1", "0.2");
    assert.equal(context.edit.boundary("start", 0.1), false);
    assert.equal(context.edit.range(0, 0.2), false);
    assert.equal(context.start.value, "0.1");
    assert.equal(context.end.value, "0.2");
    assert.equal(context.changes(), 0);
  }
  const context = editor(2, "0.1", "0.2");
  for (const value of [NaN, Infinity, null, "1"])
    assert.equal(context.edit.boundary("start", value), false);
  assert.equal(context.edit.boundary("unexpected", 1), false);
  assert.equal(context.edit.range(0, NaN), false);
  assert.equal(context.changes(), 0);
});

test("reset restores implicit full-clip bounds and clears stale validation", () => {
  const context = editor(2, "-1", "5");
  context.edit.reset();
  assert.equal(context.start.value, "");
  assert.equal(context.end.value, "");
  assert.equal(context.start.validityMessage, "");
  assert.equal(context.end.validityMessage, "");
  assert.equal(context.changes(), 1);
});

test("payload keeps exact values, null defaults and invalid typed intent", () => {
  const values = { status: "pending", score: "", trimStart: "", trimEnd: "1.0006", issues: [], note: "" };
  const item = { key: "key", review: { version: 0 } };
  const payload = reviewPayload(item, values);
  assert.equal(payload.trim_start, null);
  assert.equal(payload.trim_end, 1.0006);
  assert.equal(reviewPayload(item, { ...values, trimStart: "-1" }).trim_start, -1);
});

// Execute the actual small event bodies with form-field doubles. This checks
// workbench wiring without claiming browser rendering or native form behavior.
const workbench = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const body = (pattern) => {
  const match = workbench.match(pattern);
  assert.ok(match, "workbench handler exists");
  return match[1];
};
const invoke = (code, environment) => Function(...Object.keys(environment), code)(...Object.values(environment));
function handlerContext(duration, left = "", right = "") {
  const context = editor(duration, left, right);
  return {
    ...context,
    environment: {
      selected: { quality: { decoded: true, duration, leading_quiet_seconds: 0.1, trailing_quiet_seconds: 0 } },
      busy: false, audition: { cancel() {} }, player: { currentTime: duration }, media: { currentTime: duration },
      $: (id) => ({ trimStart: context.start, trimEnd: context.end })[id],
      trimEditor: context.edit, markDirty() {}, drawWave() {}, notice() {}, t: (key) => key, quietRange,
    },
  };
}

test("actual waveform callback changes only the requested exact boundary", () => {
  const code = body(/onEdit\(start, end(?:, side)?\) \{([\s\S]*?)\n    \},/);
  for (const duration of [1.0004, 1 / 44100]) {
    const context = handlerContext(duration, "", "");
    invoke(code, { ...context.environment, start: 0, end: duration, side: "end" });
    assert.equal(context.start.value, "");
    assert.equal(Number(context.end.value), duration);
    assert.equal(context.end.validityMessage, "");
  }
});

test("actual mark-out shortcut accepts exact EOF and clears old errors", () => {
  const code = body(/function markBoundary\(side\) \{([\s\S]*?)\n\}/);
  const context = handlerContext(1.0006);
  invoke(code, { ...context.environment, side: "end" });
  assert.equal(context.end.value, "1.0006");
  assert.equal(context.end.validityMessage, "");
  assert.equal(context.start.value, "");
});

test("actual silence suggestion preserves fractional EOF", () => {
  const code = body(/\$\("suggestRange"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n\}\);/);
  const context = handlerContext(1.0006);
  invoke(code, context.environment);
  assert.equal(context.start.value, "0.1");
  assert.equal(context.end.value, "1.0006");
  assert.equal(context.start.validityMessage, "");
  assert.equal(context.end.validityMessage, "");
});

test("actual reset-range action clears prior native validation errors", () => {
  const code = body(/\$\("resetRange"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n\}\);/);
  const context = handlerContext(2, "-1", "9");
  invoke(code, context.environment);
  assert.equal(context.start.value, "");
  assert.equal(context.end.value, "");
  assert.equal(context.start.validityMessage, "");
  assert.equal(context.end.validityMessage, "");
});

test("waveform keyboard events forward the edited side to the form callback", (t) => {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => previous === undefined ? delete globalThis.ResizeObserver : globalThis.ResizeObserver = previous);
  const handle = () => ({ listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
  const start = handle(), end = handle(), calls = [];
  const wave = mountWaveform({ clientWidth: 0 }, {}, {}, {}, { start, end, onEdit: (...args) => calls.push(args) });
  wave.set([], 1 / 44100, 0, 1 / 44100);
  start.listeners.keydown({ key: "Home", preventDefault() {} });
  end.listeners.keydown({ key: "End", preventDefault() {} });
  assert.deepEqual(calls, [[0, 1 / 44100, "start"], [0, 1 / 44100, "end"]]);
});

test("marker timestamps carry milliseconds into minutes without altering stored time", () => {
  for (const [time, expected] of [[0, "0:00.000"], [59.9994, "0:59.999"], [59.9996, "1:00.000"], [119.9996, "2:00.000"], [62.007, "1:02.007"]])
    assert.equal(formatMarkerTime(time), expected);
  for (const time of [NaN, Infinity, -1]) assert.equal(formatMarkerTime(time), "—");
  assert.equal(reviseMarker([{ time: 59.9996, text: "original" }], 0, 59.9996, "text only", 59.9996)[0].time, 59.9996);
});
