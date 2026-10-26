// Source time drives every visible value; scrubbing never waits for an animation.
export function mountTransport({
  player,
  button,
  seek,
  back,
  forward,
  volume,
  range,
  loop,
  onTime,
  onError,
  labels,
}) {
  let frame = 0,
    seeking = false,
    resume = false,
    textAt = 0;
  const render = (now = 0) => {
    if (!now) cancelAnimationFrame(frame);
    if (loop.checked && !player.paused) {
      const [start, end] = range();
      if (player.currentTime >= end || player.currentTime < start)
        player.currentTime = start;
    }
    onTime(player.currentTime || 0, now - textAt > 70 || !now);
    if (now - textAt > 70 || !now) textAt = now;
    if (!player.paused) frame = requestAnimationFrame(render);
    else frame = 0;
  };
  const state = () => {
    button.classList.toggle("is-playing", !player.paused);
    button.setAttribute(
      "aria-label",
      player.paused ? labels().play : labels().pause,
    );
    button.title = player.paused ? labels().play : labels().pause;
  };
  const play = () => {
    const [start, end] = range();
    if (
      loop.checked &&
      (player.currentTime < start || player.currentTime >= end)
    )
      player.currentTime = start;
    player.play().catch((error) => {
      button.classList.remove("is-loading");
      onError(error.message);
    });
  };
  button.addEventListener("click", () => {
    if (player.paused) play();
    else player.pause();
  });
  back.addEventListener("click", () => {
    player.currentTime = Math.max(0, player.currentTime - 5);
    render();
  });
  forward.addEventListener("click", () => {
    player.currentTime = Math.min(
      Number.isFinite(player.duration) ? player.duration : 0,
      player.currentTime + 5,
    );
    render();
  });
  volume.addEventListener("input", () => {
    player.volume = Number(volume.value);
  });
  seek.addEventListener("pointerdown", () => {
    seeking = true;
    resume = !player.paused;
    player.pause();
  });
  seek.addEventListener("input", () => {
    player.currentTime = Number(seek.value);
    onTime(player.currentTime, true);
  });
  const finish = () => {
    if (!seeking) return;
    seeking = false;
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
      if (!player.paused) button.classList.add("is-loading");
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
    if (loop.checked) play();
    else state();
  });
  return { refresh: state, render };
}
