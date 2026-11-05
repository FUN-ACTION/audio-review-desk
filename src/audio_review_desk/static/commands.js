import { openDialog } from "./motion.js";
import { normalizeSearch, searchTerms } from "./ui.js";
export function findCommands(rows, query) {
  const terms = searchTerms(query);
  return rows
    .filter((row) =>
      terms.every((term) =>
        normalizeSearch(`${row.label} ${row.search || ""}`).includes(term),
      ),
    )
    .slice(0, 16);
}
export function mountCommands({
  dialog,
  input,
  list,
  emptyStatus,
  rows,
  emptyText,
  onError,
}) {
  let shown = [],
    index = 0;
  const highlight = () => {
    shown.forEach((_, i) =>
      list.children[i].setAttribute("aria-selected", String(i === index)),
    );
    if (shown.length) {
      input.setAttribute("aria-activedescendant", `command-${index}`);
      list.children[index]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const run = async (i) => {
    const row = shown[i];
    if (!row) return;
    dialog.close();
    try {
      await row.run();
    } catch (error) {
      onError(error);
    }
  };
  const render = ({ preserveSelection = false } = {}) => {
    shown = findCommands(rows(), input.value);
    index = preserveSelection ? Math.min(index, Math.max(0, shown.length - 1)) : 0;
    list.replaceChildren(
      ...shown.map((row, i) => {
        const button = document.createElement("button"),
          label = document.createElement("span"),
          hint = document.createElement("small");
        button.className = "command-option";
        button.id = `command-${i}`;
        button.setAttribute("role", "option");
        button.tabIndex = -1;
        label.textContent = row.label;
        hint.textContent = row.hint || "";
        button.append(label, hint);
        button.addEventListener("click", () => run(i));
        return button;
      }),
    );
    const message = shown.length ? "" : emptyText();
    // Keep an existing live region outside the listbox. Only changed feedback
    // is written, so repeated no-result queries do not repeat announcements.
    if (emptyStatus.textContent !== message) emptyStatus.textContent = message;
    highlight();
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    // 229 also covers IME boundary keys when isComposing is already false.
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length)
        index =
          (index + (event.key === "ArrowDown" ? 1 : -1) + shown.length) %
          shown.length;
      highlight();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(index);
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  return {
    refresh() { if (dialog.open) render({ preserveSelection: true }); },
    open() {
      input.value = "";
      render();
      openDialog(dialog);
      input.focus();
    },
  };
}
