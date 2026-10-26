export function viewportRange(duration, zoom = 1, center = duration / 2) {
  if (!Number.isFinite(duration) || duration <= 0) return [0, 0];
  const factor = Number.isFinite(zoom) ? Math.max(1, Math.min(8, zoom)) : 1;
  const width = duration / factor;
  const middle = Number.isFinite(center) ? center : duration / 2;
  const start = Math.max(0, Math.min(duration - width, middle - width / 2));
  return [start, start + width];
}
export function editRange(duration, start, end, side, value) {
  if (!Number.isFinite(duration) || duration <= 0) return [0, 0];
  const gap = Math.min(0.001, duration);
  const left = Number.isFinite(start)
    ? Math.max(0, Math.min(duration - gap, start))
    : 0;
  const right = Number.isFinite(end)
    ? Math.max(left + gap, Math.min(duration, end))
    : duration;
  if (!Number.isFinite(value)) return [left, right];
  return side === "start"
    ? [Math.max(0, Math.min(right - gap, value)), right]
    : [left, Math.max(left + gap, Math.min(duration, value))];
}
