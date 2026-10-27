// Small original scene simulation. No renderer, DOM, audio or frame clock is used here.
const TAU = Math.PI * 2;
const DEFAULT_BOUNDS = Object.freeze({ x: 8.5, y: 5, z: 3.5 });
const BODY_FIELDS = [
  "x",
  "y",
  "z",
  "vx",
  "vy",
  "vz",
  "rx",
  "ry",
  "rz",
  "wx",
  "wy",
  "wz",
  "homeX",
  "homeY",
  "homeZ",
  "scale",
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function finite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function validateBodies(bodies) {
  if (!Array.isArray(bodies) || bodies.length > 96)
    throw new RangeError("Expected an array of at most 96 bodies");
  for (const body of bodies) {
    if (!body || typeof body !== "object") throw new TypeError("Invalid body");
    for (const name of BODY_FIELDS) finite(body[name], name);
    if (body.scale < 0.1 || body.scale > 4)
      throw new RangeError("Body scale must be between 0.1 and 4");
    if (
      !Number.isInteger(body.material) ||
      body.material < 0 ||
      body.material > 2
    )
      throw new RangeError("Invalid body material");
    for (const name of ["spinX", "spinY", "spinZ", "phase", "age"])
      if (body[name] !== undefined) finite(body[name], name);
  }
}

function validatePoint(point, name) {
  if (!point || typeof point !== "object")
    throw new TypeError(`Invalid ${name}`);
  for (const axis of ["x", "y", "z"]) finite(point[axis], `${name}.${axis}`);
}

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frame-rate-independent exponential smoothing; speed is a response rate per second. */
export function damp(current, target, speed, dt) {
  for (const [name, value] of Object.entries({ current, target, speed, dt }))
    finite(value, name);
  if (speed < 0 || dt < 0)
    throw new RangeError("Negative smoothing time or rate");
  if (!dt || !speed) return current;
  const amount = -Math.expm1(-Math.min(700, speed * dt));
  if (amount === 1) return target;
  // A convex combination also works when target - current would overflow.
  return current * (1 - amount) + target * amount;
}

/** Deterministic ellipsoidal arrangement with balanced studio materials. */
export function createBodies({ seed = 913, count = 24 } = {}) {
  if (!Number.isSafeInteger(seed))
    throw new RangeError("Seed must be a safe integer");
  if (!Number.isInteger(count) || count < 0 || count > 96)
    throw new RangeError("Body count must be between 0 and 96");
  const random = randomSource(seed);
  const offset = random() * TAU;
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 2.399963229728653 + offset;
    const elevation = 1 - 2 * ((index * 0.618033988749895 + 0.31) % 1);
    const radius = Math.cbrt((index + 0.55) / Math.max(count, 1));
    const circle = Math.sqrt(1 - elevation * elevation);
    const x = clamp(
      Math.cos(angle) * circle * radius * 6.8 + (random() - 0.5) * 0.35,
      -6.9,
      6.9,
    );
    const y = clamp(
      Math.sin(angle) * circle * radius * 3.45 + (random() - 0.5) * 0.25,
      -3.6,
      3.6,
    );
    const z = clamp(
      elevation * radius * 2.65 + (random() - 0.5) * 0.25,
      -2.8,
      2.8,
    );
    const spinX = (random() - 0.5) * 0.16;
    const spinY = (random() - 0.5) * 0.16;
    const spinZ = (random() - 0.5) * 0.12;
    return {
      x,
      y,
      z,
      vx: (random() - 0.5) * 0.08,
      vy: (random() - 0.5) * 0.08,
      vz: (random() - 0.5) * 0.08,
      rx: random() * TAU,
      ry: random() * TAU,
      rz: random() * TAU,
      wx: spinX,
      wy: spinY,
      wz: spinZ,
      homeX: x,
      homeY: y,
      homeZ: z,
      scale: 0.8 + random() * 0.4,
      material: index % 3,
      // Rest spin and a tiny home drift prevent the idle sculpture from freezing.
      spinX,
      spinY,
      spinZ,
      phase: random() * TAU,
      age: 0,
    };
  });
}

