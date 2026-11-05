import { stripMarkerText } from "./marker-text.js";
// Best-effort recovery for a reload in this tab and origin, not a durable backup.
// Only review fields enter storage. Never pass an item, audio, path or session token.
const SCHEMA = 1;
const MAX_SERIALIZED = 256 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const STATUSES = new Set(["pending", "pass", "fix", "exclude"]);
const ISSUES = new Set([
  "cut_start", "cut_end", "noise", "reverb", "backing_voice", "instrument",
  "lyrics", "distortion", "identity", "other",
]);
const BASE_FIELDS = [
  "version", "status", "score", "trim_start", "trim_end", "issues", "note", "markers",
];

// Reject accessors, inherited fields, exotic objects and unknown stored fields.
// Server reviews may have metadata, but copying a baseline never reads that data.
function fields(value, names, exact = true) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (exact && Reflect.ownKeys(value).length !== names.length) return null;
  const result = {};
  for (const name of names) {
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (!property || !("value" in property)) return null;
    result[name] = property.value;
  }
  return result;
}

function array(value, limit) {
  if (!Array.isArray(value) || value.length > limit) return null;
  // A dense data-only array prevents holes or getters being silently serialized.
  if (Reflect.ownKeys(value).length !== value.length + 1) return null;
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !("value" in property)) return null;
    result.push(property.value);
  }
  return result;
}

function string(value, limit) {
  if (typeof value !== "string" || value.length > limit * 2) return false;
  let count = 0;
  for (const character of value) {
    if (++count > limit) return false;
  }
  return true;
}

const time = (value) =>
  typeof value === "number" && Number.isFinite(value) &&
  value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const nullableTime = (value) => value === null || time(value);

function issueList(value) {
  const rows = array(value, ISSUES.size);
  if (!rows || rows.some((issue) => !ISSUES.has(issue)) ||
      new Set(rows).size !== rows.length) return null;
  return rows;
}

function markerRows(value) {
  const rows = array(value, 100);
  if (!rows) return null;
  const result = [];
  for (const value of rows) {
    const row = fields(value, ["time", "text"]);
    if (!row || !time(row.time) || !string(row.text, 240) || !stripMarkerText(row.text))
      return null;
    result.push(row);
  }
  return result;
}

function baselineCopy(review, exact = false) {
  const value = fields(review, BASE_FIELDS, exact);
  if (!value || !Number.isSafeInteger(value.version) || value.version < 0 ||
      !STATUSES.has(value.status) ||
      !(value.score === null || (typeof value.score === "number" &&
        Number.isFinite(value.score) && value.score >= 0 && value.score <= 10)) ||
      !nullableTime(value.trim_start) || !nullableTime(value.trim_end) ||
      !string(value.note, 4000)) return null;
  const issues = issueList(value.issues), markers = markerRows(value.markers);
  if (!issues || !markers) return null;
  return {
    version: value.version,
    status: value.status,
    score: value.score,
    trim_start: value.trim_start,
    trim_end: value.trim_end,
    issues: issues.sort(),
    note: value.note,
    markers: markers.sort((left, right) => left.time - right.time),
  };
}

// Metadata such as origin/updated_utc is intentionally outside draft identity.
export function canonicalBaseline(review) {
  try { return baselineCopy(review); } catch { return null; }
}

export function sameDraftBaseline(record, itemReview) {
  try {
    const property = Object.getOwnPropertyDescriptor(record, "baseline");
    const saved = property && "value" in property
      ? baselineCopy(property.value, true) : null;
    const current = baselineCopy(itemReview);
    return Boolean(saved && current && JSON.stringify(saved) === JSON.stringify(current));
  } catch { return false; }
}

function markerDraftCopy(snapshot) {
  const value = fields(snapshot, ["rows", "input", "editing"]);
  if (!value || !string(value.input, 240)) return null;
  const rows = markerRows(value.rows);
  if (!rows) return null;
  let editing = null;
  if (value.editing !== null) {
    editing = fields(value.editing, ["index", "time", "text", "originalTime", "timeDirty"]);
    if (!editing || !Number.isSafeInteger(editing.index) || editing.index < 0 ||
        editing.index >= rows.length || !string(editing.time, 128) ||
        !string(editing.text, 240) || !time(editing.originalTime) ||
        editing.originalTime !== rows[editing.index].time ||
        typeof editing.timeDirty !== "boolean") return null;
  }
  // Do not flush, trim, parse or sort raw editor state.
  return { rows, input: value.input, editing };
}

