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
  };
}
