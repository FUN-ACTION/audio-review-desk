import { createMusicRenderer } from "./music-shader.js?v=0.11.0";

const SVG = "http://www.w3.org/2000/svg";
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
let sequence = 0;

/** The five staff lines and their notes share this continuous curve. */
export function staffPoint(t, time = 0, kind = "score") {
  if (![t, time].every(Number.isFinite) || !["score", "flow"].includes(kind))
    throw new RangeError("Invalid staff coordinate");
  const moving = kind === "flow";
  const phase = moving ? time * .19 : time * .055;
  const amplitude = moving ? 77 : 88;
  const angle = TAU * (t * .93 - .1) - phase;
  const x = -100 + t * 1160;
  const y = 308 + Math.sin(angle) * amplitude + Math.sin(t * 4.8 + time * .17) * 7;
  const slope = (Math.cos(angle) * amplitude * TAU * .93 + Math.cos(t * 4.8 + time * .17) * 33.6) / 1160;
  return { x, y, angle: Math.atan(slope) * 180 / Math.PI };
}

/** A bundle around one closed harmonic knot, projected by the renderer. */
export function resonancePoint(theta, strand = 0) {
  if (![theta, strand].every(Number.isFinite)) throw new RangeError("Invalid resonance coordinate");
  const ring = 1.62 + .52 * Math.cos(theta * 3);
  const width = Math.cos(strand) * .13;
  return {
    x: (ring + width) * Math.cos(theta * 2),
    y: Math.sin(theta * 3) * .84 + Math.sin(strand) * .13,
    z: (ring + width) * Math.sin(theta * 2),
  };
}

function node(tag, attributes = {}, parent) {
  const item = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value);
  parent?.append(item);
  return item;
}
function pathThrough(points) {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("");
}
function gradient(defs, id, colors, { radial = false } = {}) {
  const item = node(radial ? "radialGradient" : "linearGradient", {
    id,
    ...(radial ? { cx: ".5", cy: ".45", r: ".65" } : { x1: ".08", y1: ".15", x2: ".9", y2: ".9" }),
  }, defs);
  colors.forEach((color, index) => node("stop", { offset: `${index * 100 / (colors.length - 1)}%`, "stop-color": color }, item));
}

function musicalNote(parent, material, kind = "quarter") {
  const group = node("g", { class: "music-art-note" }, parent);
  const outline = `url(#${material})`;
  const shadow = node("g", { transform: "translate(2.3 3.5)", opacity: ".12", fill: "#15143d", stroke: "#15143d" }, group);
  const face = node("g", { fill: outline, stroke: outline }, group);
  for (const target of [shadow, face]) {
    node("ellipse", { cx: 0, cy: 0, rx: 13.5, ry: 8.4, transform: "rotate(-19)", stroke: "none" }, target);
    node("path", { d: "M11-3V-65", fill: "none", "stroke-width": 4, "stroke-linecap": "round" }, target);
    if (kind === "eighth") node("path", { d: "M11-64C11-47 39-44 21-24C32-40 11-37 11-47Z", stroke: "none" }, target);
    if (kind === "pair") {
      node("ellipse", { cx: 46, cy: -10, rx: 13.5, ry: 8.4, transform: "rotate(-19 46 -10)", stroke: "none" }, target);
      node("path", { d: "M57-13V-75M11-65L57-75", fill: "none", "stroke-width": 4, "stroke-linecap": "round" }, target);
      node("path", { d: "M11-65L57-75V-65L11-55Z", stroke: "none" }, target);
    }
  }
  node("ellipse", { cx: -3, cy: -2, rx: 7, ry: 2.3, transform: "rotate(-19)", fill: "#fff", opacity: ".19" }, face);
  return group;
}