export function copyMarkerDraft(snapshot) {
  try { return markerDraftCopy(snapshot); } catch { return null; }
}

function formCopy(form) {
  const value = fields(form, ["status", "score", "trimStart", "trimEnd", "issues", "note"]);
  if (!value || !STATUSES.has(value.status) || !string(value.score, 128) ||
      !string(value.trimStart, 128) || !string(value.trimEnd, 128) ||
      !string(value.note, 4000)) return null;
  const issues = issueList(value.issues);
  return issues ? { ...value, issues } : null;
}

function recordCopy(raw, workspaceId) {
  const value = fields(raw, ["schema", "workspaceId", "key", "baseline", "form", "markers", "updatedAt"]);
  if (!value || value.schema !== SCHEMA || value.workspaceId !== workspaceId ||
      typeof value.key !== "string" || !HASH.test(value.key) || !time(value.updatedAt)) return null;
  const baseline = baselineCopy(value.baseline, true), form = formCopy(value.form),
    markers = markerDraftCopy(value.markers);
  if (!baseline || !form || !markers) return null;
  return { schema: SCHEMA, workspaceId, key: value.key, baseline, form, markers, updatedAt: value.updatedAt };
}

function boundedJSON(value) {
  if (typeof value !== "string" || value.length > MAX_SERIALIZED) return false;
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > MAX_SERIALIZED) return false;
  }
  return true;
}

// storage may be a Storage-like object or a lazy () => sessionStorage resolver.
// Laziness catches denied storage getters and lets a later operation try again.
export function createDraftRecovery(options = {}) {
  let workspaceId;
  try { workspaceId = options.workspaceId; } catch { /* Invalid configuration. */ }
  const validWorkspace = typeof workspaceId === "string" && HASH.test(workspaceId);
  const storageKey = validWorkspace ? `ard-reload-draft-v1:${workspaceId}` : null;
  const storage = () => {
    const source = options.storage;
    return typeof source === "function" ? source()
      : source === undefined ? globalThis.sessionStorage : source;
  };
  return {
    read() {
      if (!validWorkspace) return { status: "invalid" };
      let raw;
      try { raw = storage().getItem(storageKey); }
      catch { return { status: "unavailable" }; }
      if (raw === null) return { status: "empty" };
      try {
        if (!boundedJSON(raw)) return { status: "invalid" };
        const record = recordCopy(JSON.parse(raw), workspaceId);
        return record ? { status: "available", record } : { status: "invalid" };
      } catch { return { status: "invalid" }; }
    },
    write(draft) {
      if (!validWorkspace) return { status: "invalid" };
      let record, serialized;
      try {
        const value = fields(draft, ["key", "baseline", "form", "markers"]);
        if (!value) return { status: "invalid" };
        const baseline = baselineCopy(value.baseline);
        if (!baseline) return { status: "invalid" };
        // Validate before invoking the clock or accessing storage.
        record = recordCopy({ schema: SCHEMA, workspaceId, ...value, baseline, updatedAt: 0 }, workspaceId);
        if (!record) return { status: "invalid" };
      } catch { return { status: "invalid" }; }
      try {
        const now = options.now === undefined ? Date.now : options.now;
        record.updatedAt = now();
      } catch { return { status: "unavailable" }; }
      if (!time(record.updatedAt)) return { status: "invalid" };
      try {
        serialized = JSON.stringify(record);
        if (!boundedJSON(serialized)) return { status: "invalid" };
      } catch { return { status: "invalid" }; }
      try {
        const target = storage();
        target.setItem(storageKey, serialized);
        if (target.getItem(storageKey) !== serialized) return { status: "unavailable" };
        return { status: "saved", record };
      } catch { return { status: "unavailable" }; }
    },
    clear() {
      if (!validWorkspace) return { status: "unavailable" };
      try {
        const target = storage();
        target.removeItem(storageKey);
        return { status: target.getItem(storageKey) === null ? "empty" : "unavailable" };
      } catch { return { status: "unavailable" }; }
    },
  };
}
