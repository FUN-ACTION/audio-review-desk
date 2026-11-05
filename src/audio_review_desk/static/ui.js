const naturalCompare = new Intl.Collator(undefined, { numeric: true }).compare;
// Keep the existing locale/NFKC rules, equating Greek final sigma only.
// This is deliberately not full Unicode case folding or accent removal.
export const normalizeSearch = (value) => value.normalize("NFKC").toLocaleLowerCase().replace(/ς/g, "σ");
export const searchTerms = (query) => normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
export const searchText = (item) => normalizeSearch(
  [
    item.label,
    item.id,
    item.review?.note,
    ...(item.review?.markers || []).map((row) => row.text),
  ]
    .filter(Boolean)
    .join(" "),
);
// B advisories participate in the same item-level attention queue as A.
export const oggAdvisoryFlags = (quality) => (quality?.flags || []).filter(
  flag => ["ogg_ending_unconfirmed", "ogg_check_incomplete", "mp3_frame_count_differs", "mp3_check_incomplete", "mp4_extent_exceeds_file", "mp4_check_incomplete", "mp4_indexed_audio_bytes_unavailable"].includes(flag),
);
export const hasItemWarnings = (item) => Boolean(
  item.quality.flags.length || oggAdvisoryFlags(item.reference_quality).length,
);
export function filterItems(items, query, filter, duplicates) {
  const terms = searchTerms(query);
  return items.filter(
    (item) =>
      (!terms.length ||
        terms.every((term) => searchText(item).includes(term))) &&
      (filter === "all" ||
        (filter === "warnings"
          ? hasItemWarnings(item)
          : filter === "duplicates"
            ? duplicates.has(item.id)
            : filter === "noted"
              ? Boolean(item.review.note?.trim() || item.review.markers?.length)
              : item.review.status === filter)),
  );
}

// Passive search context uses saved catalog annotations only. It never reads
// live form fields, changes matching rules, seeks audio or persists any data.
let excerptSegmenter;
function searchExcerpt(text, normalized, terms, limit = 100) {
  const position = Math.min(...terms.map(term => normalized.indexOf(term)).filter(index => index >= 0));
  // Prefer a verified literal/case-insensitive original match. Its index is
  // already in original text, even when earlier compatibility characters expand.
  const originalMatches = terms.map(term => {
    const exact = text.indexOf(term);
    if (exact >= 0) return { index: exact, length: term.length, term };
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(escaped, "iu").exec(text);
    return match && normalizeSearch(match[0]).includes(term)
      ? { index: match.index, length: match[0].length, term } : null;
  }).filter(Boolean).sort((left, right) => left.index - right.index);
  const originalMatch = originalMatches[0];
  const original = originalMatch?.index ?? null;
  if (position === 0 && [...text].length <= limit) return text;
  const budget = limit - 2;
  // Start at the match so a two-line queue cannot hide a short note's late hit.
  if (/^[\x00-\x7f]*$/.test(text)) {
    const start = original ?? position, end = Math.min(text.length, start + budget);
    return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }
  let segments;
  try {
    if (typeof Intl.Segmenter !== "function") return "…";
    excerptSegmenter ||= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    segments = excerptSegmenter.segment(text);
    if (typeof segments.containing !== "function") return "…";
  } catch {
    // Preserve the source/time context without splitting unknown graphemes.
    return "…";
  }
  // Normalize original prefixes at grapheme boundaries. Random-access boundary
  // lookup avoids expanding every grapheme of a long note on every search.
  let anchor = original === null ? null : segments.containing(original);
  if (anchor) {
    // Check the corresponding fully normalized text, not an isolated match:
    // combining marks and contextual case folding can erase a raw match.
    const last = segments.containing(original + originalMatch.length - 1);
    const from = normalizeSearch(text.slice(0, anchor.index)).length;
    const to = normalizeSearch(text.slice(0, last.index + last.segment.length)).length;
    if (!normalized.slice(from, to).includes(originalMatch.term)) anchor = null;
  }
  if (!anchor) {
    let low = 0, high = text.length;
    while (low < high) {
      const part = segments.containing(Math.floor((low + high) / 2));
      const length = normalizeSearch(text.slice(0, part.index)).length;
      if (length <= position) { anchor = part; low = part.index + part.segment.length; }
      else high = part.index;
    }
  }
  if (!anchor) return "…";
  const start = anchor.index;
  let end = start, used = 0;
  const excerpt = [];
  while (end < text.length) {
    const part = segments.containing(end), size = [...part.segment].length;
    if (used + size > budget) break;
    used += size; excerpt.push(part.segment); end += part.segment.length;
  }
  if (!excerpt.length) return "…";
  return `${start ? "…" : ""}${excerpt.join("")}${end < text.length ? "…" : ""}`;
}

export function reviewSearchContext(item, query) {
  const terms = [...new Set(searchTerms(query))];
  if (!terms.length) return null;
  const identity = normalizeSearch([item.label, item.id].filter(Boolean).join(" "));
  const unexplained = terms.filter(term => !identity.includes(term));
  if (!unexplained.length) return null;
  const candidates = [];
  const add = (kind, raw, time = null, order = 0) => {
    if (typeof raw !== "string") return;
    const text = raw.replace(/\s+/gu, " ").trim();
    if (!text) return;
    const normalized = normalizeSearch(text);
    const matches = unexplained.filter(term => normalized.includes(term));
    if (matches.length) candidates.push({ kind, text, normalized, time, order, matches });
  };
  add("note", item.review?.note);
  const markers = Array.isArray(item.review?.markers) ? item.review.markers : [];
  for (const [order, marker] of markers.entries()) {
    if (Number.isFinite(marker?.time) && marker.time >= 0) add("marker", marker.text, marker.time, order);
  }
  candidates.sort((left, right) => right.matches.length - left.matches.length ||
    Number(left.kind === "marker") - Number(right.kind === "marker") ||
    (left.time ?? 0) - (right.time ?? 0) || left.order - right.order);
  const match = candidates[0];
  return match ? { kind: match.kind, time: match.time,
    excerpt: searchExcerpt(match.text, match.normalized, match.matches) } : null;
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
      oggAdvisoryFlags(item.reference_quality),
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
