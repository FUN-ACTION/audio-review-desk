const finite = (value) => typeof value === "number" && Number.isFinite(value);

// These are listening windows only. They never change a review or source file.
export function auditionBounds(duration, start, end, kind, padding = 1.25) {
  if (!finite(duration) || duration <= 0 || !finite(padding) || padding <= 0) return null;
  const clamp = (value) => Math.max(0, Math.min(duration, finite(value) ? value : 0));
  const left = clamp(start), right = finite(end) ? clamp(end) : duration;
  if (right <= left) return null;
  if (kind === "start") return [clamp(left - padding), clamp(left + padding)];
  if (kind === "end") return [clamp(right - padding), clamp(right + padding)];
  if (kind === "selection") return [left, right];
  return null;
}

export function quietRange(quality) {
  if (!quality?.decoded) return null;
  const { duration, leading_quiet_seconds: leading, trailing_quiet_seconds: trailing } = quality;
  if (![duration, leading, trailing].every(finite) || duration <= 0 || leading < 0 || trailing < 0) return null;
  const end = duration - trailing;
  // All-silent or uncertain clips have no meaningful automatic suggestion.
  return end - leading >= 0.02 && (leading > 0 || trailing > 0) ? [leading, end] : null;
}

export function createAudition({ player, loop, onChange = () => {}, onError = () => {} }) {
  let active = null, generation = 0, ownsNativeEnd = false;
  const cancel = ({ restore = true, keepEndGuard = false } = {}) => {
    generation++;
    if (!keepEndGuard) ownsNativeEnd = false;
    if (!active) return;
    const previous = active;
    active = null;
    if (restore && !loop.checked) loop.checked = previous.loop;
    onChange(null);
  };
  const paused = () => {
    // Native completion fires pause before ended. Keep ownership until the
    // ended dispatch so the ordinary transport cannot restart a one-shot.
    if (active && player.ended) ownsNativeEnd = true;
    cancel({ keepEndGuard: true });
  };
  const ended = (event) => {
    const owned = active || ownsNativeEnd;
    cancel();
    if (owned) event.stopImmediatePropagation();
  };
  player.addEventListener("pause", paused);
  player.addEventListener("ended", ended);
  player.addEventListener("error", paused);
  return {
    start(bounds, kind) {
      if (!bounds || !player.readyState || !player.src) return false;
      cancel();
      const turn = ++generation;
      active = { end: bounds[1], kind, loop: loop.checked };
      loop.checked = false;
      player.currentTime = bounds[0];
      onChange(kind);
      try {
        Promise.resolve(player.play()).catch((error) => {
          if (turn !== generation) return;
          cancel();
          onError(error);
        });
      } catch (error) {
        cancel();
        onError(error);
        return false;
      }
      return true;
    },
    check(time) {
      if (!active || time < active.end) return;
      ownsNativeEnd = finite(player.duration) && time >= player.duration;
      cancel({ keepEndGuard: true });
      player.pause();
    },
    cancel,
    dispose() {
      cancel();
      player.removeEventListener("pause", paused);
      player.removeEventListener("error", paused);
      player.removeEventListener("ended", ended);
    },
  };
}
