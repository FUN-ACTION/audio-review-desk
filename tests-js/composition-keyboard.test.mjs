import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

// Execute production handlers with action/DOM doubles, not a browser or OS IME.
// Override the source root to run the same assertions against a restored baseline.
const root = process.env.ARD_COMPOSITION_SOURCE_ROOT;
const { mountMarkers } = await import(root
  ? pathToFileURL(resolve(root, "src/audio_review_desk/static/markers.js"))
  : new URL("../src/audio_review_desk/static/markers.js", import.meta.url));
function extractHandler(file, registration) {
  const source = readFileSync(root
    ? resolve(root, "src/audio_review_desk/static", file)
    : new URL(`../src/audio_review_desk/static/${file}`, import.meta.url), "utf8");
  const start = source.indexOf(registration);
  assert.ok(start >= 0, `${file}: missing registration`);
  assert.equal(source.indexOf(registration, start + registration.length), -1, "registration must be unique");
  const indent = registration.match(/^ */)[0];
  const end = source.indexOf(`\n${indent}});`, start);
  assert.ok(end > start, `${file}: missing handler boundary`);
  return source.slice(source.indexOf("(event) => {", start), end) + "\n}";
}
const registrations = {
  commands: ["commands.js", '  input.addEventListener("keydown", (event) => {'],
  global: ["workbench.js", 'document.addEventListener("keydown", (event) => {'],
  settings: ["workbench.js", '$("settingsPanel").addEventListener("keydown", (event) => {'],
  note: ["tour/studio.js", '  noteInput.addEventListener("keydown", (event) => {'],
};
const cases = [
  ["command Enter", "commands", "Enter", {}, ["preventDefault", "run"]],
  ["command ArrowDown", "commands", "ArrowDown", {}, ["preventDefault", "highlight"]],
  ["command ArrowUp", "commands", "ArrowUp", {}, ["preventDefault", "highlight"]],
  ...["ctrlKey", "metaKey"].flatMap(modifier => [
    [`${modifier} Enter`, "global", "Enter", { [modifier]: true }, ["preventDefault", "save"]],
    [`${modifier} K`, "global", "k", { [modifier]: true }, ["preventDefault", "commandMenu.open"]],
  ]),
  ["sample note Escape", "note", "Escape", {}, ["preventDefault", "paint", "focus"]],
  ["settings Escape", "settings", "Escape", {}, ["preventDefault", "closeSettings", "focus"]],
];
function harness(kind) {
  const calls = [], args = [];
  const action = name => (...values) => { calls.push(name); args.push([name, values]); };
  const node = { open: false, focus: action("focus"), close: action("close") };
  const editing = { text: "候选文字", time: "1.25" };
  const context = vm.createContext({
    index: 0, shown: [{}, {}, {}], editing, noteVisible: true,
    run: action("run"), highlight: action("highlight"), append: action("append"),
    commit: action("commit"), render: action("render"), onChange: action("onChange"),
    list: { querySelectorAll: () => [node] }, $: () => node,
    commandMenu: { open: action("commandMenu.open") }, save: action("save"), paint: action("paint"), closeSettings: action("closeSettings"),
  });
  const handler = vm.runInContext(`(${extractHandler(...registrations[kind])})`, context);
  function keydown(key, flags) {
    handler({ key, ctrlKey: false, metaKey: false,
      target: { closest: () => ({}) },
      preventDefault: action("preventDefault"), stopPropagation: action("stopPropagation"), ...flags });
  }
  return { calls, args, context, editing, keydown };
}
test("settings respects an already handled Escape and ignores unrelated keys", () => {
  const h = harness("settings");
  h.keydown("Escape", { defaultPrevented: true });
  h.keydown("Enter", {});
  assert.deepEqual(h.calls, []);
  h.keydown("Escape", {});
  assert.deepEqual(h.calls, ["preventDefault", "closeSettings", "focus"]);
});
for (const [name, kind, key, modifiers, expected] of cases) {
  for (const [mode, flags] of [
    ["active composition", { isComposing: true, keyCode: 13 }],
    ["legacy boundary 229", { isComposing: false, keyCode: 229 }],
  ]) {
    test(`${name}: ignores ${mode}, then ordinary key works immediately`, () => {
      const h = harness(kind);
      h.keydown(key, { ...modifiers, ...flags });
      assert.deepEqual(h.calls, [], "IME key must not invoke actions or prevent its default behavior");
      assert.equal(h.context.index, 0);
      assert.equal(h.context.editing, h.editing);
      assert.equal(h.editing.text, "候选文字");
      assert.equal(h.context.noteVisible, true);
      h.keydown(key, { ...modifiers, isComposing: false, keyCode: key === "Enter" ? 13 : 0 });
      assert.deepEqual(h.calls, expected);
      if (key === "ArrowDown") assert.equal(h.context.index, 1);
      if (key === "ArrowUp") assert.equal(h.context.index, 2);
      if (kind === "commands" && key === "Enter") assert.deepEqual(h.args.at(-1), ["run", [0]]);
      if (kind === "note") assert.equal(h.context.noteVisible, false);
      if (kind === "global" && key === "Enter") assert.deepEqual(h.args.at(-1), ["save", [false]]);
    });
  }
}