function limitVelocity(body, maximum = 12) {
  const length = Math.hypot(body.vx, body.vy, body.vz);
  if (length > maximum) {
    const ratio = maximum / length;
    body.vx *= ratio;
    body.vy *= ratio;
    body.vz *= ratio;
  }
}

function guardBounds(body, bounds) {
  for (const [axis, velocity] of [
    ["x", "vx"],
    ["y", "vy"],
    ["z", "vz"],
  ]) {
    if (Math.abs(body[axis]) > bounds[axis]) {
      const sign = Math.sign(body[axis]);
      body[axis] = sign * bounds[axis];
      if (body[velocity] * sign > 0) body[velocity] *= -0.12;
    }
  }
}

function separateBodies(bodies, draggedIndex) {
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      const first = bodies[a],
        second = bodies[b];
      let dx = second.x - first.x,
        dy = second.y - first.y,
        dz = second.z - first.z;
      let distance = Math.hypot(dx, dy, dz);
      const minimum = (first.scale + second.scale) * 0.86;
      if (distance >= minimum) continue;
      if (distance < 1e-8) {
        // Coincident centers have no geometric normal; choose one deterministically.
        const angle = (a * 17 + b * 31 + 1) * 2.399963229728653;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dz = (b % 2 ? 1 : -1) * 0.35;
        const length = Math.hypot(dx, dy, dz);
        dx /= length;
        dy /= length;
        dz /= length;
        distance = 0;
      } else {
        dx /= distance;
        dy /= distance;
        dz /= distance;
      }
      const inverseA = (a === draggedIndex ? 0.25 : 1) / first.scale ** 3;
      const inverseB = (b === draggedIndex ? 0.25 : 1) / second.scale ** 3;
      const inverseSum = inverseA + inverseB;
      const correction =
        (Math.max(0, minimum - distance - 0.005) * 0.52) / inverseSum;
      first.x -= dx * correction * inverseA;
      first.y -= dy * correction * inverseA;
      first.z -= dz * correction * inverseA;
      second.x += dx * correction * inverseB;
      second.y += dy * correction * inverseB;
      second.z += dz * correction * inverseB;
      const closing =
        (second.vx - first.vx) * dx +
        (second.vy - first.vy) * dy +
        (second.vz - first.vz) * dz;
      if (closing < 0) {
        const impulse = (-closing * 1.18) / inverseSum;
        first.vx -= dx * impulse * inverseA;
        first.vy -= dy * impulse * inverseA;
        first.vz -= dz * impulse * inverseA;
        second.vx += dx * impulse * inverseB;
        second.vy += dy * impulse * inverseB;
        second.vz += dz * impulse * inverseB;
        const spin = Math.min(0.06, impulse * 0.015);
        first.wx -= dy * spin;
        first.wz += dx * spin;
        second.wx += dy * spin;
        second.wz -= dx * spin;
      }
    }
  }
}

