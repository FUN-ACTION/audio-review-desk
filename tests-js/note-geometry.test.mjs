import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  NOTE_KINDS,
  createNoteGeometry,
} from "../src/audio_review_desk/static/tour/note-geometry.js";

const meshes = new Map(
  NOTE_KINDS.map((kind) => [kind, createNoteGeometry(kind)]),
);
const vertex = (array, index) =>
  Array.from(array.subarray(index * 3, index * 3 + 3));
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const fingerprint = ({ positions, normals, indices }) => {
  const hash = createHash("sha256");
  for (const array of [positions, normals, indices])
    hash.update(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
    );
  return hash.digest("hex");
};

test("music sculptures are reproducible, distinct and independently allocated", () => {
  assert.deepEqual([...NOTE_KINDS].sort(), [
    "beamed",
    "clef",
    "eighth",
    "quarter",
  ]);
  assert.equal(
    new Set([...meshes.values()].map(fingerprint)).size,
    NOTE_KINDS.length,
  );
  for (const [kind, mesh] of meshes) {
    const second = createNoteGeometry(kind);
    assert.equal(fingerprint(second), fingerprint(mesh), kind);
    assert.notEqual(second.positions, mesh.positions, kind);
    second.positions.fill(NaN);
    assert.equal(
      fingerprint(createNoteGeometry(kind)),
      fingerprint(mesh),
      kind,
    );
  }
});

test("packed meshes have finite positions, unit normals and valid triangle indices", () => {
  for (const [kind, { positions, normals, indices }] of meshes) {
    assert.ok(positions instanceof Float32Array, kind);
    assert.ok(normals instanceof Float32Array, kind);
    assert.ok(
      indices instanceof Uint16Array || indices instanceof Uint32Array,
      kind,
    );
    assert.equal(positions.length % 3, 0, kind);
    assert.equal(normals.length, positions.length, kind);
    assert.equal(indices.length % 3, 0, kind);
    assert.ok(positions.length > 0 && indices.length > 0, kind);
    assert.ok(positions.every(Number.isFinite), kind);
    assert.ok(normals.every(Number.isFinite), kind);
    assert.ok(
      indices.every((index) => index < positions.length / 3),
      kind,
    );
    for (let i = 0; i < normals.length / 3; i++)
      assert.ok(
        Math.abs(Math.hypot(...vertex(normals, i)) - 1) < 2e-6,
        `${kind} normal ${i}`,
      );
  }
});

test("bevel and cap triangles are nondegenerate and face their surface normals", () => {
  for (const [kind, { positions, normals, indices }] of meshes) {
    for (let i = 0; i < indices.length; i += 3) {
      const ids = [indices[i], indices[i + 1], indices[i + 2]],
        [a, b, c] = ids.map((index) => vertex(positions, index)),
        geometricNormal = cross(subtract(b, a), subtract(c, a)),
        twiceArea = Math.hypot(...geometricNormal),
        averageNormal = [0, 1, 2].map(
          (axis) =>
            ids.reduce((sum, index) => sum + normals[index * 3 + axis], 0) / 3,
        );
      assert.ok(twiceArea > 1e-12, `${kind} collapsed triangle ${i / 3}`);
      assert.ok(
        dot(geometricNormal, averageNormal) / twiceArea > 1e-5,
        `${kind} reversed triangle ${i / 3}`,
      );
    }
  }
});

test("each sculpture is one closed consistently oriented shell after welding cap seams", () => {
  for (const [kind, { positions, indices }] of meshes) {
    const welded = new Map(),
      ids = [],
      edges = new Map(),
      neighbors = new Map();
    for (let i = 0; i < positions.length / 3; i++) {
      const key = vertex(positions, i)
        .map((value) => Math.round(value * 1e6))
        .join(",");
      if (!welded.has(key)) welded.set(key, welded.size);
      ids.push(welded.get(key));
    }
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [
        ids[indices[i]],
        ids[indices[i + 1]],
        ids[indices[i + 2]],
      ];
      assert.equal(
        new Set(triangle).size,
        3,
        `${kind} collapsed welded face ${i / 3}`,
      );
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge],
          b = triangle[(edge + 1) % 3],
          key = `${Math.min(a, b)}:${Math.max(a, b)}`,
          record = edges.get(key) ?? { count: 0, direction: 0 };
        record.count++;
        record.direction += a < b ? 1 : -1;
        edges.set(key, record);
        if (!neighbors.has(a)) neighbors.set(a, new Set());
        neighbors.get(a).add(b);
      }
    }
    for (const [key, edge] of edges) {
      assert.equal(edge.count, 2, `${kind} open or non-manifold edge ${key}`);
      assert.equal(
        edge.direction,
        0,
        `${kind} inconsistent winding at edge ${key}`,
      );
    }
    const reached = new Set(),
      pending = [0];
    while (pending.length) {
      const current = pending.pop();
      if (reached.has(current)) continue;
      reached.add(current);
      for (const next of neighbors.get(current) ?? [])
        if (!reached.has(next)) pending.push(next);
    }
    assert.equal(reached.size, welded.size, `${kind} disconnected surface`);
  }
});

test("sculptures enclose positive three-dimensional volume with outward winding", () => {
  for (const [kind, { positions, indices }] of meshes) {
    const bounds = [0, 1, 2].map((axis) => {
      const values = Array.from(
        { length: positions.length / 3 },
        (_, i) => positions[i * 3 + axis],
      );
      return Math.max(...values) - Math.min(...values);
    });
    assert.ok(
      bounds[0] > 0.5 && bounds[1] > 1 && bounds[2] > 0.05,
      `${kind} flat bounds`,
    );
    let volume = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map(
        (index) => vertex(positions, index),
      );
      volume += dot(a, cross(b, c)) / 6;
    }
    const boundingVolume = bounds.reduce(
      (product, value) => product * value,
      1,
    );
    assert.ok(
      volume > boundingVolume * 0.01,
      `${kind} negative or negligible volume`,
    );
    assert.ok(volume < boundingVolume, `${kind} volume exceeds bounds`);
  }
});

test("unknown sculpture kinds fail explicitly", () => {
  for (const kind of [undefined, null, "", "connector", "eighth-rest", 42, {}])
    assert.throws(() => createNoteGeometry(kind), RangeError);
});
