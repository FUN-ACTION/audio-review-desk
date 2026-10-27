import { MarchingCubes, MeshBasicMaterial } from "./scene-vendor.js?v=0.9.0";
// Original music sculptures, generated without font outlines or model assets.
// The flat signs are one closed, rounded extrusion; the clef is a continuous
// sculpted ribbon. The data is renderer-independent so topology can be tested.
export const NOTE_KINDS = Object.freeze([
  "quarter",
  "eighth",
  "beamed",
  "clef",
]);

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

function path() {
  const points = [];
  let current = [0, 0];
  const push = (x, y) => {
    if (!points.length || Math.hypot(x - current[0], y - current[1]) > EPSILON)
      points.push([x, y]);
    current = [x, y];
  };
  const api = {
    points,
    line(x, y) {
      push(x, y);
      return api;
    },
    cubic(x1, y1, x2, y2, x3, y3, segments = 18) {
      const [x0, y0] = current;
      for (let step = 1; step <= segments; step++) {
        const t = step / segments,
          s = 1 - t;
        push(
          s ** 3 * x0 + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t ** 3 * x3,
          s ** 3 * y0 + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t ** 3 * y3,
        );
      }
      return api;
    },
    quadratic(x1, y1, x2, y2, segments = 9) {
      const [x0, y0] = current;
      for (let step = 1; step <= segments; step++) {
        const t = step / segments,
          s = 1 - t;
        push(
          s * s * x0 + 2 * s * t * x1 + t * t * x2,
          s * s * y0 + 2 * s * t * y1 + t * t * y2,
        );
      }
      return api;
    },
  };
  return api;
}

// A tilted oval with its upper-right arc replaced by the attached stem.
// Its tangent is vertical at the outer stem, so there is no joint or seam.
function head(sign, cx, cy, rx = 0.5, ry = 0.31, tilt = 0.14) {
  const end = Math.acos((rx - 0.22) / rx) - TAU;
  for (let step = 0; step <= 45; step++) {
    const angle = (end * step) / 45;
    sign.line(
      cx + rx * Math.cos(angle),
      cy + ry * Math.sin(angle) + tilt * Math.cos(angle),
    );
  }
  return sign;
}

function musicOutline(kind) {
  const sign = path();
  if (kind === "quarter") {
    sign
      .line(0.1, 1)
      .quadratic(0.1, 1.1, 0.21, 1.1)
      .quadratic(0.32, 1.1, 0.32, 1);
    head(sign, -0.18, -0.72);
  } else if (kind === "eighth") {
    sign
      .line(0.1, 1)
      .quadratic(0.1, 1.1, 0.21, 1.1)
      .quadratic(0.31, 1.1, 0.34, 0.98)
      .cubic(0.4, 0.82, 0.73, 0.85, 0.83, 0.59)
      .cubic(0.94, 0.31, 0.87, 0.1, 0.72, -0.04)
      .quadratic(0.64, -0.15, 0.57, -0.04)
      .quadratic(0.53, 0.02, 0.59, 0.11)
      .cubic(0.75, 0.35, 0.6, 0.51, 0.32, 0.6);
    head(sign, -0.18, -0.72);
  } else {
    sign.line(-0.47, 1.04).line(1.02, 1.25);
    head(sign, 0.52, -0.51);
    sign.line(0.8, 0.95).line(-0.25, 0.8);
    head(sign, -0.75, -0.72);
  }
  return sign.points;
}

function centered(points, height = 2.35) {
  const xs = points.map((point) => point[0]),
    ys = points.map((point) => point[1]);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    bottom = Math.min(...ys),
    top = Math.max(...ys),
    scale = height / (top - bottom);
  return {
    scale,
    points: points.map(([x, y]) => [
      (x - (left + right) / 2) * scale,
      (y - (bottom + top) / 2) * scale,
    ]),
  };
}

function finish(positions, normals, indices) {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices:
      positions.length / 3 > 65535
        ? new Uint32Array(indices)
        : new Uint16Array(indices),
  };
}

function signedDistance(x, y, points) {
  let minimum = Infinity,
    inside = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = Math.max(
        0,
        Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
      );
    minimum = Math.min(
      minimum,
      Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t),
    );
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside ? -minimum : minimum;
}