// Marker handlers depend on their mounted editor's private identity state.
// Exercise the whole production module instead of guessing those closure values.
function markerHarness(t, kind) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = { activeElement: null };
  class Element {
    constructor() { this.children = []; this.className = ""; this.listeners = new Map(); this.value = ""; this.style = {}; }
    get classList() { return { contains: name => this.className.split(" ").includes(name), add: name => { this.className += ` ${name}`; } }; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    replaceChildren(...nodes) {
      if (this.children.some(child => child.contains(document.activeElement))) document.activeElement = document.body;
      for (const child of this.children) child.parent = null;
      this.children = []; this.append(...nodes);
    }
    matches(selector) { return selector.startsWith(".") && this.classList.contains(selector.slice(1)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    setAttribute() {}
    addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
    emit(type, event = {}) { for (const handler of this.listeners.get(type) || []) handler({ target: this, ...event }); }
    click() { if (!this.disabled) this.emit("click"); }
    focus() { document.activeElement = this; }
  }
  document.body = new Element(); document.activeElement = document.body; document.createElement = () => new Element();
  globalThis.document = document;
  t.after(() => previous ? Object.defineProperty(globalThis, "document", previous) : delete globalThis.document);
  const input = new Element(), add = new Element(), list = new Element(), ticks = new Element();
  document.body.append(input, add, list, ticks);
  let changes = 0;
  const errors = [], original = [{ time: 1.25, text: "原文字" }];
  const control = mountMarkers({ input, add, list, ticks, player: { currentTime: 2.5 }, duration: () => 10,
    t: key => key, onChange: () => changes++, onError: error => errors.push(error) });
  control.set(original, false);
  if (kind === "edit") list.querySelector(".marker-note").click();
  const field = kind === "add" ? input : list.querySelector(".marker-edit-text");
  field.value = "候选文字"; field.emit("input"); field.focus();
  const keydown = (key, flags) => {
    const calls = [];
    field.emit("keydown", { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      preventDefault: () => calls.push("preventDefault"), stopPropagation: () => calls.push("stopPropagation"), ...flags });
    return calls;
  };
  return { control, field, input, list, document, errors, original, keydown, changes: () => changes };
}
for (const [name, kind, key] of [["marker add Enter", "add", "Enter"],
  ["marker edit Enter", "edit", "Enter"], ["marker edit Escape", "edit", "Escape"]]) {
  for (const [mode, flags] of [["active composition", { isComposing: true, keyCode: 13 }],
    ["legacy boundary 229", { isComposing: false, keyCode: 229 }]]) {
    test(`${name}: ignores ${mode}, then ordinary key works immediately`, t => {
      const h = markerHarness(t, kind), before = h.control.snapshot(), changes = h.changes();
      assert.deepEqual(h.keydown(key, flags), [], "IME key must not prevent default or stop propagation");
      assert.deepEqual(h.control.snapshot(), before, "IME key must not append, commit, cancel or normalize the editor");
      assert.equal(h.field.value, "候选文字"); assert.equal(h.document.activeElement, h.field);
      assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
      const calls = h.keydown(key, { isComposing: false, keyCode: key === "Enter" ? 13 : 0 });
      assert.deepEqual(calls, key === "Escape" ? ["preventDefault", "stopPropagation"] : ["preventDefault"]);
      assert.equal(h.changes(), changes + 1, "ordinary key performs its action exactly once");
      assert.equal(h.control.snapshot().editing, null);
      if (kind === "add") {
        assert.deepEqual(h.control.get(), [...h.original, { time: 2.5, text: "候选文字" }]);
        assert.equal(h.input.value, ""); assert.equal(h.document.activeElement, h.input);
      } else {
        assert.deepEqual(h.control.get(), key === "Enter" ? [{ time: 1.25, text: "候选文字" }] : h.original);
        assert.equal(h.list.querySelector(".marker-edit-text"), null, "the ordinary action redraws the committed/cancelled row");
        assert.equal(h.document.activeElement, h.list.querySelector(".marker-note"));
      }
      assert.deepEqual(h.errors, []);
    });
  }
}
