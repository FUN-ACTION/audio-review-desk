import test from "node:test";
import assert from "node:assert/strict";
import { spring } from "../src/audio_review_desk/static/motion-vendor.js";
test("vendored Motion springs converge consistently at 60 and 120 Hz", () => {
  for (const hz of [60, 120]) {
    const generator = spring({
      keyframes: [0, 100],
      stiffness: 650,
      damping: 52,
      restDelta: 0.001,
      restSpeed: 0.001,
    });
    let value = 0;
    for (let frame = 0; frame <= hz * 2; frame++) {
      value = generator.next((frame * 1000) / hz).value;
      assert.ok(Number.isFinite(value));
      assert.ok(value >= -0.001 && value <= 100.001);
    }
    assert.ok(Math.abs(value - 100) < 0.001);
  }
});
test("retargeted Motion spring begins at the current value with forward velocity", () => {
  const first = spring({ keyframes: [0, 100], stiffness: 650, damping: 52 });
  const position = first.next(50).value,
    velocity = (first.next(51).value - position) * 1000;
  const next = spring({
    keyframes: [position, -30],
    velocity,
    stiffness: 650,
    damping: 52,
  });
  assert.ok(Math.abs(next.next(0).value - position) < 0.00001);
  assert.ok(next.next(1).value > position);
  assert.ok(Math.abs(next.next(2000).value + 30) < 0.001);
});
