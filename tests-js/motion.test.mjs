import test from "node:test";
import assert from "node:assert/strict";
import { springStep } from "../src/audio_review_desk/static/motion.js";

test("spring converges consistently at 60 and 120 Hz without overshoot", () => {
  const run = (hz) => {
    let position = 0,
      velocity = 0;
    for (let n = 0; n < hz; n++) {
      [position, velocity] = springStep(position, velocity, 100, 1 / hz);
      assert.ok(position >= 0 && position <= 100);
    }
    return position;
  };
  assert.ok(Math.abs(run(60) - 100) < 0.001);
  assert.ok(Math.abs(run(60) - run(120)) < 0.00001);
});
test("retargeting starts from current position and retains velocity", () => {
  const [position, velocity] = springStep(0, 0, 100, 0.04);
  const [samePosition, sameVelocity] = springStep(position, velocity, 0, 0);
  assert.equal(position, samePosition);
  assert.equal(velocity, sameVelocity);
  const [nextPosition, nextVelocity] = springStep(
    position,
    velocity,
    0,
    1 / 120,
  );
  assert.ok(Number.isFinite(nextPosition) && Number.isFinite(nextVelocity));
  assert.ok(
    nextPosition > position,
    "momentum should remain continuous at reversal",
  );
});
