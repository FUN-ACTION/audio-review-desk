// Source time drives every visible value; scrubbing never waits for an animation.
export function mountTransport({
  player,
  media = player,
  button,
  seek,
  back,
  forward,
  volume,
  range,
  loop,
  onTime,
  onError,
  onRangeUnavailable = () => {},
  labels,
}) {
  let frame = 0,
    scrub = null,
    textAt = 0,
    rendering = false;
  const loopBounds = () => {
    const [start, requestedEnd] = range();
    const end = Number.isFinite(media.duration)
      ? Math.min(requestedEnd, media.duration)
      : requestedEnd;
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
      ? [start, end] : null;
  };
  const render = (now = 0) => {
    // A session seek/pause can synchronously notify this view. Keep one render
    // and one animation chain even when correcting a loop boundary.
    if (rendering) return;
    rendering = true;
    try {
      cancelAnimationFrame(frame);
      frame = 0;
      if (loop.checked && !player.paused && !media.pending) {
        const bounds = loopBounds();
        if (!bounds) {
          media.pause();
          onRangeUnavailable();
        } else {
          const [start, end] = bounds;
          if (media.currentTime >= end || media.currentTime < start)
            media.currentTime = start;
        }
      }
      onTime(media.currentTime || 0, now - textAt > 70 || !now);
      if (now - textAt > 70 || !now) textAt = now;
      if (!player.paused) frame = requestAnimationFrame(render);
    } finally {
      rendering = false;
    }
  };
  const state = () => {
    button.classList.toggle("is-playing", !media.paused);
    button.setAttribute(
      "aria-label",
      media.paused ? labels().play : labels().pause,
    );
    button.title = media.paused ? labels().play : labels().pause;
    if (media.pending) button.classList.toggle("is-loading", !media.paused);
  };
  const play = () => {
    if (loop.checked) {
      const bounds = loopBounds();
      if (!bounds) {
        media.pause();
        onRangeUnavailable();
        return;
      }
      const [start, end] = bounds;
      if (media.currentTime < start || media.currentTime >= end)
        media.currentTime = start;
    }
    media.play().catch((error) => {
      button.classList.remove("is-loading");
      onError(error.message);
    });
  };
  button.addEventListener("click", () => {
    if (media.paused) play();
    else media.pause();
  });
  back.addEventListener("click", () => {
    media.currentTime = Math.max(0, media.currentTime - 5);
    render();
  });
  forward.addEventListener("click", () => {
    media.currentTime = Math.min(
      Number.isFinite(media.duration) ? media.duration : 0,
      media.currentTime + 5,
    );
    render();
  });
  volume.addEventListener("input", () => {
    player.volume = Number(volume.value);
  });
  seek.addEventListener("pointerdown", () => {
    const resume = !media.paused;
    media.pause();
    // Capture after our own pause. A later source switch, explicit playback
    // action or error revokes this gesture, even if old native events arrive late.
    scrub = { resume, revision: media.intentRevision };
  });
  seek.addEventListener("input", () => {
    if (scrub && scrub.revision !== media.intentRevision) {
      onTime(media.currentTime, true);
      return;
    }
    media.currentTime = Number(seek.value);
    onTime(media.currentTime, true);
  });
  const finish = () => {
    if (!scrub) return;
    const resume = scrub.resume && scrub.revision === media.intentRevision;
    scrub = null;
    if (resume) play();
  };
  seek.addEventListener("change", finish);
  seek.addEventListener("pointerup", finish);
  seek.addEventListener("pointercancel", finish);
  player.addEventListener("play", () => {
    state();
    cancelAnimationFrame(frame);
    render();
  });
  player.addEventListener("pause", () => {
    state();
    cancelAnimationFrame(frame);
    frame = 0;
    render();
  });
  player.addEventListener("timeupdate", () => {
    if (!frame) render();
  });
  for (const event of ["waiting", "loadstart"])
    player.addEventListener(event, () => {
      if (!media.paused) button.classList.add("is-loading");
    });
  for (const event of ["playing", "canplay", "pause", "error", "emptied"])
    player.addEventListener(event, () => {
      button.classList.remove("is-loading");
      state();
    });
  player.addEventListener("loadedmetadata", () => {
    seek.disabled = false;
    render();
  });
  player.addEventListener("ended", () => {
    if (loop.checked && !media.pending) play();
    else state();
  });
  return { refresh: state, render };
}
