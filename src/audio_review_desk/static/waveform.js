import { viewportRange, editRange, trimHandleLimits } from "./wave-math.js";

// Canvas is only repainted for data, range, zoom, resize or theme changes.
// Playback moves one compositor layer and never redraws the waveform.
export function mountWaveform(canvas, seek, selection, playhead, controls) {
  let data = [],
    duration = 0,
    sampleDuration = 0,
    left = 0,
    right = 0,
    zoom = 1,
    center = 0,
    time = 0;
  const dragControllers = [];
  let cancellingDrag = false;
  const cancelDrag = () => {
    if (cancellingDrag) return;
    cancellingDrag = true;
    try {
      // Releasing capture may synchronously dispatch lostpointercapture. Revoke
      // both handles first so neither can edit through that cleanup callback.
      const releases = dragControllers.map(clear => clear());
      for (const release of releases) if (release) release();
    } finally {
      cancellingDrag = false;
    }
  };
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
    // Missing peaks are not evidence of silence. Keep the temporal controls
    // below active while a read is loading, unavailable or awaiting retry.
    for (let i = 0; data.length && i < count; i++) {
      const xTime = a + ((i + 0.5) / count) * span;
      const first = Math.floor(
        ((a + (i / count) * span) / (sampleDuration || 1)) * data.length,
      );
      const last = Math.max(
        first + 1,
        Math.ceil(
          ((a + ((i + 1) / count) * span) / (sampleDuration || 1)) * data.length,
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
    const limits = trimHandleLimits(duration, left, right);
    for (const [handle, value, min, max] of [
      [controls.start, left, ...limits.start],
      [controls.end, right, ...limits.end],
    ]) {
      handle.hidden = !duration || value < a - 0.00001 || value > b + 0.00001;
      handle.style.left = `${clamp((value - a) / span, 0, 1) * 100}%`;
      handle.setAttribute("aria-valuemin", Math.max(0, min));
      handle.setAttribute("aria-valuemax", Math.max(0, max));
      handle.setAttribute("aria-valuenow", value);
      handle.setAttribute("aria-valuetext", `${value} s`);
    }
    position(time);
  };
  function change(side, value, revealEdited = false) {
    [left, right] = editRange(duration, left, right, side, value);
    if (revealEdited) {
      // Keyboard Home/End and arrows can cross a zoomed viewport edge.
      // Move the viewport before onEdit can synchronously repaint the handles.
      const [a, b] = view(), endpoint = side === "start" ? left : right;
      if (endpoint < a) center = endpoint + (b - a) / 2;
      else if (endpoint > b) center = endpoint - (b - a) / 2;
    }
    controls.onEdit(left, right, side);
    paint();
  }
  for (const [handle, side] of [
    [controls.start, "start"],
    [controls.end, "end"],
  ]) {
    let drag = null;
    const clear = (expected = drag) => {
      if (!drag || drag !== expected) return null;
      const previous = drag;
      drag = null;
      handle.classList.remove("dragging");
      return () => {
        try {
          if (handle.hasPointerCapture(previous.pointerId))
            handle.releasePointerCapture(previous.pointerId);
        } catch (error) {
          // The pointer may already have ended before capture is released.
          if (error.name !== "NotFoundError") throw error;
        }
      };
    };
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      // An old loss notification must not revoke a newer capture of this ID.
      if (event.type === "lostpointercapture" && handle.hasPointerCapture(drag.pointerId)) return;
      const release = clear();
      if (release) release();
    };
    dragControllers.push(clear);
    handle.addEventListener("pointerdown", (event) => {
      if (handle.disabled || drag || cancellingDrag ||
          !Number.isInteger(event.pointerId) || event.pointerId < 0) return;
      const box = canvas.getBoundingClientRect(),
        [a, b] = view();
      const grabOffset =
        event.clientX -
        box.left -
        (((side === "start" ? left : right) - a) / (b - a || 1)) * box.width;
      event.preventDefault();
      const next = { pointerId: event.pointerId, grabOffset };
      drag = next;
      try {
        handle.setPointerCapture(next.pointerId);
      } catch (error) {
        const release = clear(next);
        if (release) release();
        if (error.name !== "NotFoundError") throw error;
        return;
      }
      if (drag !== next) return;
      handle.focus();
      // Focus can synchronously replace the selection or begin a save.
      if (drag !== next || handle.disabled) {
        const release = clear(next);
        if (release) release();
        return;
      }
      handle.classList.add("dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (handle.disabled || !handle.hasPointerCapture(drag.pointerId)) {
        const release = clear();
        if (release) release();
        return;
      }
      const box = canvas.getBoundingClientRect(),
        [a, b] = view();
      change(
        side,
        a +
          clamp((event.clientX - box.left - drag.grabOffset) / box.width, 0, 1) *
            (b - a),
      );
    });
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("keydown", (event) => {
      if (handle.disabled || cancellingDrag || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          event.ctrlKey || event.metaKey || event.altKey) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
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
            : current + (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step),
        true,
      );
    });
  }
  new ResizeObserver(paint).observe(canvas);
  return {
    set(samples, seconds, start, end, sampleSeconds = seconds) {
      // Same-geometry peak/A-B redraws and synchronous onEdit echoes keep the
      // gesture. A source replacement, even with identical bounds, uses reset.
      if (duration !== seconds || left !== start || right !== end) cancelDrag();
      data = samples;
      duration = seconds;
      // A owns the shared review timeline. B's peaks retain their own source
      // timing instead of stretching to fill A when their durations differ.
      sampleDuration = Number.isFinite(sampleSeconds) && sampleSeconds > 0
        ? sampleSeconds : seconds;
      left = start;
      right = end;
      paint();
    },
    position,
    cancelDrag,
    repaint: paint,
    reset() {
      cancelDrag();
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
