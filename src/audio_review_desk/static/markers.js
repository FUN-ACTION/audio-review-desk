export const copyMarkers = (rows) =>
  (rows || []).map((row) => ({ time: row.time, text: row.text }));

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
  const note = String(text).trim();
  if (!note || note.length > 240) throw new RangeError("marker_text");
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
  onChange,
  onError,
}) {
  let draft = [],
    view = [0, 0],
    disabled = true,
    editing = null;
  const format = (time) =>
    `${Math.floor(time / 60)}:${(time % 60).toFixed(3).padStart(6, "0")}`;
  const seek = (time) => {
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
    try {
      draft = reviseMarker(
        draft,
        editing.index,
        editing.timeDirty ? editing.time : editing.originalTime,
        editing.text,
        duration(),
      );
    } catch (error) {
      onError(
        t(
          error.message === "marker_time"
            ? "markerTimeInvalid"
            : "markerRequired",
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
    const changed = {
      time: parseMarkerTime(
        editing.timeDirty ? editing.time : editing.originalTime,
        duration(),
      ),
      text: editing.text.trim(),
    };
    editing = null;
    render();
    onChange();
    if (options.focus)
      list
        .querySelectorAll(".marker-note")
        [
          draft.findIndex(
            (row) => row.time === changed.time && row.text === changed.text,
          )
        ]?.focus();
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
  function edit(index) {
    const target = draft[index];
    if (disabled || !commit()) return;
    index = draft.findIndex(
      (row) => row.time === target.time && row.text === target.text,
    );
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
          text.maxLength = 240;
          text.setAttribute("aria-label", t("editMarkerText"));
          for (const [field, key] of [
            [time, "time"],
            [text, "text"],
          ]) {
            field.disabled = disabled;
            field.addEventListener("input", () => {
              editing[key] = field.value;
              if (key === "time") editing.timeDirty = true;
              onChange();
            });
            field.addEventListener("keydown", (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit({ focus: true });
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                editing = null;
                render();
                onChange();
                list.querySelectorAll(".marker-note")[index]?.focus();
              }
            });
          }
          actions.className = "marker-edit-actions";
          const apply = button(t("apply"), "text-button", () =>
            commit({ focus: true }),
          );
          const cancel = button(t("cancel"), "text-button", () => {
            editing = null;
            render();
            onChange();
            list.querySelectorAll(".marker-note")[index]?.focus();
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
          const text = button(row.text, "marker-note", () => edit(index));
          text.title = t("editMarker");
          text.disabled = disabled;
          const remove = button("", "icon-button", () => {
            if (editing && editing.index !== index && !commit()) return;
            const target = draft.findIndex(
              (note) => note.time === row.time && note.text === row.text,
            );
            if (target >= 0) draft.splice(target, 1);
            editing = null;
            render();
            onChange();
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
  const append = (options = {}) => {
    if (disabled || !commit()) return false;
    const text = input.value.trim();
    if (!text || text.length > 240) {
      onError(t("markerRequired"));
      input.focus();
      return false;
    }
    if (draft.length >= 100) {
      onError(t("markerLimit"));
      return false;
    }
    draft.push({
      time: Math.max(
        0,
        Math.min(duration(), Number((player.currentTime || 0).toFixed(3))),
      ),
      text,
    });
    draft.sort((a, b) => a.time - b.time);
    input.value = "";
    render();
    onChange();
    if (options.focus !== false) input.focus();
    return true;
  };
  add.addEventListener("click", append);
  input.addEventListener("input", onChange);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      append();
    }
  });
  return {
    set(rows, locked) {
      draft = copyMarkers(rows);
      editing = null;
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
    captureFocus() {
      const active = document.activeElement;
      const row = active?.closest(".marker-row");
      if (!row || !list.contains(row)) return null;
      const index = [...list.children].indexOf(row);
      const selector = active.classList.contains("marker-time")
        ? ".marker-time"
        : ".marker-note";
      return () =>
        list.children[index]?.querySelector(selector)?.focus({ preventScroll: true });
    },
    hasChanges(saved) {
      if (input.value.trim()) return true;
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
      return commit() && (!input.value.trim() || append({ focus: false }));
    },
    focus() {
      if (!disabled) input.focus();
    },
  };
}
