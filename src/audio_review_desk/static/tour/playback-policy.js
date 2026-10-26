export function shouldPlay({
  visible,
  pageVisible,
  reducedMotion,
  saveData = false,
  choice = "auto",
}) {
  if (!visible || !pageVisible || choice === "pause") return false;
  return choice === "play" || (!reducedMotion && !saveData);
}

export function activeClip(entries) {
  return (
    entries
      .filter((entry) => entry.ratio >= 0.2)
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
