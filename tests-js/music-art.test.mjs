import test from "node:test";
import assert from "node:assert/strict";
import { staffPoint, resonancePoint } from "../src/audio_review_desk/static/tour/music-art.js";
import { makeRibbon, createMusicRenderer } from "../src/audio_review_desk/static/tour/music-shader.js";

test("music staff is continuous with finite slopes through long animation runs", () => {
  for (const kind of ["score", "flow"]) {
    for (const time of [0, .016, 15, 90, 3600]) {
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const p = staffPoint(t, time, kind);
        assert.ok(Object.values(p).every(Number.isFinite));
        assert.ok(Math.abs(p.angle) < 45);
        assert.ok(p.y > 200 && p.y < 410);
        const adjacent = staffPoint(t + .00001, time, kind);
        assert.ok(Math.hypot(adjacent.x - p.x, adjacent.y - p.y) < .02);
      }
    }
  }
  assert.throws(() => staffPoint(NaN), RangeError);
  assert.throws(() => staffPoint(0, Infinity), RangeError);
  assert.throws(() => staffPoint(0, 0, "unknown"), RangeError);
});

test("resonance strands form closed bounded curves without invalid coordinates", () => {
  for (let strand = 0; strand < 28; strand++) {
    const phase = strand / 28 * Math.PI * 2;
    const start = resonancePoint(0, phase);
    const end = resonancePoint(Math.PI * 2, phase);
    for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(start[axis] - end[axis]) < 1e-12);
    for (let i = 0; i <= 100; i++) {
      const point = resonancePoint(i / 100 * Math.PI * 2, phase);
      assert.ok(Object.values(point).every(Number.isFinite));
      assert.ok(Math.hypot(point.x, point.y, point.z) < 2.5);
    }
  }
  assert.throws(() => resonancePoint(Infinity), RangeError);
});

test("material ribbons have finite unit normals, valid triangles, and closed seams", () => {
  const segments = 48, sides = 16;
  for (const kind of ["score", "flow", "resonance"]) {
    const { vertices, indices } = makeRibbon(kind, 0, segments, sides);
    const count = vertices.length / 8;
    assert.ok(count < 65536);
    assert.ok(vertices.every(Number.isFinite));
    for (let i = 0; i < count; i++) {
      const offset = i * 8;
      const length = Math.hypot(...vertices.slice(offset + 3, offset + 6));
      assert.ok(Math.abs(length - 1) < 1e-5);
      assert.ok(Math.hypot(...vertices.slice(offset, offset + 3)) < 4.6);
    }
    assert.ok(indices.every((index) => index >= 0 && index < count));
    for (let side = 0; side < sides; side++) {
      const start = (kind === "resonance" ? (side + sides / 2) % sides : side) * 8;
      const end = (segments * (sides + 1) + side) * 8;
      for (let axis = 0; axis < 3; axis++)
        assert.ok(Math.abs(vertices[start + axis] - vertices[end + axis]) < 1e-5, `${kind} seam`);
    }
  }
});

test("unsupported graphics returns a fallback and mesh budgets reject invalid inputs", () => {
  assert.equal(createMusicRenderer({ getContext() { return null; } }), null);
  const warn = console.warn;
  const messages = [];
  try {
    console.warn = (...args) => messages.push(args.join(" "));
    assert.equal(createMusicRenderer({ getContext() { throw Error("Graphics blocked"); } }), null);
  } finally { console.warn = warn; }
  assert.equal(messages.length, 1);
  assert.match(messages[0], /WebGL2 context.*Graphics blocked/);
  for (const args of [["unknown"], ["score", -1], ["score", 3], ["score", 0, 1], ["score", 0, 280, 2], ["score", 0, 5000, 16]])
    assert.throws(() => makeRibbon(...args), RangeError);
});

test("allocation faults return a fallback and release every partial WebGL resource", () => {
  const faults = [
    ["Shader", 1], ["Shader", 2], ["Shader", 4],
    ["Program", 1], ["Program", 2],
    ["Buffer", 1], ["Buffer", 3],
    ["VertexArray", 1], ["VertexArray", 3],
    ["Texture", 1], ["Framebuffer", 1],
  ];
  const warn = console.warn, messages = [];
  try {
    console.warn = (...args) => messages.push(args.join(" "));
    for (const [failedType, failedAttempt] of faults) {
      const live = new Set(), created = new Set(), deleted = new Set(),
        calls = new Map(), constants = new Map(), methods = {};
      let serial = 0;
      for (const type of ["Shader", "Program", "Buffer", "VertexArray", "Texture", "Framebuffer"]) {
        methods[`create${type}`] = () => {
          const attempt = (calls.get(type) ?? 0) + 1;
          calls.set(type, attempt);
          if (type === failedType && attempt === failedAttempt) return null;
          const resource = { type, serial: ++serial };
          created.add(resource);
          live.add(resource);
          return resource;
        };
        methods[`delete${type}`] = (resource) => {
          if (resource === null) return;
          assert.equal(resource.type, type, "resources must use their matching deleter");
          deleted.add(resource);
          live.delete(resource);
        };
      }
      const gl = new Proxy({
        ...methods,
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getUniformLocation: () => ({}),
        checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
      }, {
        get(target, key) {
          if (key in target) return target[key];
          if (typeof key === "string" && /^[A-Z][A-Z0-9_]*$/.test(key)) {
            if (!constants.has(key)) constants.set(key, constants.size + 1);
            return constants.get(key);
          }
          return () => {};
        },
      });
      const label = `${failedType} allocation ${failedAttempt}`;
      assert.equal(createMusicRenderer({ getContext: () => gl }), null, label);
      assert.equal(calls.get(failedType), failedAttempt, `${label} must be reached`);
      assert.equal(live.size, 0, `${label} leaked a resource`);
      assert.equal(deleted.size, created.size, `${label} must clean up every allocation`);
    }
  } finally { console.warn = warn; }
  assert.equal(messages.length, faults.length);
  assert.ok(messages.every((message) => /allocation failed/.test(message)));
});

test("tight harmonic bends preserve face winding and smooth normal direction", () => {
  const { vertices: v, indices } = makeRibbon("flow");
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 8, b = indices[i + 1] * 8, c = indices[i + 2] * 8;
    const u = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
    const w = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const length = Math.hypot(...n);
    assert.ok(length > 1e-10, "triangle must have a nonzero area");
    const alignment = (n[0] * v[a + 3] + n[1] * v[a + 4] + n[2] * v[a + 5]) / length;
    assert.ok(alignment > .35, "normal must face in the same direction as its triangle");
  }
});
