import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Actual workbench keyboard and click handlers with synchronous native-hide
// blur modeled. No browser rendering or assistive-technology claims.
const source = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/audio_review_desk/static/workbench.css", import.meta.url), "utf8");
const sections = ["library", "review-pane", "review-progress", "summary-bar"];
const extract = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
};
function setup({ section = "library", selected = true, focused = false } = {}) {
  const nodes = new Map(), frames = [], focusCalls = [], handlers = new Map(), classes = new Set(focused ? ["focus-mode"] : []);
  const document = { activeElement: null, body: {} };
  const element = (id, section = null) => ({ id, section, open: false, attributes: {}, listeners: new Map(),
    closest(selector) { return section && selector.split(",").map(value => value.trim()).includes(`.${section}`) ? this : null; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    click() { this.listeners.get("click")?.({ detail: 0 }); },
    focus(options) { document.activeElement = this; focusCalls.push({ id, options }); },
  });
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); };
  const origin = element("origin", section); document.activeElement = origin;
  document.body.classList = { toggle(key) {
    const enabled = !classes.has(key); enabled ? classes.add(key) : classes.delete(key);
    if (enabled && key === "focus-mode" && sections.includes(document.activeElement?.section)) document.activeElement = document.body;
    return enabled;
  }, contains: key => classes.has(key) };
  document.addEventListener = (type, fn) => handlers.set(type, fn);
  const noop = () => {};
  const env = { $, document, requestAnimationFrame: fn => frames.push(fn), drawWave: noop, syncGlider: noop,
    busy: false, selected: selected ? { quality: { decoded: true } } : null };
  Function(...Object.keys(env), extract('$("focusMode").addEventListener("click"', 'for (const id of ["openHelp"') +
    extract('document.addEventListener("keydown", (event) => {', 'let theme ='))(...Object.values(env));
  return { $, document, origin, focusCalls, frames, classes,
    key(patch = {}) { const event = { key: "f", code: "KeyF", target: origin, preventDefault() { this.prevented = true; }, ...patch }; handlers.get("keydown")(event); return event; },
    pointer({ nativeFocus = true } = {}) { if (nativeFocus) document.activeElement = $("focusMode"); $("focusMode").listeners.get("click")({ detail: 1 }); },
  };
}

for (const section of sections) test(`keyboard entry recovers focus when ${section} is hidden`, () => {
  const h = setup({ section }); h.key();
  assert.equal(h.document.activeElement, h.$("focusMode"));
  assert.deepEqual(h.focusCalls, [{ id: "focusMode", options: { preventScroll: true } }]);
  assert.equal(h.$("focusMode").attributes["aria-pressed"], "true");
  h.frames.forEach(fn => fn()); assert.equal(h.focusCalls.length, 1);
});

test("hidden-section list matches focus-mode CSS", () => {
  const rule = css.match(/\.focus-mode \.library,[\s\S]*?\{\s*display: none;/)?.[0];
  assert.ok(rule); for (const section of sections) assert.ok(rule.includes(`.focus-mode .${section}`));
});

test("keyboard entry preserves focus in visible audio controls", () => {
  const h = setup({ section: "audioSection" }); h.key();
  assert.equal(h.document.activeElement, h.origin); assert.equal(h.focusCalls.length, 0);
});

test("keyboard entry works without a selected clip", () => {
  const h = setup({ selected: false }); h.key(); assert.equal(h.document.activeElement, h.$("focusMode"));
});

for (const section of ["library", "audioSection"]) test(`exit never redirects focus from ${section}`, () => {
  const h = setup({ focused: true, section }); h.key();
  assert.equal(h.classes.has("focus-mode"), false); assert.equal(h.document.activeElement, h.origin);
  assert.equal(h.focusCalls.length, 0);
});

for (const nativeFocus of [true, false]) test(`pointer entry adds no programmatic focus handoff (nativeFocus=${nativeFocus})`, () => {
  const h = setup(); h.pointer({ nativeFocus });
  assert.equal(h.classes.has("focus-mode"), true); assert.equal(h.focusCalls.length, 0);
  assert.equal(h.document.activeElement, nativeFocus ? h.$("focusMode") : h.document.body);
});

for (const patch of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
  test(`shortcut guard preserves focus for ${JSON.stringify(patch)}`, () => {
    const h = setup(); h.key(patch); assert.equal(h.classes.has("focus-mode"), false);
    assert.equal(h.document.activeElement, h.origin); assert.equal(h.focusCalls.length, 0);
  });
}

test("existing Shift+F shortcut retains keyboard focus recovery", () => {
  const h = setup(); h.key({ key: "F", shiftKey: true });
  assert.equal(h.document.activeElement, h.$("focusMode")); assert.equal(h.classes.has("focus-mode"), true);
});

test("pointer exit leaves native button focus untouched", () => {
  const h = setup({ focused: true }); h.pointer();
  assert.equal(h.classes.has("focus-mode"), false); assert.equal(h.document.activeElement, h.$("focusMode"));
  assert.equal(h.focusCalls.length, 0);
});
