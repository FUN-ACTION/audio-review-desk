export function playbackTime(state, now, duration = 12) {
  if (!Number.isFinite(now) || !Number.isFinite(duration) || duration <= 0)
    throw new RangeError("Invalid audio clock");
  const position = state.playing
    ? state.offset + Math.max(0, now - state.started)
    : state.position;
  if (!Number.isFinite(position))
    throw new RangeError("Invalid playback position");
  if (state.playing && state.loop) {
    validateLoop(state.start, state.end, duration);
    if (position >= state.end)
      return (
        state.start + ((position - state.start) % (state.end - state.start))
      );
  }
  return Math.max(0, Math.min(duration, position));
}

function validateLoop(start, end, duration) {
  if (
    ![start, end].every(Number.isFinite) ||
    start < 0 ||
    end > duration ||
    end - start < 0.149999
  )
    throw new RangeError("Invalid loop selection");
}

export function rebaseLoop(state, range, now, duration = 12) {
  validateLoop(range.start, range.end, duration);
  const time = playbackTime(state, now, duration);
  return {
    offset: time >= range.start && time < range.end ? time : range.start,
    started: now,
    start: range.start,
    end: range.end,
  };
}