/** Advance at most 0.1 seconds, subdividing long frames. Positions are body centers. */
export function stepBodies(
  bodies,
  dt,
  { pointer = null, drag = null, bounds = DEFAULT_BOUNDS } = {},
) {
  validateBodies(bodies);
  finite(dt, "dt");
  if (dt < 0) throw new RangeError("Negative frame time");
  validatePoint(bounds, "bounds");
  if (
    [bounds.x, bounds.y, bounds.z].some((value) => value <= 0 || value > 10000)
  )
    throw new RangeError("Bounds must be positive and at most 10000");
  if (pointer !== null) {
    validatePoint(pointer, "pointer");
    if (typeof pointer.active !== "boolean")
      throw new TypeError("Pointer active must be boolean");
  }
  if (drag !== null) {
    validatePoint(drag, "drag");
    if (
      !Number.isInteger(drag.index) ||
      drag.index < 0 ||
      drag.index >= bodies.length
    )
      throw new RangeError("Invalid dragged body");
  }
  if (!dt || !bodies.length) return bodies;
  const elapsed = Math.min(dt, 0.1);
  const steps = Math.ceil(elapsed / (1 / 120));
  const h = elapsed / steps;
  const draggedIndex = drag?.index ?? -1;
  for (let step = 0; step < steps; step++) {
    for (let index = 0; index < bodies.length; index++) {
      const body = bodies[index];
      guardBounds(body, bounds);
      limitVelocity(body);
      body.age = (Number.isFinite(body.age) ? body.age : 0) + h;
      const phase = Number.isFinite(body.phase) ? body.phase : index;
      const drift = Math.sin(body.age * 0.45 + phase) * 0.045;
      const selected = index === draggedIndex;
      const stiffness = selected ? 90 : 2.2;
      const damping = selected ? 19 : 3.1;
      const target = selected
        ? drag
        : {
            x: clamp(body.homeX, -bounds.x, bounds.x) + drift,
            y:
              clamp(body.homeY, -bounds.y, bounds.y) +
              Math.cos(body.age * 0.37 + phase) * 0.075,
            z: clamp(body.homeZ, -bounds.z, bounds.z) + drift * 0.6,
          };
      for (const [axis, velocity] of [
        ["x", "vx"],
        ["y", "vy"],
        ["z", "vz"],
      ]) {
        const inset = Math.min(bounds[axis] * 0.25, body.scale * 0.5);
        const destination = clamp(
          target[axis],
          -bounds[axis] + inset,
          bounds[axis] - inset,
        );
        const excess = Math.max(
          0,
          Math.abs(body[axis]) - (bounds[axis] - inset),
        );
        body[velocity] +=
          ((destination - body[axis]) * stiffness -
            body[velocity] * damping -
            Math.sign(body[axis]) * excess * 35) *
          h;
      }
      if (pointer?.active && !selected) {
        let dx = body.x - pointer.x,
          dy = body.y - pointer.y,
          dz = body.z - pointer.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 3) {
          if (distance < 1e-8) {
            dx = Math.cos(index + 1);
            dy = Math.sin(index + 1);
            dz = 0.3;
          }
          const normal = Math.hypot(dx, dy, dz);
          const weight = (1 - distance / 3) ** 2;
          const impulse = (32 * weight * h) / Math.max(normal, 1e-8);
          body.vx += dx * impulse;
          body.vy += dy * impulse;
          body.vz += dz * impulse;
          body.wy += weight * h * 0.3;
        }
      }
      limitVelocity(body);
      body.x += body.vx * h;
      body.y += body.vy * h;
      body.z += body.vz * h;
      for (const [angle, angular, rest] of [
        ["rx", "wx", "spinX"],
        ["ry", "wy", "spinY"],
        ["rz", "wz", "spinZ"],
      ]) {
        const baseline = Number.isFinite(body[rest]) ? body[rest] : 0;
        body[angular] = clamp(damp(body[angular], baseline, 1.6, h), -2.5, 2.5);
        body[angle] = ((body[angle] % TAU) + body[angular] * h) % TAU;
      }
    }
    separateBodies(bodies, draggedIndex);
    separateBodies(bodies, draggedIndex);
    for (const body of bodies) {
      guardBounds(body, bounds);
      limitVelocity(body);
    }
  }
  return bodies;
}

/** A bounded coordinated impulse for an explicit palette change or scene reset. */
export function kickBodies(bodies, phase = 0) {
  validateBodies(bodies);
  finite(phase, "phase");
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index];
    limitVelocity(body, 9);
    const angle = index * 2.399963229728653 + phase;
    const length = Math.hypot(body.x, body.y, body.z);
    const dx = length > 1e-8 ? body.x / length : Math.cos(angle);
    const dy = length > 1e-8 ? body.y / length : Math.sin(angle);
    const dz = length > 1e-8 ? body.z / length : 0.25;
    const strength = 3.2 + (Math.sin(angle) + 1) * 0.7;
    body.vx += dx * strength;
    body.vy += dy * strength + 0.45;
    body.vz += dz * strength;
    body.wx = clamp(body.wx + Math.sin(angle * 0.7) * 0.85, -2.5, 2.5);
    body.wy = clamp(body.wy + Math.cos(angle) * 0.85, -2.5, 2.5);
    body.wz = clamp(body.wz + Math.sin(angle) * 0.65, -2.5, 2.5);
    limitVelocity(body, 9);
  }
  return bodies;
}
