import { stripMarkerText } from "./marker-text.js";
import { copyMarkerDraft } from "./draft-recovery.js";

const markerTextLimit = 240;
// Match Python and reload/history validation: Unicode codepoints, not UTF-16
// units. A native ceiling of twice this limit still bounds supplementary text.
const validMarkerText = text => Boolean(text) && text.length <= markerTextLimit * 2 &&
  [...text].length <= markerTextLimit;

export const copyMarkers = (rows) =>
  (rows || []).map((row) => ({ time: row.time, text: row.text }));

export function formatMarkerTime(time) {
  if (!Number.isFinite(time) || time < 0) return "—";
  const milliseconds = Math.round(time * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function parseMarkerTime(value, duration) {
  if (!Number.isFinite(duration) || duration < 0) return null;
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 && value <= duration
      ? value
      : null;
  const text = String(value).trim();
  if (!/^(?:\d+:)?\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const parts = text.split(":");
  if (parts.length === 2 && Number(parts[1]) >= 60) return null;
  const time =
    parts.length === 2
      ? Number(parts[0]) * 60 + Number(parts[1])
      : Number(parts[0]);
  return Number.isFinite(time) && time >= 0 && time <= duration
    ? Number(time.toFixed(3))
    : null;
}
export function reviseMarker(rows, index, time, text, duration) {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length)
    throw new RangeError("marker_index");
  const seconds = parseMarkerTime(time, duration);
  if (seconds === null) throw new RangeError("marker_time");
  const note = stripMarkerText(text);
  if (!note) throw new RangeError("marker_blank");
  if (!validMarkerText(note)) throw new RangeError("marker_text");
  const next = copyMarkers(rows);
  next[index] = { time: seconds, text: note };
  return next.sort((a, b) => a.time - b.time);
}
export function mountMarkers({
  input,
  add,
  list,
  ticks,
  player,
  duration,
  t,
  onSeek = () => {},
  onChange,
  onError,
}) {
  let draft = [],
    view = [0, 0],
    disabled = true,
    editing = null,
    editingId;
  // Duplicate time/text pairs are valid. Identity belongs to this mounted
  // editor only and must not enter reviews, reload snapshots or exported rows.
  const rowIds = new WeakMap();
  const mint = (row, id = Symbol()) => {
    const copy = { time: row.time, text: row.text };
    rowIds.set(copy, id);
    return copy;
  };
  const rowIndex = (id) => id === undefined
    ? -1 : draft.findIndex((row) => rowIds.get(row) === id);
  const clearEditing = () => { editing = null; editingId = undefined; };
  const focusNote = (id) => list.children[rowIndex(id)]
    ?.querySelector(".marker-note")?.focus();
  const format = formatMarkerTime;
  const seek = (time) => {
    // Release one-shot ownership before the session's synchronous time update.
    onSeek(time);
    player.currentTime = time;
  };
  const button = (label, className, action) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = label;
    node.addEventListener("click", action);
    return node;
  };
  function commit(options = {}) {
    if (!editing) return true;
    const id = editingId, index = rowIndex(id);
    let revised;
    try {
      if (index < 0) throw new RangeError("marker_index");
      // Validate through the public pure function without replacing every
      // unrelated private row. Keep the original slot before stable sorting.
      [revised] = reviseMarker(
        [draft[index]],
        0,
        editing.timeDirty ? editing.time : editing.originalTime,
        editing.text,
        duration(),
      );
    } catch (error) {
      onError(
        t(
          error.message === "marker_time"
            ? "markerTimeInvalid"
            : error.message === "marker_blank" ? "markerBlankEdit" : "markerRequired",
        ),
      );
      list
        .querySelector(
          error.message === "marker_time"
            ? ".marker-edit-time"
            : ".marker-edit-text",
        )
        ?.focus();
      return false;
    }
    const next = [...draft];
    next[index] = mint(revised, id);
    draft = next.sort((a, b) => a.time - b.time);
    clearEditing();
    render();
    onChange();
    if (options.focus) focusNote(id);
    return true;
  }
  function renderTicks() {
    const [start, end] = view;
    ticks.replaceChildren(
      ...draft
        .filter((row) => row.time >= start && row.time <= end)
        .map((row) => {
          const node = button("", "marker-tick", () => seek(row.time));
          node.title = `${format(row.time)} · ${row.text}`;
          node.setAttribute("aria-label", node.title);
          node.style.left = `${(100 * (row.time - start)) / (end - start || 1)}%`;
          node.innerHTML =
            '<svg aria-hidden="true"><use href="#i-marker"/></svg>';
          return node;
        }),
    );
  }
  function edit(id) {
    if (disabled || rowIndex(id) < 0 || !commit()) return;
    const index = rowIndex(id);
    if (index < 0) return;
    const target = draft[index];
    editingId = id;
    editing = {
      index,
      time: format(target.time),
      text: target.text,
      originalTime: target.time,
      timeDirty: false,
    };
    render();
    list.querySelector(".marker-edit-text")?.focus();
  }
  function render() {
    add.disabled = disabled;
    input.disabled = disabled;
    list.replaceChildren(
      ...draft.map((row, index) => {
        const id = rowIds.get(row);
        const wrapper = document.createElement("div");
        wrapper.className = "marker-row";
        if (editing?.index === index) {
          wrapper.classList.add("is-editing");
          const time = document.createElement("input"),
            text = document.createElement("input"),
            actions = document.createElement("div");
          time.type = "text";
          time.className = "marker-edit-time";
          time.value = editing.time;
          time.inputMode = "decimal";
          time.setAttribute("aria-label", t("markerTime"));
          text.type = "text";
          text.className = "marker-edit-text";
          text.value = editing.text;
          text.maxLength = markerTextLimit * 2;
          text.setAttribute("aria-label", t("editMarkerText"));
          for (const [field, key] of [
            [time, "time"],
            [text, "text"],
          ]) {
            field.disabled = disabled;
            field.addEventListener("input", () => {
              if (!editing || editingId !== id) return;
              editing[key] = field.value;
              if (key === "time") editing.timeDirty = true;
              onChange();
            });
            field.addEventListener("keydown", (event) => {
              if (!editing || editingId !== id) return;
              // 229 also covers IME boundary keys when isComposing is already false.
              if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
                event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
              if (event.key === "Enter") {
                event.preventDefault();
                commit({ focus: true });
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                clearEditing();
                render();
                onChange();
                focusNote(id);
              }
            });
          }
          actions.className = "marker-edit-actions";
          const apply = button(t("apply"), "text-button", () => {
            if (editingId === id) commit({ focus: true });
          });
          const cancel = button(t("cancel"), "text-button", () => {
            if (editingId !== id) return;
            clearEditing();
            render();
            onChange();
            focusNote(id);
          });
          apply.disabled = disabled;
          cancel.disabled = disabled;
          actions.append(apply, cancel);
          wrapper.append(time, text, actions);
        } else {
          const time = button(format(row.time), "marker-time", () =>
            seek(row.time),
          );
          time.title = t("seekNote");
          const text = button(row.text, "marker-note", () => edit(id));
          text.title = t("editMarker");
          text.disabled = disabled;
          const remove = button("", "icon-button marker-remove", () => {
            if (disabled || rowIndex(id) < 0) return;
            const restoreFocus = document.activeElement === remove;
            if (editing && editingId !== id && !commit()) return;
            const target = rowIndex(id);
            if (target < 0) return;
            draft.splice(target, 1);
            clearEditing();
            render();
            onChange();
            if (restoreFocus) {
              const next = list.children[Math.min(target, draft.length - 1)]
                ?.querySelector(".marker-remove");
              (next || input).focus();
            }
          });
          remove.disabled = disabled;
          remove.setAttribute("aria-label", t("removeMarker"));
          remove.innerHTML =
            '<svg aria-hidden="true"><use href="#i-close"/></svg>';
          wrapper.append(time, text, remove);
        }
        return wrapper;
      }),
    );
    renderTicks();
  }
  const pendingText = () => {
    const text = stripMarkerText(input.value);
    if (!validMarkerText(text)) {
      onError(t(!text && input.value !== "" ? "markerBlankPending" : "markerRequired"));
      input.focus();
      return null;
    }
    if (draft.length >= 100) {
      onError(t("markerLimit"));
      input.focus();
      return null;
    }
    return text;
  };
  const append = (options = {}) => {
    if (disabled) return false;
    // Reject every pending-note failure before committing another inline edit.
    const text = pendingText();
    if (text === null || !commit()) return false;
    draft.push(mint({
      time: Math.max(
        0,
        Math.min(duration(), Number((player.currentTime || 0).toFixed(3))),
      ),
      text,
    }));
    draft.sort((a, b) => a.time - b.time);
    input.value = "";
    render();
    onChange();
    if (options.focus !== false) input.focus();
    return true;
  };
  const recoverySnapshot = (snapshot) => {
    const next = copyMarkerDraft(snapshot);
    if (!next) return null;
    const limit = duration();
    if (
      next.rows.length &&
      (!Number.isFinite(limit) ||
        limit < 0 ||
        next.rows.some((row) => row.time > limit))
    )
      return null;
    return next;
  };
  add.addEventListener("click", append);
  input.addEventListener("input", onChange);
  input.addEventListener("keydown", (event) => {
    // 229 also covers IME boundary keys when isComposing is already false.
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      append();
    }
  });
  return {
    set(rows, locked) {
      draft = copyMarkers(rows).map((row) => mint(row));
      clearEditing();
      disabled = locked;
      input.value = "";
      render();
    },
    refresh(locked) {
      disabled = locked;
      render();
    },
    view(start, end) {
      view = [start, end];
      renderTicks();
    },
    get() {
      return copyMarkers(draft);
    },
    snapshot() {
      // Recovery is a copy of the editor, not an implicit Apply or Add.
      return {
        rows: copyMarkers(draft),
        input: input.value,
        editing: editing ? { ...editing } : null,
      };
    },
    canRestore(snapshot) {
      return recoverySnapshot(snapshot) !== null;
    },
    restore(snapshot, locked) {
      const next = recoverySnapshot(snapshot);
      if (!next) return false;
      // Validate everything before replacing even the uncommitted input.
      draft = next.rows.map((row) => mint(row));
      editing = next.editing;
      editingId = editing ? rowIds.get(draft[editing.index]) : undefined;
      input.value = next.input;
      disabled = locked;
      render();
      return true;
    },
    captureFocus() {
      const active = document.activeElement;
      const row = active?.closest(".marker-row");
      if (!row || !list.contains(row)) return null;
      const index = [...list.children].indexOf(row);
      const id = rowIds.get(draft[index]);
      if (id === undefined) return null;
      const selector = active.classList.contains("marker-time")
        ? ".marker-time"
        : ".marker-note";
      return () => {
        // set/restore replace the editor's identity domain. An old capture
        // must never guess a same-valued row or fall back to its old index.
        list.children[rowIndex(id)]
          ?.querySelector(selector)
          ?.focus({ preventScroll: true });
      };
    },
    hasChanges(saved) {
      if (input.value !== "") return true;
      let current = draft;
      if (editing) {
        try {
          current = reviseMarker(
            draft,
            editing.index,
            editing.timeDirty ? editing.time : editing.originalTime,
            editing.text,
            duration(),
          );
        } catch {
          return true;
        }
      }
      return (
        JSON.stringify(copyMarkers(current)) !==
        JSON.stringify(copyMarkers(saved))
      );
    },
    flush() {
      // Raw nonempty input is a draft even if Python would strip it to empty.
      return input.value !== "" ? append({ focus: false }) : commit();
    },
    focus() {
      if (!disabled) input.focus();
    },
  };
}
