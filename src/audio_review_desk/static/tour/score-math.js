// Geometry and response for the original, continuously engraved score.
const TAU = Math.PI * 2;
const MOTIF = [0, 2, 4, 5, 3, 2, 1, -1, 2, 4, 6, 5, 3, 1, 0, -2, 1, 3, 2, 0];
const RHYTHM = [0.5, 0.5, 1, 0.5, 0.5, 2];
export const lineGap = 0.017;

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
export const wrap = (n) => ((n % 1) + 1) % 1;

export function criticalStep(position, velocity, target, omega, dt) {
  if (
    ![position, velocity, target, omega, dt].every(Number.isFinite) ||
    omega <= 0 ||
    dt < 0
  )
    throw new RangeError("spring values");
  if (!dt) return [position, velocity];
  const decay = Math.exp(-omega * dt);
  if (!decay) return [target, 0];
  const offset = position - target;
  const coefficient = velocity + omega * offset;
  return [
    target + (offset + coefficient * dt) * decay,
    (velocity - omega * coefficient * dt) * decay,
  ];
}

export function createScore({ seed = 5713, count = 60 } = {}) {
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 120
  )
    throw new RangeError("score seed or count");
  let value = seed || 1;
  const random = () => {
    value = Math.imul(value ^ (value >>> 15), 2246822519);
    value = Math.imul(value ^ (value >>> 13), 3266489917);
    return ((value ^= value >>> 16) >>> 0) / 4294967296;
  };
  const notes = [];
  for (let row = 0; row < 3; row++) {
    const size = Math.floor(count / 3) + (row < count % 3 ? 1 : 0);
    const durations = Array.from(
      { length: size },
      (_, i) => RHYTHM[i % RHYTHM.length],
    );
    const total = durations.reduce((sum, n) => sum + n, 0);
    let beat = 0;
    for (let i = 0; i < size; i++) {
      const phase = beat / total + row * 0.065;
      const phrase = Math.floor(random() * 3);
      const pitch = MOTIF[(i + row * 4) % MOTIF.length] + phrase - 1;
      notes.push({
        id: notes.length,
        row,
        phase,
        pitch,
        duration: durations[i],
        beam: durations[i] === 0.5 ? row * 100 + Math.floor(i / 3) : -1,
        accent: (i + row) % 7 === 0,
        dx: 0,
        dy: 0,
        vx: 0,
        vy: 0,
        attack: 0,
      });
      beat += durations[i];
    }
  }
  return {
    time: 0,
    notes,
    ripples: [],
    level: 0,
    pointer: { x: 0.5, y: 0.5, vx: 0, vy: 0, strength: 0 },
  };
}

export function staffCenter(row, x, time = 0) {
  if (![row, x, time].every(Number.isFinite))
    throw new RangeError("staff point");
  return (
    0.22 +
    row * 0.262 +
    0.058 * Math.sin((x - 0.05) * TAU * 0.66 + row * 0.6) +
    0.012 * Math.sin(x * TAU * 0.8 + ((time * 0.22) % TAU) + row)
  );
}

export function scoreY(model, row, x) {
  let y = staffCenter(row, x, model.time);
  y +=
    model.level *
    0.006 *
    Math.sin(x * TAU * 1.4 - model.time * 3.2 + row * 0.8);
  const pointer = model.pointer;
  const distance = x - pointer.x;
  const rowDistance = staffCenter(row, pointer.x, model.time) - pointer.y;
  y +=
    pointer.strength *
    0.023 *
    Math.exp(-distance * distance * 35 - rowDistance * rowDistance * 19);
  for (const ripple of model.ripples) {
    const age = model.time - ripple.at;
    const dx = x - ripple.x;
    y +=
      Math.sin(dx * 27 - age * 8) *
      0.026 *
      ripple.strength *
      Math.exp(
        -Math.abs(dx) * 4.5 - age * 2.4 - Math.abs(row - ripple.row) * 1.8,
      );
  }
  return y;
}

export function notePose(model, note) {
  const x =
    wrap(note.phase - model.time * (0.0105 + note.row * 0.0008)) * 1.3 - 0.15;
  return {
    x: x + note.dx,
    y: scoreY(model, note.row, x) - (note.pitch * lineGap) / 2 + note.dy,
  };
}