export function mountMusicArt(host, { kind = "score", language = "zh" } = {}) {
  if (!["score", "flow", "resonance"].includes(kind)) throw new RangeError("Unknown musical art");
  const root = document.createElement("div");
  root.className = `music-art music-art-${kind}`;
  root.dataset.renderer = "svg";
  root.setAttribute("aria-hidden", "true");
  root.dataset.language = language === "en" ? "en" : "zh";
  host.append(root);
  const id = `music-art-${++sequence}`;
  const svg = node("svg", { viewBox: "0 0 960 600", preserveAspectRatio: "xMidYMid slice", focusable: "false" }, root);
  const defs = node("defs", {}, svg);
  const dark = kind === "flow";
  gradient(defs, `${id}-ground`, dark ? ["#29283d", "#11121b", "#141420"] : ["#fdfdff", "#e8e8f5", "#d8d9eb"], { radial: true });
  gradient(defs, `${id}-ink`, dark ? ["#fff", "#d6d5ff", "#9894ff", "#fafaff"] : ["#171198", "#3c38ff", "#7b76ff", "#2822bf"]);
  gradient(defs, `${id}-pearl`, ["#fff", "#a9a7d0", "#fff", "#d1cfff"]);
  gradient(defs, `${id}-thread`, dark ? ["#ffffff20", "#d4d2ff", "#6a60ff", "#ffffff30"] : ["#4a3dff10", "#5e55ff", "#8a84ff", "#4a3dff10"]);
  node("rect", { width: 960, height: 600, fill: `url(#${id}-ground)` }, svg);
  const composition = node("g", {}, svg);
  const staffLines = [];
  const noteItems = [];
  const knotPaths = [];
  let clef;

  if (kind !== "resonance") {
    // A second, wider trace gives the staff a soft reflected edge.
    for (let line = -2; line <= 2; line++) {
      const glow = node("path", { fill: "none", stroke: dark ? "#7267ff" : "#bbb8ff", "stroke-width": dark ? 7 : 4, opacity: dark ? ".065" : ".13" }, composition);
      const ink = node("path", { fill: "none", stroke: `url(#${id}-thread)`, "stroke-width": dark ? 1.45 : 1.35 }, composition);
      staffLines.push({ line, glow, ink });
    }
    const pitches = [0, -1, 2, 1, -2, 0, 3, 1, -1, 2, 0, -2];
    const positions = kind === "score"
      ? [.24, .32, .39, .48, .57, .65, .73, .81, .9]
      : [.035, .14, .245, .36, .47, .58, .69, .8, .91, 1.02];
    positions.forEach((position, index) => {
      const type = index % 4 === 2 ? "pair" : index % 3 === 0 ? "eighth" : "quarter";
      const glyph = musicalNote(composition, `${id}-${index % 4 === 0 && dark ? "pearl" : "ink"}`, type);
      noteItems.push({ position, pitch: pitches[index % pitches.length], glyph, index });
    });
    clef = node("g", { fill: "none", stroke: `url(#${id}-ink)`, "stroke-width": 5.8, "stroke-linecap": "round", "stroke-linejoin": "round" }, composition);
    node("path", { d: "M8 114C-28 79 32 61 28 18C25-15-8-11-7 23C-5 51 28 64 29 88C30 117-9 125-22 105C-40 78-8 52 17 61C44 71 35 108 12 106C-1 105-4 95 1 88M3 4L18 145C20 163-1 167-8 154" }, clef);
    node("circle", { cx: -8, cy: 151, r: 6, fill: `url(#${id}-ink)`, stroke: "none" }, clef);
  } else {
    node("ellipse", { cx: 480, cy: 491, rx: 205, ry: 16, fill: "#676488", opacity: ".08" }, composition);
    for (let strand = 0; strand < 28; strand++) {
      const phase = strand / 28 * TAU;
      const vertices = Array.from({ length: 145 }, (_, index) => resonancePoint(index / 144 * TAU, phase));
      const path = node("path", {
        fill: "none",
        stroke: `url(#${id}-${strand % 5 === 0 ? "pearl" : "ink"})`,
        "stroke-width": strand % 5 === 0 ? 2.2 : 1.65,
        opacity: .35 + (Math.cos(phase) + 1) * .27,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }, composition);
      knotPaths.push({ path, vertices });
    }
  }
  const canvas = document.createElement("canvas");
  canvas.className = "music-art-canvas";
  canvas.setAttribute("aria-hidden", "true");
  root.append(canvas);
  const graphicsOff = new URLSearchParams(location.search).get("graphics") === "off";
  let renderer = null, rendererAttempted = false, contextLost = false;
  let dimensions = { width: root.clientWidth, height: root.clientHeight };
  let quality = 1, slowFrames = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = 0, last = 0, raf = 0, visible = false, paused = reduced.matches, controlled = false, disposed = false;
  let pointer = { x: 0, y: 0 }, desired = { x: 0, y: 0 }, level = 0, desiredLevel = 0;

  function paint() {
    if (!graphicsOff && visible && !rendererAttempted && !contextLost) {
      rendererAttempted = true;
      renderer = createMusicRenderer(canvas, { kind });
      root.dataset.renderer = renderer ? "webgl" : "svg";
    }
    if (renderer) {
      renderer.render({
        time: elapsed,
        pointer,
        audioLevel: level,
        width: dimensions.width,
        height: dimensions.height,
        dpr: Math.min(1.35, devicePixelRatio || 1) * quality,
      });
      return;
    }
    composition.setAttribute("transform", `translate(${(pointer.x * 13).toFixed(2)} ${(pointer.y * 9).toFixed(2)})`);
    if (kind === "resonance") {
      const yaw = .55 + elapsed * .075 + pointer.x * .13;
      const pitch = .59 + pointer.y * .12;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const size = 113 + level * 7;
      for (const { path, vertices } of knotPaths) {
        const points = vertices.map((p) => {
          const x = p.x * cy + p.z * sy;
          const z = -p.x * sy + p.z * cy;
          const y = p.y * cp - z * sp;
          const depth = p.y * sp + z * cp;
          const perspective = 5.5 / (5.5 - depth * .23);
          return { x: 480 + x * size * perspective, y: 298 + y * size * perspective };
        });
        path.setAttribute("d", pathThrough(points));
      }
      return;
    }
    const clock = elapsed;
    const spacing = kind === "score" ? 13 : 13.5;
    for (const { line, ink, glow } of staffLines) {
      const points = Array.from({ length: 81 }, (_, i) => {
        const p = staffPoint(i / 80, clock, kind);
        return { x: p.x, y: p.y + line * spacing };
      });
      const d = pathThrough(points);
      ink.setAttribute("d", d);
      glow.setAttribute("d", d);
    }
    for (const { position, pitch, glyph, index } of noteItems) {
      const t = kind === "flow" ? ((position + clock * .012) % 1.2 + 1.2) % 1.2 - .1 : position;
      const p = staffPoint(t, clock, kind);
      const scale = (kind === "flow" ? 1.06 : 1.2) + Math.sin(index + clock * .9) * level * .035;
      glyph.setAttribute("transform", `translate(${p.x.toFixed(2)} ${(p.y - pitch * spacing * .5).toFixed(2)}) rotate(${(p.angle * .68).toFixed(2)}) scale(${scale.toFixed(3)})`);
      const edge = kind === "flow" ? Math.min(1, Math.max(0, Math.min(t + .1, 1.1 - t) * 9)) : 1;
      glyph.setAttribute("opacity", edge.toFixed(3));
    }
    const p = staffPoint(kind === "score" ? .15 : .095, clock, kind);
    clef.setAttribute("transform", `translate(${p.x.toFixed(2)} ${(p.y - 73).toFixed(2)}) rotate(${(p.angle * .25).toFixed(2)}) scale(${kind === "score" ? 1.08 : .9})`);
    clef.setAttribute("opacity", kind === "flow" ? ".7" : "1");
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function tick(now) {
    raf = 0;
    if (disposed || !visible || paused || document.hidden) return;
    const rawDt = last ? Math.max(0, (now - last) / 1000) : 0;
    const dt = Math.min(.05, rawDt);
    if (renderer && rawDt > .028) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && quality > .76) {
      quality = Math.max(.75, quality * .85);
      slowFrames = 0;
    }
    last = now;
    elapsed += dt;
    const blend = 1 - Math.exp(-dt * 5);
    pointer.x += (desired.x - pointer.x) * blend;
    pointer.y += (desired.y - pointer.y) * blend;
    level += (desiredLevel - level) * blend;
    paint();
    raf = requestAnimationFrame(tick);
  }
  function sync() {
    stop();
    if (disposed) return;
    if (paused) { pointer = { x: 0, y: 0 }; level = 0; }
    if (visible && !document.hidden) paint();
    if (!disposed && visible && !paused && !document.hidden)
      raf = requestAnimationFrame(tick);
  }
  function move(event) {
    if (paused) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    desired = {
      x: clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1),
      y: clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1),
    };
  }
  function leave() { desired = { x: 0, y: 0 }; }
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0 });
  observer.observe(root);
  const sizeObserver = new ResizeObserver(([entry]) => {
    dimensions = { width: entry.contentRect.width, height: entry.contentRect.height };
    if (visible) sync();
  });
  sizeObserver.observe(root);
  function lost(event) {
    event.preventDefault();
    contextLost = true;
    renderer?.dispose();
    renderer = null;
    rendererAttempted = false;
    root.dataset.renderer = "svg";
    stop();
    paint();
  }
  function restored() { contextLost = false; sync(); }
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  host.addEventListener("pointermove", move, { passive: true });
  host.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", sync);
  const mediaChange = () => { if (!controlled) paused = reduced.matches; sync(); };
  reduced.addEventListener("change", mediaChange);
  paint();
  return {
    setLanguage(next) {
      if (!["zh", "en"].includes(next)) throw new RangeError("Unknown art language");
      root.dataset.language = next;
    },
    setPaused(value) { controlled = true; paused = !!value; sync(); },
    setAudioLevel(value) { desiredLevel = Number.isFinite(value) ? clamp(value, 0, 1) : 0; },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      observer.disconnect();
      sizeObserver.disconnect();
      renderer?.dispose();
      renderer = null;
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", mediaChange);
      root.remove();
    },
  };
}
