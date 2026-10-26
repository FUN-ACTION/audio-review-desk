import { openDialog } from "./motion.js";
export function findCommands(rows, query) {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return rows
    .filter((row) =>
      terms.every((term) =>
        `${row.label} ${row.search || ""}`
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(term),
      ),
    )
    .slice(0, 16);
}
export function mountCommands({
  dialog,
  input,
  list,
  rows,
  emptyText,
  onError,
}) {
  let shown = [],
    index = 0;
  const highlight = () => {
    [...list.children].forEach((row, i) =>
      row.setAttribute("aria-selected", String(i === index)),
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
  const render = () => {
    shown = findCommands(rows(), input.value);
    index = 0;
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
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "command-empty";
      p.textContent = emptyText();
      list.append(p);
    }
    highlight();
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
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
    open() {
      input.value = "";
      render();
      openDialog(dialog);
      input.focus();
    },
  };
}