export function pitchFrequency(pitch, row = 0) {
  if (!Number.isInteger(pitch) || !Number.isInteger(row))
    throw new RangeError("pitch");
  const degree = pitch + 7;
  const steps = [0, 2, 4, 5, 7, 9, 11];
  const midi =
    48 +
    Math.floor(degree / 7) * 12 +
    steps[((degree % 7) + 7) % 7] +
    (row === 2 ? -12 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

export function nearestNote(model, x, y, aspect = 2) {
  if (![x, y, aspect].every(Number.isFinite) || aspect <= 0)
    throw new RangeError("pointer point");
  let nearest = null;
  let distance = Infinity;
  for (const note of model.notes) {
    const point = notePose(model, note);
    const next = Math.hypot((point.x - x) * aspect, point.y - y);
    if (next < distance) {
      nearest = note;
      distance = next;
    }
  }
  return { note: nearest, distance };
}

export function pluckScore(model, x, y, { strength = 1, aspect = 2 } = {}) {
  if (
    ![x, y, strength, aspect].every(Number.isFinite) ||
    strength < 0 ||
    aspect <= 0
  )
    throw new RangeError("pluck point");
  const hit = nearestNote(model, x, y, aspect);
  const amount = clamp(strength, 0, 1.5);
  const row = hit.note?.row ?? clamp(Math.round((y - 0.22) / 0.262), 0, 2);
  model.ripples.push({
    x: clamp(x, 0, 1),
    row,
    at: model.time,
    strength: amount,
  });
  if (model.ripples.length > 8) model.ripples.shift();
  if (hit.note) {
    hit.note.attack = 1;
    hit.note.vy = clamp(hit.note.vy - amount * 0.19, -0.7, 0.7);
  }
  return hit.note
    ? {
        id: hit.note.id,
        row,
        frequency: pitchFrequency(hit.note.pitch, row),
        velocity: Math.min(1, amount),
      }
    : null;
}

export function advanceScore(
  model,
  dt,
  { pointer = null, audioLevel = 0, drag = null } = {},
) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(audioLevel))
    throw new RangeError("score time");
  if (pointer && ![pointer.x, pointer.y].every(Number.isFinite))
    throw new RangeError("score pointer");
  if (
    drag &&
    (!Number.isInteger(drag.id) ||
      !model.notes[drag.id] ||
      ![drag.x, drag.y].every(Number.isFinite))
  )
    throw new RangeError("score drag");
  if (
    !Number.isFinite(model.time) ||
    !Number.isFinite(model.level) ||
    ![
      model.pointer.x,
      model.pointer.y,
      model.pointer.vx,
      model.pointer.vy,
      model.pointer.strength,
    ].every(Number.isFinite) ||
    !model.notes.every((note) =>
      [
        note.dx,
        note.dy,
        note.vx,
        note.vy,
        note.attack,
        note.phase,
        note.pitch,
        note.row,
      ].every(Number.isFinite),
    )
  )
    throw new RangeError("score state");
  if (!dt) return model;
  const step = Math.min(dt, 0.1);
  model.time += step;
  model.level +=
    (clamp(audioLevel, 0, 1) - model.level) * (1 - Math.exp(-12 * step));
  if (pointer) {
    [model.pointer.x, model.pointer.vx] = criticalStep(
      model.pointer.x,
      model.pointer.vx,
      clamp(pointer.x, -0.2, 1.2),
      16,
      step,
    );
    [model.pointer.y, model.pointer.vy] = criticalStep(
      model.pointer.y,
      model.pointer.vy,
      clamp(pointer.y, -0.2, 1.2),
      16,
      step,
    );
  }
  model.pointer.strength +=
    ((pointer?.active ? 1 : 0) - model.pointer.strength) *
    (1 - Math.exp(-10 * step));
  model.ripples = model.ripples.filter(
    (ripple) => model.time - ripple.at < 2.5,
  );
  for (const note of model.notes) {
    if (drag?.id === note.id) {
      const baseX =
        wrap(note.phase - model.time * (0.0105 + note.row * 0.0008)) * 1.3 -
        0.15;
      const baseY = scoreY(model, note.row, baseX) - (note.pitch * lineGap) / 2;
      const nextX = clamp(drag.x - baseX, -0.22, 0.22),
        nextY = clamp(drag.y - baseY, -0.16, 0.16);
      note.vx = clamp((nextX - note.dx) / step, -0.8, 0.8);
      note.vy = clamp((nextY - note.dy) / step, -0.8, 0.8);
      note.dx = nextX;
      note.dy = nextY;
      note.attack = 0.8;
    } else {
      [note.dx, note.vx] = criticalStep(note.dx, note.vx, 0, 10, step);
      [note.dy, note.vy] = criticalStep(note.dy, note.vy, 0, 10, step);
      note.attack *= Math.exp(-4.2 * step);
    }
  }
  return model;
}
