// Waveform paint is independent from the audio clock; the playhead is a composited layer.
export function mountWaveform(canvas, seek, selection, playhead) {
  let data = [],
    duration = 0,
    left = 0,
    right = 0;
  const paint = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const styles = getComputedStyle(document.documentElement);
    const normal = styles.getPropertyValue("--wave").trim(),
      chosen = styles.getPropertyValue("--wave-active").trim();
    const count = Math.min(data.length, Math.floor(width / 3));
    for (let index = 0; index < count; index++) {
      const from = Math.floor((index * data.length) / count),
        to = Math.max(
          from + 1,
          Math.floor(((index + 1) * data.length) / count),
        );
      let peak = 0;
      for (let n = from; n < to; n++) peak = Math.max(peak, data[n]);
      const x = ((index + 0.5) * width) / count,
        heightBar = Math.max(2, peak * (height - 48));
      ctx.fillStyle =
        index / count >= left / (duration || 1) &&
        index / count <= right / (duration || 1)
          ? chosen
          : normal;
      ctx.beginPath();
      ctx.roundRect(x - 1, height / 2 - heightBar / 2, 2, heightBar, 1);
      ctx.fill();
    }
    selection.style.left = `${(100 * left) / (duration || 1)}%`;
    selection.style.width = `${(100 * Math.max(0, right - left)) / (duration || 1)}%`;
  };
  new ResizeObserver(paint).observe(canvas);
  return {
    set(samples, seconds, start, end) {
      data = samples;
      duration = seconds;
      left = start;
      right = end;
      seek.max = String(seconds || 1);
      paint();
    },
    position(seconds) {
      seek.value = String(seconds);
      playhead.style.transform = `translateX(${Math.min(1, seconds / (duration || 1)) * canvas.clientWidth}px)`;
    },
    repaint: paint,
  };
}
