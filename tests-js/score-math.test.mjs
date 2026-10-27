import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceScore,
  createScore,
  criticalStep,
  nearestNote,
  notePose,
  pitchFrequency,
  pluckScore,
  scoreY,
  staffCenter,
} from "../src/audio_review_desk/static/tour/score-math.js";

test("score engraving is deterministic, balanced and contains real rhythmic pairs", () => {
  const score = createScore();
  assert.deepEqual(score, createScore());
  assert.notDeepEqual(score, createScore({ seed: 20 }));
  assert.deepEqual(
    [0, 1, 2].map(
      (row) => score.notes.filter((note) => note.row === row).length,
    ),
    [20, 20, 20],
  );
  assert.equal(createScore({ count: 27 }).notes.length, 27);
  assert.equal(createScore({ count: 0 }).notes.length, 0);
  assert.ok(score.notes.some((note) => note.duration === 2));
  for (const note of score.notes.filter((note) => note.beam >= 0))
    assert.equal(note.duration, 0.5);
  for (const input of [
    { count: -1 },
    { count: 121 },
    { count: 3.5 },
    { seed: NaN },
  ])
    assert.throws(() => createScore(input));
});

test("critical response preserves velocity and composes over frame partitions", () => {
  const whole = criticalStep(0.15, -0.28, 0.02, 10, 1);
  let divided = [0.15, -0.28];
  for (let i = 0; i < 120; i++)
    divided = criticalStep(...divided, 0.02, 10, 1 / 120);
  for (let i = 0; i < 2; i++)
    assert.ok(Math.abs(whole[i] - divided[i]) < 1e-12);
  assert.deepEqual(criticalStep(0.2, 0.1, 0, 10, 0), [0.2, 0.1]);
  assert.deepEqual(criticalStep(0.2, 0.1, 0, 10, 1e20), [0, 0]);
  for (const input of [
    [0, 0, 0, 0, 1],
    [0, 0, 0, 10, -1],
    [NaN, 0, 0, 10, 1],
  ])
    assert.throws(() => criticalStep(...input));
});

test("idle score positions and pluck decay agree at 30 and 120 Hz", () => {
  const a = createScore(),
    b = createScore();
  pluckScore(a, 0.4, 0.45);
  pluckScore(b, 0.4, 0.45);
  for (let i = 0; i < 60; i++)
    advanceScore(a, 1 / 30, { pointer: { x: 0.4, y: 0.5, active: true } });
  for (let i = 0; i < 240; i++)
    advanceScore(b, 1 / 120, { pointer: { x: 0.4, y: 0.5, active: true } });
  assert.ok(Math.abs(a.time - b.time) < 1e-12);
  for (let i = 0; i < a.notes.length; i++) {
    const pa = notePose(a, a.notes[i]),
      pb = notePose(b, b.notes[i]);
    assert.ok(Math.abs(pa.x - pb.x) < 1e-12);
    assert.ok(Math.abs(pa.y - pb.y) < 1e-12);
  }
});

test("pluck chooses the actual nearest note and bounds repeated impulses", () => {
  const model = createScore();
  const target = model.notes[8],
    p = notePose(model, target);
  assert.equal(nearestNote(model, p.x, p.y).note.id, target.id);
  const response = pluckScore(model, p.x, p.y);
  assert.equal(response.id, target.id);
  assert.equal(response.frequency, pitchFrequency(target.pitch, target.row));
  for (let i = 0; i < 100; i++) pluckScore(model, 0.5, 0.5, { strength: 100 });
  assert.equal(model.ripples.length, 8);
  assert.ok(model.notes.every((note) => Math.abs(note.vy) <= 0.7));
  for (let i = 0; i < 400; i++) advanceScore(model, 1 / 60);
  assert.equal(model.ripples.length, 0);
  assert.ok(model.notes.every((note) => Math.abs(note.dy) < 1e-10));
});

test("drag retains bounded continuous release motion, even after a delayed frame", () => {
  const model = createScore();
  for (let i = 0; i < 180; i++)
    advanceScore(model, 1 / 60, { drag: { id: 4, x: 10, y: -10 } });
  const note = model.notes[4];
  assert.ok(Math.abs(note.dx) <= 0.22 && Math.abs(note.dy) <= 0.16);
  advanceScore(model, 10);
  for (let i = 0; i < 1200; i++)
    advanceScore(model, i % 3 === 0 ? 1 / 30 : 1 / 120, { audioLevel: i % 2 });
  for (const n of model.notes) {
    for (const key of ["dx", "dy", "vx", "vy", "attack"])
      assert.ok(Number.isFinite(n[key]));
    const p = notePose(model, n);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  assert.ok(model.level >= 0 && model.level <= 1);
  assert.ok(Number.isFinite(scoreY(model, 1, 0.7)));
});

test("bad inputs cannot partially advance the score, and zero time is a no-op", () => {
  const model = createScore(),
    before = structuredClone(model);
  assert.equal(advanceScore(model, 0), model);
  assert.deepEqual(model, before);
  for (const dt of [-1, NaN, Infinity]) {
    assert.throws(() => advanceScore(model, dt));
    assert.deepEqual(model, before);
  }
  for (const args of [
    { pointer: { x: NaN, y: 0 } },
    { drag: { id: 100, x: 0, y: 0 } },
    { audioLevel: Infinity },
  ]) {
    assert.throws(() => advanceScore(model, 0.01, args));
    assert.deepEqual(model, before);
  }
  assert.throws(() => pluckScore(model, NaN, 0));
  assert.deepEqual(model, before);
});

test("score pitch mapping has exact octave relationships and finite musical frequencies", () => {
  for (let pitch = -10; pitch < 15; pitch++) {
    const f = pitchFrequency(pitch);
    assert.ok(f > 0 && Number.isFinite(f));
    assert.ok(Math.abs(pitchFrequency(pitch + 7) / f - 2) < 1e-12);
    assert.ok(Math.abs(pitchFrequency(pitch, 2) / f - 0.5) < 1e-12);
  }
  assert.throws(() => pitchFrequency(1.5));
});

test("staff flow remains continuous across long playback and phase wrap boundaries", () => {
  for (const time of [200, (Math.PI * 2) / 0.22, 3600, 7200])
    for (let row = 0; row < 3; row++)
      assert.ok(
        Math.abs(
          staffCenter(row, 0.6, time - 1e-5) -
            staffCenter(row, 0.6, time + 1e-5),
        ) < 1e-6,
      );
});
