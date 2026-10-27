export const STORY_DURATION = 12;
export const MIN_STORY_RANGE = 0.15;

export function clampStoryTime(value) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(STORY_DURATION, value))
    : 0;
}

function checkedRange(range) {
  if (
    !range ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end > STORY_DURATION ||
    range.end - range.start < MIN_STORY_RANGE - 1e-9
  )
    throw new RangeError("Invalid story range");
}

export function moveStoryEdge(range, edge, value) {
  checkedRange(range);
  if (!["start", "end"].includes(edge)) throw new RangeError("Invalid edge");
  const time = clampStoryTime(value);
  return edge === "start"
    ? { start: Math.min(time, range.end - MIN_STORY_RANGE), end: range.end }
    : {
        start: range.start,
        end: Math.max(range.start + MIN_STORY_RANGE, time),
      };
}

export function closestStoryEdge(range, time) {
  checkedRange(range);
  if (!Number.isFinite(time)) throw new RangeError("Invalid edge position");
  return Math.abs(time - range.start) <= Math.abs(time - range.end)
    ? "start"
    : "end";
}

export function storyKeyRange(range, edge, key, shift = false) {
  checkedRange(range);
  if (!["start", "end"].includes(edge)) throw new RangeError("Invalid edge");
  const step = shift ? 1 : 0.1;
  let value;
  if (key === "Home") value = 0;
  else if (key === "End") value = STORY_DURATION;
  else if (key === "ArrowLeft" || key === "ArrowDown")
    value = range[edge] - step;
  else if (key === "ArrowRight" || key === "ArrowUp")
    value = range[edge] + step;
  else return null;
  return moveStoryEdge(range, edge, Math.round(value * 1000) / 1000);
}

export function storyTimeAt(clientX, left, width, grabOffset = 0) {
  if (![clientX, left, width, grabOffset].every(Number.isFinite) || width <= 0)
    throw new RangeError("Invalid timeline geometry");
  return clampStoryTime(
    ((clientX - left) / width) * STORY_DURATION - grabOffset,
  );
}

export function storyTimeLabel(value, precision = 2) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 3)
    throw new RangeError("Invalid time precision");
  const time = clampStoryTime(value);
  return (
    "0:" + time.toFixed(precision).padStart(precision ? precision + 3 : 2, "0")
  );
}
