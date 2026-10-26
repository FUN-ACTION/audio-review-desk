export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
export function filterItems(items, query, filter, duplicates) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (!term ||
        `${item.label} ${item.id}`.toLocaleLowerCase().includes(term)) &&
      (filter === "all" ||
        (filter === "warnings"
          ? item.quality.flags.length > 0
          : filter === "duplicates"
            ? duplicates.has(item.id)
            : item.review.status === filter)),
  );
}
export function reviewPayload(item, values) {
  const number = (value) => (value.trim() === "" ? null : Number(value));
  return {
    key: item.key,
    expected_version: item.review.version,
    status: values.status,
    score: number(values.score),
    trim_start: number(values.trimStart),
    trim_end: number(values.trimEnd),
    issues: values.issues,
    note: values.note,
    markers: (values.markers || []).map((row) => ({ ...row })),
  };
}

export function sortItems(items, order) {
  return [...items].sort((a, b) => {
    if (order === "recent")
      return (
        (b.review.updated_utc || "").localeCompare(
          a.review.updated_utc || "",
        ) || a.id.localeCompare(b.id)
      );
    if (order === "duration")
      return (
        (b.quality.duration || 0) - (a.quality.duration || 0) ||
        a.id.localeCompare(b.id)
      );
    if (order === "level")
      return (
        (b.quality.rms_dbfs ?? -999) - (a.quality.rms_dbfs ?? -999) ||
        a.id.localeCompare(b.id)
      );
    return (
      a.label.localeCompare(b.label, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id)
    );
  });
}
export function playbackRange(duration, start, end) {
  const left =
    Number.isFinite(start) && start >= 0 && start < duration ? start : 0;
  const right =
    Number.isFinite(end) && end > left && end <= duration ? end : duration;
  return [left, right];
}
