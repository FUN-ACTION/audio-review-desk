import { viewportRange, editRange } from "./wave-math.js";

// Canvas is only repainted for data, range, zoom, resize or theme changes.
// Playback moves one compositor layer and never redraws the waveform.
export function mountWaveform(canvas, seek, selection, playhead, controls) {
  let data = [],
    duration = 0,
    left = 0,
    right = 0,
    zoom = 1,
    center = 0,
    time = 0;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const view = () => viewportRange(duration, zoom, center);
  const position = (seconds) => {
    time = seconds;
    const [a, b] = view();
    seek.value = String(seconds);
    playhead.hidden = seconds < a || seconds > b;
    playhead.style.transform = `translateX(${clamp((seconds - a) / (b - a || 1), 0, 1) * canvas.clientWidth}px)`;
  };
  const paint = () => {
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const styles = getComputedStyle(document.documentElement);
    const normal = styles.getPropertyValue("--wave"),
      chosen = styles.getPropertyValue("--wave-active");
    const [a, b] = view(),
      span = b - a || 1;
    const count = Math.max(1, Math.floor(width / 3));
    for (let i = 0; i < count; i++) {
      const xTime = a + ((i + 0.5) / count) * span;
      const first = Math.floor(
        ((a + (i / count) * span) / (duration || 1)) * data.length,
      );
      const last = Math.max(
        first + 1,
        Math.ceil(
          ((a + ((i + 1) / count) * span) / (duration || 1)) * data.length,
        ),
      );
      let peak = 0;
      for (let n = first; n < Math.min(last, data.length); n++)
        peak = Math.max(peak, Math.abs(data[n] || 0));
      const bar = Math.max(2, Math.min(1, peak) * height * 0.84);
      ctx.fillStyle = xTime >= left && xTime <= right ? chosen : normal;
      ctx.beginPath();
      ctx.roundRect((i / count) * width, (height - bar) / 2, 2, bar, 1);
      ctx.fill();
    }
    selection.style.left = `${clamp((left - a) / span, 0, 1) * 100}%`;
    selection.style.width = `${Math.max(0, clamp((right - a) / span, 0, 1) - clamp((left - a) / span, 0, 1)) * 100}%`;
    seek.min = String(a);
    seek.max = String(b || 1);
    controls.onView(a, b, zoom);
    controls.pan.disabled = zoom === 1;
    controls.pan.value = String(a / Math.max(0.001, duration - span));
    for (const [handle, value, min, max] of [
      [controls.start, left, 0, right - 0.001],
      [controls.end, right, left + 0.001, duration],
    ]) {
      handle.hidden = !duration || value < a - 0.00001 || value > b + 0.00001;
      handle.style.left = `${clamp((value - a) / span, 0, 1) * 100}%`;
      handle.setAttribute("aria-valuemin", Math.max(0, min));
      handle.setAttribute("aria-valuemax", Math.max(0, max));
      handle.setAttribute("aria-valuenow", value.toFixed(3));
      handle.setAttribute("aria-valuetext", `${value.toFixed(3)} s`);
    }
    position(time);
  };
  function change(side, value) {
    [left, right] = editRange(duration, left, right, side, value);
    controls.onEdit(left, right);
    paint();
  }
  for (const [handle, side] of [
    [controls.start, "start"],
    [controls.end, "end"],
  ]) {
    let dragging = false;
    handle.addEventListener("pointerdown", (event) => {
      if (handle.disabled) return;
      event.preventDefault();
      handle.focus();
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const box = canvas.getBoundingClientRect(),
        [a, b] = view();
      change(
        side,
        a + clamp((event.clientX - box.left) / box.width, 0, 1) * (b - a),
      );
    });
    const finish = () => {
      dragging = false;
      handle.classList.remove("dragging");
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const current = side === "start" ? left : right,
        step = event.shiftKey ? 0.1 : 0.01;
      change(
        side,
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? duration
            : current + (event.key === "ArrowRight" ? step : -step),
      );
    });
  }
  new ResizeObserver(paint).observe(canvas);
  return {
    set(samples, seconds, start, end) {
      data = samples;
      duration = seconds;
      left = start;
      right = end;
      paint();
    },
    position,
    repaint: paint,
    reset() {
      zoom = 1;
      center = duration / 2;
      paint();
    },
    zoom(factor, at = time) {
      zoom = clamp(zoom * factor, 1, 8);
      center = at;
      paint();
    },
    fit() {
      zoom = clamp((duration / Math.max(0.001, right - left)) * 0.88, 1, 8);
      center = (left + right) / 2;
      paint();
    },
    pan(ratio) {
      const [a, b] = view();
      center = clamp(ratio, 0, 1) * (duration - (b - a)) + (b - a) / 2;
      paint();
    },
  };
}
