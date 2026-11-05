// Keep user intent separate from the native pause/reset caused by changing src.
// The caller still listens for media events on the native player.
export function createMediaSession({
  player,
  playbackRate = () => 1,
  onChange = () => {},
  onError = () => {},
}) {
  let transition = null;
  let generation = 0;
  const position = (value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0;
  const duration = (value) =>
    Number.isFinite(value) && value >= 0 ? value : 0;
  const bounded = (value) =>
    Number.isFinite(player.duration) && player.duration >= 0
      ? Math.min(position(value), player.duration)
      : position(value);
  const clear = () => {
    if (transition && player.onloadedmetadata === transition.ready)
      player.onloadedmetadata = null;
    transition = null;
  };
  const cancel = () => {
    generation += 1;
    clear();
  };
  player.addEventListener("error", () => {
    cancel();
    onChange();
  });
  const play = () => {
    const request = ++generation;
    if (transition) {
      transition.resume = true;
      onChange();
      return Promise.resolve();
    }
    // Promise wrapping also normalizes synchronous play failures and old media
    // implementations that return undefined instead of a Promise.
    let result;
    try {
      result = player.play();
    } catch (error) {
      result = Promise.reject(error);
    }
    onChange();
    return Promise.resolve(result).catch((error) => {
      if (request === generation) throw error;
    });
  };
  return {
    // A control may remember an intent only while no later playback/source
    // action supersedes it. Position changes and queued native events do not.
    get intentRevision() {
      return generation;
    },
    get currentTime() {
      return transition ? transition.time : position(player.currentTime);
    },
    set currentTime(value) {
      if (!Number.isFinite(value)) return;
      if (transition) transition.time = position(value);
      else player.currentTime = bounded(value);
      onChange();
    },
    get paused() {
      return transition ? !transition.resume : player.paused;
    },
    get duration() {
      return transition ? transition.duration : duration(player.duration);
    },
    get pending() {
      return transition !== null;
    },
    load({ url, key, time, resume, duration: expectedDuration }) {
      const previous = transition?.key === key ? transition : null;
      const next = {
        key,
        time: position(time ?? previous?.time ?? player.currentTime),
        resume: Boolean(resume ?? previous?.resume ?? !player.paused),
        duration: duration(expectedDuration ?? previous?.duration),
        ready: null,
      };
      cancel();
      transition = next;
      next.ready = () => {
        if (transition !== next) return;
        const request = generation;
        clear();
        try {
          player.currentTime = bounded(next.time);
          const rate = playbackRate();
          player.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
        } catch (error) {
          onChange();
          if (request === generation) onError(error);
          return;
        }
        onChange();
        if (next.resume && request === generation) {
          const resumed = play();
          // play already discards failures invalidated by newer user intent.
          const attempt = generation;
          resumed.catch((error) => {
            if (attempt === generation) onError(error);
          });
        }
      };
      player.onloadedmetadata = next.ready;
      try {
        player.pause();
        player.src = url;
        player.load();
      } catch (error) {
        if (transition === next) {
          cancel();
          onChange();
          onError(error);
        }
        return;
      }
      onChange();
    },
    play,
    pause() {
      generation += 1;
      if (transition) transition.resume = false;
      player.pause();
      onChange();
    },
    cancel,
  };
}
