import test from "node:test";
import assert from "node:assert/strict";
import {
  createBodies,
  stepBodies,
  kickBodies,
  damp,
} from "../src/audio_review_desk/static/tour/scene-physics.js";

const finiteBodies = (bodies) =>
  bodies.every((body) => Object.values(body).every(Number.isFinite));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("scene seeds are reproducible, balanced and different from another seed", () => {
  const first = createBodies();
  assert.deepEqual(first, createBodies());
  assert.notDeepEqual(first, createBodies({ seed: 914 }));
  assert.deepEqual(
    [0, 1, 2].map(
      (material) => first.filter((body) => body.material === material).length,
    ),
    [8, 8, 8],
  );
  assert.ok(
    first.every(
      (body) =>
        body.scale >= 0.8 &&
        body.scale <= 1.2 &&
        Math.abs(body.x) <= 7 &&
        Math.abs(body.y) <= 3.6 &&
        Math.abs(body.z) <= 2.8,
    ),
  );
  assert.equal(new Set(first.map((body) => body.z.toFixed(2))).size, 24);
  assert.deepEqual(createBodies({ count: 0 }), []);
});

test("exponential damping composes across frame rates and handles extreme finite values", () => {
  const once = damp(-4, 12, 6, 1);
  let divided = -4;
  for (let i = 0; i < 120; i++) divided = damp(divided, 12, 6, 1 / 120);
  assert.ok(Math.abs(once - divided) < 1e-12);
  assert.equal(damp(2, 10, 0, 5), 2);
  assert.equal(damp(2, 10, 5, 0), 2);
  assert.ok(Number.isFinite(damp(-Number.MAX_VALUE, Number.MAX_VALUE, 0.7, 1)));
  assert.equal(damp(1, 3, Number.MAX_VALUE, Number.MAX_VALUE), 3);
});

test("zero frame time is a strict no-op and invalid arguments do not mutate bodies", () => {
  const bodies = createBodies();
  const snapshot = structuredClone(bodies);
  assert.equal(stepBodies(bodies, 0), bodies);
  assert.deepEqual(bodies, snapshot);
  for (const dt of [-1, NaN, Infinity])
    assert.throws(() => stepBodies(bodies, dt));
  assert.throws(() =>
    stepBodies(bodies, 1 / 60, { drag: { index: 24, x: 0, y: 0, z: 0 } }),
  );
  assert.throws(() =>
    stepBodies(bodies, 1 / 60, {
      pointer: { active: true, x: NaN, y: 0, z: 0 },
    }),
  );
  assert.throws(() =>
    stepBodies(bodies, 1 / 60, { bounds: { x: 0, y: 5, z: 5 } }),
  );
  assert.deepEqual(bodies, snapshot);
  const invalid = structuredClone(bodies);
  invalid.at(-1).vx = NaN;
  assert.throws(() => stepBodies(invalid, 1 / 60));
  assert.deepEqual(invalid[0], snapshot[0]);
  for (const [name, value] of [
    ["scale", 1e-300],
    ["material", 4],
    ["spinX", Infinity],
  ]) {
    const malformed = structuredClone(bodies);
    malformed.at(-1)[name] = value;
    assert.throws(() => stepBodies(malformed, 1 / 60));
    assert.deepEqual(malformed[0], snapshot[0]);
  }
});

test("idle integration stays finite and bounded across varied frame times", () => {
  const bodies = createBodies();
  for (let frame = 0; frame < 1800; frame++)
    stepBodies(
      bodies,
      frame % 90 === 0 ? 2 : frame % 3 === 0 ? 1 / 30 : 1 / 120,
    );
  assert.ok(finiteBodies(bodies));
  assert.ok(
    bodies.every(
      (body) =>
        Math.abs(body.x) <= 8.5 &&
        Math.abs(body.y) <= 5 &&
        Math.abs(body.z) <= 3.5,
    ),
  );
  assert.ok(
    bodies.every((body) => Math.hypot(body.vx, body.vy, body.vz) <= 12 + 1e-10),
  );
});

test("coincident bodies separate without a NaN normal", () => {
  const bodies = createBodies({ count: 4 });
  for (const body of bodies) {
    body.x = body.y = body.z = body.homeX = body.homeY = body.homeZ = 0;
    body.vx = body.vy = body.vz = 0;
  }
  for (let frame = 0; frame < 120; frame++)
    stepBodies(bodies, 1 / 60, { pointer: { x: 0, y: 0, z: 0, active: true } });
  assert.ok(finiteBodies(bodies));
  for (let a = 0; a < bodies.length; a++)
    for (let b = a + 1; b < bodies.length; b++)
      assert.ok(distance(bodies[a], bodies[b]) > 0.5);
});

test("extreme dragged targets and pointer positions remain within scene bounds", () => {
  const bodies = createBodies({ count: 12 });
  const bounds = { x: 5, y: 3.5, z: 2.5 };
  for (let frame = 0; frame < 900; frame++) {
    stepBodies(bodies, 1 / 60, {
      bounds,
      pointer: { x: frame % 2 ? 0 : 1e300, y: 0, z: 0, active: true },
      drag: { index: 0, x: 1e300, y: -1e300, z: 1e300 },
    });
  }
  assert.ok(finiteBodies(bodies));
  assert.ok(
    bodies.every(
      (body) =>
        Math.abs(body.x) <= bounds.x &&
        Math.abs(body.y) <= bounds.y &&
        Math.abs(body.z) <= bounds.z,
    ),
  );
  assert.ok(bodies[0].x > 3.5 && bodies[0].y < -2);
});

test("a palette kick is reproducible, capped and settles after release", () => {
  const first = createBodies({ count: 1 }),
    second = createBodies({ count: 1 });
  const snapshot = structuredClone(first);
  assert.equal(kickBodies(first, 2), first);
  kickBodies(second, 2);
  assert.deepEqual(first, second);
  const initialSpeed = Math.hypot(first[0].vx, first[0].vy, first[0].vz);
  assert.ok(initialSpeed > 2);
  assert.notDeepEqual(first, snapshot);
  for (let i = 0; i < 120; i++) kickBodies(second, i);
  assert.ok(Math.hypot(second[0].vx, second[0].vy, second[0].vz) <= 9 + 1e-10);
  for (let i = 0; i < 600; i++) stepBodies(first, 1 / 60);
  assert.ok(
    Math.hypot(first[0].vx, first[0].vy, first[0].vz) < initialSpeed / 10,
  );
  assert.ok(
    distance(first[0], {
      x: first[0].homeX,
      y: first[0].homeY,
      z: first[0].homeZ,
    }) < 0.2,
  );
});

test("creation, smoothing and kick reject malformed public inputs", () => {
  for (const options of [
    { count: -1 },
    { count: 1.5 },
    { count: 97 },
    { seed: NaN },
    { seed: 1.5 },
  ])
    assert.throws(() => createBodies(options));
  for (const args of [
    [NaN, 0, 1, 1],
    [0, Infinity, 1, 1],
    [0, 1, -1, 1],
    [0, 1, 1, -1],
  ])
    assert.throws(() => damp(...args));
  assert.throws(() => kickBodies(createBodies(), Infinity));
  assert.throws(() => stepBodies(null, 0));
  assert.throws(() =>
    stepBodies(createBodies(), 0.01, { pointer: { x: 0, y: 0, z: 0 } }),
  );
});
