export const copyMarkers = (rows) =>
  (rows || []).map((row) => ({ time: row.time, text: row.text }));
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
    disabled = true;
  const format = (time) =>
    `${Math.floor(time / 60)}:${(time % 60).toFixed(3).padStart(6, "0")}`;
  const seek = (time) => {
    player.currentTime = time;
  };
  function renderTicks() {
    const [start, end] = view;
    ticks.replaceChildren(
      ...draft
        .filter((row) => row.time >= start && row.time <= end)
        .map((row) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "marker-tick";
          button.title = `${format(row.time)} · ${row.text}`;
          button.setAttribute("aria-label", button.title);
          button.style.left = `${(100 * (row.time - start)) / (end - start || 1)}%`;
          button.innerHTML =
            '<svg aria-hidden="true"><use href="#i-marker"/></svg>';
          button.addEventListener("click", () => seek(row.time));
          return button;
        }),
    );
  }
  function render() {
    add.disabled = disabled;
    input.disabled = disabled;
    list.replaceChildren(
      ...draft.map((row, i) => {
        const wrapper = document.createElement("div"),
          time = document.createElement("button"),
          text = document.createElement("p"),
          remove = document.createElement("button");
        wrapper.className = "marker-row";
        time.className = "marker-time";
        time.type = "button";
        time.textContent = format(row.time);
        time.title = t("seekNote");
        time.addEventListener("click", () => seek(row.time));
        text.textContent = row.text;
        remove.type = "button";
        remove.className = "icon-button";
        remove.disabled = disabled;
        remove.setAttribute("aria-label", t("removeMarker"));
        remove.innerHTML =
          '<svg aria-hidden="true"><use href="#i-close"/></svg>';
        remove.addEventListener("click", () => {
          draft.splice(i, 1);
          render();
          onChange();
        });
        wrapper.append(time, text, remove);
        return wrapper;
      }),
    );
    renderTicks();
  }
  const append = (options = {}) => {
    if (disabled) return;
    const text = input.value.trim();
    if (!text) {
      onError(t("markerRequired"));
      input.focus();
      return;
    }
    if (draft.length >= 100) {
      onError(t("markerLimit"));
      return;
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
    flush() {
      if (!input.value.trim()) return true;
      if (draft.length >= 100) {
        onError(t("markerLimit"));
        return false;
      }
      append({ focus: false });
      return true;
    },
    focus() {
      if (!disabled) input.focus();
    },
  };
}