// Sample a rounded, gently swollen extrusion on a regular volume. This avoids
// long cap triangles at the head/stem junction and gives smooth reflected light.
// MarchingCubes is used only as a CPU mesher; no WebGL context is constructed.
function extrude(points, depth = 0.52, bevel = 0.08) {
  points = centered(points).points;
  const resolution = 72,
    extent = 1.5,
    plane = resolution * resolution,
    distances = new Float32Array(plane),
    swell = new Float32Array(plane);
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const index = x + y * resolution,
        d = signedDistance(
          ((x / resolution) * 2 - 1) * extent,
          ((y / resolution) * 2 - 1) * extent,
          points,
        );
      distances[index] = d + bevel;
      swell[index] = 0.12 * (1 - Math.exp(-Math.max(0, -d - bevel) * 12)) ** 2;
    }
  }
  const material = new MeshBasicMaterial(),
    marching = new MarchingCubes(resolution, material, false, false, 50000);
  marching.isolation = 0;
  for (let z = 0; z < resolution; z++) {
    const axial =
      Math.abs(((z / resolution) * 2 - 1) * extent) - depth / 2 + bevel;
    for (let i = 0; i < plane; i++) {
      const dx = distances[i],
        dz = axial - swell[i];
      marching.field[z * plane + i] =
        bevel -
        (Math.min(Math.max(dx, dz), 0) +
          Math.hypot(Math.max(dx, 0), Math.max(dz, 0)));
    }
  }
  marching.update();
  const rawPositions = marching.geometry.attributes.position.array,
    rawNormals = marching.geometry.attributes.normal.array,
    positions = [],
    normals = [],
    indices = [];
  for (let at = 0; at < marching.count * 3; at += 9) {
    const ax = rawPositions[at + 3] - rawPositions[at],
      ay = rawPositions[at + 4] - rawPositions[at + 1],
      az = rawPositions[at + 5] - rawPositions[at + 2],
      bx = rawPositions[at + 6] - rawPositions[at],
      by = rawPositions[at + 7] - rawPositions[at + 1],
      bz = rawPositions[at + 8] - rawPositions[at + 2],
      fx = ay * bz - az * by,
      fy = az * bx - ax * bz,
      fz = ax * by - ay * bx;
    if (Math.hypot(fx, fy, fz) < 1e-12) continue;
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = at + vertex * 3;
      let nx = rawNormals[index],
        ny = rawNormals[index + 1],
        nz = rawNormals[index + 2];
      let length = Math.hypot(nx, ny, nz);
      if (length < 1e-12) {
        nx = fx;
        ny = fy;
        nz = fz;
        length = Math.hypot(nx, ny, nz);
      }
      indices.push(positions.length / 3);
      positions.push(
        rawPositions[index] * extent,
        rawPositions[index + 1] * extent,
        rawPositions[index + 2] * extent,
      );
      normals.push(nx / length, ny / length, nz / length);
    }
  }
  marching.geometry.dispose();
  material.dispose();
  return finish(positions, normals, indices);
}
function clefRibbon() {
  const sign = path();
  sign
    .line(-0.18, -1.27)
    .cubic(-0.62, -1.43, -0.79, -1.01, -0.44, -0.9)
    .cubic(-0.14, -0.82, 0.24, -1.02, 0.15, -0.56)
    .cubic(0.02, 0.05, -0.25, 0.86, -0.23, 1.35)
    .cubic(-0.2, 1.94, 0.09, 1.94, 0.25, 1.53)
    .cubic(0.47, 0.96, -0.32, 0.56, -0.58, 0.14)
    .cubic(-0.98, -0.49, -0.46, -0.89, 0.1, -0.71)
    .cubic(0.77, -0.5, 0.86, 0.15, 0.36, 0.35)
    .cubic(-0.05, 0.51, -0.44, 0.14, -0.2, -0.13)
    .cubic(-0.13, -0.22, 0.01, -0.25, 0.11, -0.16);
  const centeredPath = centered(sign.points, 2.6),
    points = centeredPath.points;
  const positions = [],
    normals = [],
    indices = [],
    segments = 16,
    halfWidth = 0.11 * centeredPath.scale,
    halfDepth = 0.24,
    bevel = Math.min(halfWidth * 0.9, 0.075),
    profile = [];
  // Rounded rectangular section, with a broad reflective face and soft edges.
  for (let corner = 0; corner < 4; corner++) {
    const angle = (corner * Math.PI) / 2;
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (halfWidth - bevel),
      cz = (corner < 2 ? 1 : -1) * (halfDepth - bevel);
    for (let i = 0; i < segments / 4; i++) {
      const theta = angle + ((i / (segments / 4 - 1)) * Math.PI) / 2;
      profile.push({
        x: cx + Math.cos(theta) * bevel,
        z: cz + Math.sin(theta) * bevel,
        nx: Math.cos(theta),
        nz: Math.sin(theta),
      });
    }
  }
  const tangents = points.map((point, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  });
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i],
      [tx, ty] = tangents[i];
    // A slight lift at the diagonal crossing reads as a continuous sculpture.
    const lift =
      i > 36 && i < 72 ? 0.022 * Math.sin(((i - 36) / 36) * Math.PI) : 0;
    for (const p of profile) {
      positions.push(x - ty * p.x, y + tx * p.x, p.z + lift);
      normals.push(-ty * p.nx, tx * p.nx, p.nz);
    }
  }
  for (let row = 0; row < points.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments,
        a = row * segments + i,
        an = row * segments + next,
        b = (row + 1) * segments + i,
        bn = (row + 1) * segments + next;
      indices.push(a, an, bn, a, bn, b);
    }
  }
  for (const end of [0, points.length - 1]) {
    const [x, y] = points[end],
      [tx, ty] = tangents[end],
      side = end ? 1 : -1,
      start = positions.length / 3;
    positions.push(x, y, 0);
    normals.push(side * tx, side * ty, 0);
    for (const p of profile) {
      positions.push(x - ty * p.x, y + tx * p.x, p.z);
      normals.push(side * tx, side * ty, 0);
    }
    for (let i = 0; i < segments; i++) {
      const a = start + 1 + i,
        b = start + 1 + ((i + 1) % segments);
      if (end) indices.push(start, a, b);
      else indices.push(start, b, a);
    }
  }
  return finish(positions, normals, indices);
}

export function createNoteGeometry(kind) {
  if (!NOTE_KINDS.includes(kind))
    throw new RangeError("Unknown musical sculpture");
  return kind === "clef"
    ? clefRibbon()
    : extrude(musicOutline(kind), 0.52, kind === "eighth" ? 0.04 : 0.08);
}
