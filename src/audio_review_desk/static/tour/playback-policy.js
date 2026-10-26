export function shouldPlay({
  visible,
  pageVisible,
  reducedMotion,
  saveData = false,
  choice = "auto",
  completed = false,
  modalOpen = false,
}) {
  if (!visible || !pageVisible || modalOpen || completed || choice === "pause")
    return false;
  return choice === "play" || (!reducedMotion && !saveData);
}

export function clampFilmTime(time, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(duration, Number.isFinite(time) ? time : 0));
}

export function installCommands(platform) {
  if (platform === "windows") return "";
  if (!["macos", "linux"].includes(platform))
    throw new Error("Unknown installation platform");
  return "python3 -m venv .venv\n.venv/bin/python -m pip install .\n.venv/bin/python -m audio_review_desk init --workspace review-workspace\n.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open";
}

export function activeClip(entries) {
  return (
    entries
      .filter(
        (entry) =>
          entry.ratio >= 0.2 || (entry.choice === "play" && entry.ratio > 0),
      )
      .sort(
        (a, b) =>
          Number(b.choice === "play") - Number(a.choice === "play") ||
          b.ratio - a.ratio,
      )[0]?.id ?? null
  );
}

export function mediaPath(clip, language, extension = "mp4") {
  if (
    !["workflow", "notes", "range"].includes(clip) ||
    !["zh", "en"].includes(language) ||
    !["mp4", "webp"].includes(extension)
  )
    throw new Error("Unknown showcase asset");
  return `./media/${clip}-${language}.${extension}`;
}
