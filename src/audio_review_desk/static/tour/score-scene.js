import {
  advanceScore,
  createScore,
  lineGap,
  nearestNote,
  notePose,
  pluckScore,
  scoreY,
  wrap,
} from "./score-math.js?v=0.10.0";

const PAPER = "#f7f6f2";
const INK = "#202320";
const ACCENT = "#5366b3";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function mountScore(host) {
  const canvas = host.querySelector("canvas");
  let context;
  try {
    context = canvas?.getContext("2d", { alpha: false });
  } catch {}
  if (!context) {
    host.dataset.renderer = "poster";
    return {
      ready: false,
      paused: true,
      setPaused() {},
      setAudioLevel() {},
      burst() {},
      dispose() {},
    };
  }
  let compact = matchMedia("(max-width:720px)").matches;
  const reduced = matchMedia("(prefers-reduced-motion:reduce)");
  const model = createScore({ count: compact ? 27 : 60 });
  const pointer = { x: 0.5, y: 0.5, active: false };
  const listeners = [];
  let width = 0,
    height = 0,
    frame = 0,
    last = 0,
    visible = true,
    disposed = false;
  let paused = reduced.matches,
    manualPause = null,
    lost = false,
    resumePaused = paused;
  let drag = null,
    pointerId = null,
    audioLevel = 0,
    lineGradient = null;
  const metrics =
    new URLSearchParams(location.search).get("motion-debug") === "1"
      ? {
          count: 0,
          intervals: new Float64Array(120),
          cursor: 0,
          samples: 0,
          sum: 0,
          max: 0,
          reported: performance.now(),
        }
      : null;
  function reportFrames(now, forceCount = false) {
    if (!metrics) return;
    const due = now - metrics.reported >= 1000;
    if (due || forceCount) {
      const count = String(metrics.count);
      if (host.dataset.frameCount !== count) host.dataset.frameCount = count;
    }
    if (!due) return;
    host.dataset.frameMean = (
      metrics.samples ? metrics.sum / metrics.samples : 0
    ).toFixed(2);
    host.dataset.frameMax = metrics.max.toFixed(2);
    metrics.reported = now;
  }
  if (metrics) {
    host.dataset.frameCount = "0";
    host.dataset.frameMean = "0.00";
    host.dataset.frameMax = "0.00";
  }
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const announce = () =>
    host.dispatchEvent(new CustomEvent("motionchange", { detail: { paused } }));

  function drawStaffs() {
    const gap = height * lineGap;
    const segments = compact ? 44 : 64;
    context.lineWidth = 0.75;
    context.strokeStyle = lineGradient;
    for (let row = 0; row < 3; row++) {
      const points = Array.from({ length: segments + 1 }, (_, i) => {
        const x = i / segments;
        return { x: x * width, y: scoreY(model, row, x) * height };
      });
      for (let line = -2; line <= 2; line++) {
        context.beginPath();
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (!i) context.moveTo(p.x, p.y + line * gap);
          else context.lineTo(p.x, p.y + line * gap);
        }
        context.stroke();
      }
      const bars = compact ? 3 : 6;
      for (let i = 0; i < bars; i++) {
        const x =
          wrap(i / bars + row * 0.065 - model.time * (0.0105 + row * 0.0008)) *
            1.3 -
          0.15;
        if (x <= 0.035 || x >= 0.965) continue;
        const y = scoreY(model, row, x) * height;
        context.beginPath();
        context.moveTo(x * width, y - 2 * gap);
        context.lineTo(x * width, y + 2 * gap);
        context.stroke();
      }
    }
  }

  function drawNotes() {
    const gap = height * lineGap;
    const radius = clamp(height * 0.014, 6, 10.5);
    const poses = model.notes.map((note) => {
      const p = notePose(model, note);
      return {
        note,
        x: p.x * width,
        y: p.y * height,
        alpha: clamp(Math.min(p.x / 0.065, (1 - p.x) / 0.065), 0, 1),
        direction: note.pitch >= 2 ? 1 : -1,
        stemX: 0,
        stemY: 0,
        paired: false,
      };
    });
    const groups = new Map();
    for (const p of poses)
      if (p.note.beam >= 0) {
        if (!groups.has(p.note.beam)) groups.set(p.note.beam, []);
        groups.get(p.note.beam).push(p);
      }
    for (const pair of groups.values())
      if (pair.length === 2 && Math.abs(pair[0].x - pair[1].x) < width * 0.24) {
        const direction =
          (pair[0].note.pitch + pair[1].note.pitch) / 2 >= 2 ? 1 : -1;
        for (const p of pair) {
          p.direction = direction;
          p.paired = true;
        }
        const slope = clamp(
          pair[1].y - pair[0].y,
          -radius * 1.25,
          radius * 1.25,
        );
        const anchor =
          direction < 0
            ? Math.min(pair[0].y, pair[1].y) - radius * 4.1
            : Math.max(pair[0].y, pair[1].y) + radius * 4.1;
        pair[0].stemY = anchor - slope / 2;
        pair[1].stemY = anchor + slope / 2;
      }
    for (const p of poses) {
      if (!p.alpha) continue;
      const { note, x, y, direction } = p;
      const color = note.accent || note.attack > 0.12 ? ACCENT : INK;
      const rx = radius * (1 + model.level * 0.09 + note.attack * 0.035),
        ry = rx * 0.66;
      context.globalAlpha = p.alpha;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 1.35;
      context.lineCap = "round";
      if (Math.abs(note.pitch) >= 6) {
        const center = y + (note.pitch * gap) / 2;
        for (let step = 6; step <= Math.abs(note.pitch); step += 2) {
          const ledgerY = center - (Math.sign(note.pitch) * step * gap) / 2;
          context.beginPath();
          context.moveTo(x - rx * 1.55, ledgerY);
          context.lineTo(x + rx * 1.55, ledgerY);
          context.stroke();
        }
      }
      context.beginPath();
      context.ellipse(x, y, rx, ry, -0.32, 0, Math.PI * 2);
      if (note.duration >= 2) {
        context.fillStyle = PAPER;
        context.fill();
        context.lineWidth = 1.8;
        context.stroke();
      } else context.fill();
      p.stemX = x - direction * rx * 0.84;
      if (!p.paired) p.stemY = y + direction * rx * 4.1;
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(p.stemX, y + direction * ry * 0.2);
      context.lineTo(p.stemX, p.stemY);
      context.stroke();
      if (note.duration < 1 && !p.paired) {
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(p.stemX, p.stemY);
        context.bezierCurveTo(
          p.stemX - direction * rx * 2,
          p.stemY - direction * rx * 1.7,
          p.stemX - direction * rx * 2.05,
          p.stemY - direction * rx * 3.1,
          p.stemX - direction * rx * 0.5,
          p.stemY - direction * rx * 3.2,
        );
        context.stroke();
      }
      if (note.attack > 0.04) {
        context.strokeStyle = ACCENT;
        context.globalAlpha = p.alpha * note.attack * 0.23;
        context.lineWidth = 0.9;
        context.beginPath();
        context.ellipse(
          x,
          y,
          rx + 5 + (1 - note.attack) * 9,
          ry + 5 + (1 - note.attack) * 9,
          -0.32,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }
    for (const pair of groups.values())
      if (pair.length === 2 && pair.every((p) => p.paired && p.alpha > 0)) {
        const [a, b] = pair;
        context.fillStyle =
          a.note.accent ||
          b.note.accent ||
          Math.max(a.note.attack, b.note.attack) > 0.12
            ? ACCENT
            : INK;
        context.globalAlpha = Math.min(a.alpha, b.alpha);
        const depth = -a.direction * radius * 0.47;
        context.beginPath();
        context.moveTo(a.stemX, a.stemY);
        context.lineTo(b.stemX, b.stemY);
        context.lineTo(b.stemX, b.stemY + depth);
        context.lineTo(a.stemX, a.stemY + depth);
        context.closePath();
        context.fill();
      }
    context.globalAlpha = 1;
  }

  function render(now) {
    frame = 0;
    if (disposed || lost || !visible || document.hidden || !width || !height)
      return;
    const elapsed = last ? Math.max(0, now - last) : 0;
    const dt = Math.min(0.1, elapsed / 1000);
    last = now;
    if (!paused) advanceScore(model, dt, { pointer, audioLevel, drag });
    context.globalAlpha = 1;
    context.fillStyle = PAPER;
    context.fillRect(0, 0, width, height);
    drawStaffs();
    drawNotes();
    if (metrics) {
      metrics.count++;
      // Use actual RAF intervals, not the capped simulation timestep. A zero
      // interval marks the first frame after pause/show and is not sampled.
      if (!paused && elapsed > 0) {
        metrics.sum += elapsed - metrics.intervals[metrics.cursor];
        metrics.intervals[metrics.cursor] = elapsed;
        metrics.cursor = (metrics.cursor + 1) % metrics.intervals.length;
        metrics.samples = Math.min(
          metrics.samples + 1,
          metrics.intervals.length,
        );
        metrics.max = Math.max(metrics.max, elapsed);
      }
      reportFrames(now, paused);
    }
    if (!paused) frame = requestAnimationFrame(render);
  }
  function request() {
    if (!frame && !disposed && !lost && visible && !document.hidden)
      frame = requestAnimationFrame(render);
  }
  function resize() {
    if (disposed || lost) return;
    const rect = host.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;
    const nextCompact = width < 700;
    if (compact !== nextCompact) {
      compact = nextCompact;
      cancel();
      model.notes = createScore({ count: compact ? 27 : 60 }).notes;
    }
    const ratio = Math.min(devicePixelRatio || 1, compact ? 1.5 : 1.75);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    lineGradient = context.createLinearGradient(0, 0, width, 0);
    lineGradient.addColorStop(0, "rgba(32,35,32,0)");
    lineGradient.addColorStop(0.065, "rgba(32,35,32,.22)");
    lineGradient.addColorStop(0.935, "rgba(32,35,32,.22)");
    lineGradient.addColorStop(1, "rgba(32,35,32,0)");
    request();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }
  function cancel() {
    drag = null;
    pointer.active = false;
    host.classList.remove("is-dragging");
    if (pointerId !== null && canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }
  function press(event) {
    if (event.button !== 0 || disposed || lost) return;
    const p = point(event);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.active = true;
    if (paused) {
      model.ripples = [];
      for (const note of model.notes) note.attack = 0;
    }
    const nearest = nearestNote(model, p.x, p.y, width / height);
    const result = pluckScore(model, p.x, p.y, { aspect: width / height });
    if (result && event.isTrusted)
      host.dispatchEvent(new CustomEvent("scorepluck", { detail: result }));
    if (!paused && nearest.note && nearest.distance < 0.08) {
      const pose = notePose(model, nearest.note);
      drag = {
        id: nearest.note.id,
        x: pose.x,
        y: pose.y,
        offsetX: pose.x - p.x,
        offsetY: pose.y - p.y,
      };
      pointerId = event.pointerId;
      canvas.setPointerCapture(pointerId);
      host.classList.add("is-dragging");
    }
    request();
  }
  function move(event) {
    const p = point(event);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.active = event.pointerType !== "touch" || !!drag;
    if (drag) {
      drag.x = p.x + drag.offsetX;
      drag.y = p.y + drag.offsetY;
    }
  }
  function pause(value) {
    manualPause = !!value;
    resumePaused = manualPause;
    paused = lost || manualPause;
    cancel();
    last = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    reportFrames(performance.now(), true);
    request();
    announce();
  }
  function mediaChange() {
    resumePaused = reduced.matches || manualPause === true;
    paused = lost || resumePaused;
    cancel();
    last = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    reportFrames(performance.now(), true);
    request();
    announce();
  }
  listen(canvas, "pointerdown", press);
  listen(canvas, "pointermove", move);
  listen(canvas, "pointerup", cancel);
  listen(canvas, "pointercancel", cancel);
  listen(canvas, "pointerleave", () => {
    if (!drag) pointer.active = false;
  });
  listen(document, "visibilitychange", () => {
    last = 0;
    if (document.hidden) {
      cancel();
      cancelAnimationFrame(frame);
      frame = 0;
      reportFrames(performance.now(), true);
    } else request();
  });
  listen(reduced, "change", mediaChange);
  listen(canvas, "contextlost", (event) => {
    event.preventDefault();
    resumePaused = paused;
    lost = true;
    paused = true;
    cancel();
    cancelAnimationFrame(frame);
    frame = 0;
    reportFrames(performance.now(), true);
    host.dataset.renderer = "poster";
    announce();
  });
  listen(canvas, "contextrestored", () => {
    try {
      context = canvas.getContext("2d", { alpha: false });
      lost = !context;
      if (lost) return;
      paused = resumePaused;
      host.dataset.renderer = "score";
      last = 0;
      resize();
      announce();
    } catch {}
  });
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      last = 0;
      if (visible) request();
      else {
        cancel();
        cancelAnimationFrame(frame);
        frame = 0;
        reportFrames(performance.now(), true);
      }
    },
    { threshold: 0 },
  );
  observer.observe(host);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  host.dataset.renderer = "score";
  resize();
  return {
    get ready() {
      return !disposed && !lost;
    },
    get paused() {
      return paused;
    },
    setPaused: pause,
    setAudioLevel(value) {
      audioLevel = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
    },
    burst() {
      if (disposed || lost) return;
      if (paused) {
        model.ripples = [];
        for (const note of model.notes) note.attack = 0;
      }
      pluckScore(model, 0.32, 0.34, { strength: 1.1, aspect: width / height });
      pluckScore(model, 0.65, 0.63, { strength: 0.9, aspect: width / height });
      request();
    },
    dispose() {
      disposed = true;
      cancel();
      cancelAnimationFrame(frame);
      reportFrames(performance.now(), true);
      observer.disconnect();
      sizeObserver.disconnect();
      listeners.forEach((remove) => remove());
    },
  };
}
