export function mountPreview({ video, button, t }) {
  let language = "zh",
    loaded = false,
    failed = false;
  const label = () => {
    button.textContent = t(
      failed
        ? "previewUnavailable"
        : video.paused
          ? "previewPlay"
          : "previewPause",
    );
    button.setAttribute("aria-pressed", String(!video.paused));
    button.disabled = failed;
  };
  button.addEventListener("click", () => {
    if (!video.paused) return video.pause();
    if (!loaded) {
      video.src = `/tour/media/workflow-${language}.mp4`;
      loaded = true;
    }
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => label());
  });
  for (const event of ["play", "pause", "ended"])
    video.addEventListener(event, label);
  video.addEventListener("error", () => {
    if (loaded) {
      failed = true;
      label();
    }
  });
  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) video.pause();
  }).observe(video);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
  });
  return {
    language(next) {
      video.pause();
      language = next;
      failed = false;
      loaded = false;
      video.removeAttribute("src");
      video.poster = `/tour/media/workflow-${language}.webp`;
      video.load();
      label();
    },
  };
}
