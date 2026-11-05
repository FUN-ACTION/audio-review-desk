export function viewportRange(duration, zoom = 1, center = duration / 2) {
  if (!Number.isFinite(duration) || duration <= 0) return [0, 0];
  const factor = Number.isFinite(zoom) ? Math.max(1, Math.min(8, zoom)) : 1;
  const width = duration / factor;
  const middle = Number.isFinite(center) ? center : duration / 2;
  const start = Math.max(0, Math.min(duration - width, middle - width / 2));
  return [start, start + width];
}
export function trimHandleLimits(duration, start, end) {
  if (!Number.isFinite(duration) || duration <= 0)
    return { range: [0, 0], start: [0, 0], end: [0, 0] };
  let left = start, right = end;
  // Numeric inputs may describe a valid interval narrower than one millisecond.
  // Preserve both exact endpoints instead of expanding that interval on drag.
  if (!(Number.isFinite(left) && Number.isFinite(right) &&
        left >= 0 && left < right && right <= duration)) {
    const gap = Math.min(0.001, duration);
    left = Number.isFinite(start)
      ? Math.max(0, Math.min(duration - gap, start))
      : 0;
    if (left >= duration) left = 0;
    right = Number.isFinite(end)
      ? Math.min(duration, Math.max(left + gap, end))
      : duration;
    if (right <= left) right = duration;
  }
  const gap = Math.min(0.001, right - left);
  const beforeEnd = right - gap, afterStart = left + gap;
  // Floating-point subtraction must not exclude the current exact endpoint;
  // at large timestamps, adding a millisecond can also round back to itself.
  const startMax = beforeEnd < right ? Math.max(left, beforeEnd) : left;
  const endMin = afterStart > left ? Math.min(right, afterStart) : right;
  return { range: [left, right], start: [0, startMax], end: [endMin, duration] };
}

export function editRange(duration, start, end, side, value) {
  const limits = trimHandleLimits(duration, start, end);
  const [left, right] = limits.range;
  if (!Number.isFinite(value) || !(side === "start" || side === "end"))
    return [left, right];
  return side === "start"
    ? [Math.max(limits.start[0], Math.min(limits.start[1], value)), right]
    : [left, Math.max(limits.end[0], Math.min(limits.end[1], value))];
}
