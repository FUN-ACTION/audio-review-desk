const naturalCompare = new Intl.Collator(undefined, { numeric: true }).compare;
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
export const searchText = (item) =>
  [
    item.label,
    item.id,
    item.review?.note,
    ...(item.review?.markers || []).map((row) => row.text),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
export function filterItems(items, query, filter, duplicates) {
  const terms = query
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return items.filter(
    (item) =>
      (!terms.length ||
        terms.every((term) => searchText(item).includes(term))) &&
      (filter === "all" ||
        (filter === "warnings"
          ? item.quality.flags.length > 0
          : filter === "duplicates"
            ? duplicates.has(item.id)
            : filter === "noted"
              ? Boolean(item.review.note?.trim() || item.review.markers?.length)
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

export function sameReview(left, right) {
  const snapshot = (review) => ({
    status: review.status,
    score: review.score ?? null,
    trim_start: review.trim_start ?? null,
    trim_end: review.trim_end ?? null,
    issues: [...(review.issues || [])].sort(),
    note: review.note || "",
    markers: (review.markers || [])
      .map((row) => ({ time: row.time, text: row.text }))
      .sort((a, b) => a.time - b.time),
  });
  return JSON.stringify(snapshot(left)) === JSON.stringify(snapshot(right));
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
    return naturalCompare(a.label, b.label) || a.id.localeCompare(b.id);
  });
}
export function playbackRange(duration, start, end) {
  const left =
    Number.isFinite(start) && start >= 0 && start < duration ? start : 0;
  const right =
    Number.isFinite(end) && end > left && end <= duration ? end : duration;
  return [left, right];
}

export function nextPendingItem(items, currentKey) {
  const index = items.findIndex((item) => item.key === currentKey);
  const after =
    index < 0 ? items : [...items.slice(index + 1), ...items.slice(0, index)];
  return after.find((item) => item.review.status === "pending") || null;
}

export function queueStamp(items, language) {
  return JSON.stringify([
    language,
    items.map((item) => [
      item.key,
      item.id,
      item.label,
      item.quality.duration,
      item.quality.flags,
      item.review.status,
      item.review.version,
    ]),
  ]);
}

export function continueQueue(before, current, currentKey) {
  const latest = new Map(current.map((item) => [item.key, item]));
  const index = before.findIndex((item) => item.key === currentKey);
  const order =
    index < 0
      ? before
      : [...before.slice(index + 1), ...before.slice(0, index)];
  return (
    order
      .map((item) => latest.get(item.key))
      .find(
        (item) =>
          item && item.key !== currentKey && item.review.status === "pending",
      ) ||
    current.find(
      (item) => item.key !== currentKey && item.review.status === "pending",
    ) ||
    null
  );
}
