import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Mount the actual controls and workbench wiring with deterministic DOM/media
// doubles. This checks focus targets and audition ownership, not browser or AT.
const root = process.env.ARD_MARKER_SOURCE_ROOT;
const source = name => root
  ? pathToFileURL(resolve(root, "src/audio_review_desk/static", name))
  : new URL(`../src/audio_review_desk/static/${name}`, import.meta.url);
const { mountMarkers } = await import(source("markers.js"));
const { createAudition } = await import(source("audition.js"));
const workbench = readFileSync(source("workbench.js"), "utf8");

function setup(t, rows = [{ time: 1, text: "first" }, { time: 5, text: "middle" }, { time: 10, text: "last" }]) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { activeElement: null };
  class Element {
    constructor() { this.children = []; this.className = ""; this.listeners = new Map(); this.attributes = {}; this.style = {}; this.value = ""; }
    get classList() { return { contains: key => this.className.split(" ").includes(key), add: key => { this.className += ` ${key}`; } }; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) {
      if (this.children.some(node => node.contains(doc.activeElement))) doc.activeElement = doc.body;
      for (const child of this.children) child.parent = null;
      this.children = []; this.append(...nodes);
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.startsWith(".") && this.classList.contains(selector.slice(1)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    emit(type, values = {}) { for (const fn of this.listeners.get(type) || []) fn({ target: this, ...values }); }
    click() { if (!this.disabled) this.emit("click"); }
    focus() { doc.activeElement = this; }
  }
  doc.body = new Element(); doc.activeElement = doc.body; doc.createElement = () => new Element();
  globalThis.document = doc;
  t.after(() => previous ? Object.defineProperty(globalThis, "document", previous) : delete globalThis.document);
  const nodes = Object.fromEntries(["markerText", "addMarker", "markerList", "markerTicks"].map(id => [id, new Element()]));
  doc.body.append(...Object.values(nodes));
  const player = new EventTarget();
  Object.assign(player, { currentTime: 0, duration: 20, src: "A", readyState: 1, paused: true, plays: 0 });
  player.play = () => { player.paused = false; player.plays++; return Promise.resolve(); };
  player.pause = () => { player.paused = true; player.dispatchEvent(new Event("pause")); };
  const loop = { checked: true }, errors = [], states = [];
  const audition = createAudition({ player, loop, onChange: state => states.push(state), onError: error => errors.push(error) });
  // The real session notifies transport synchronously on a seek, which in turn
  // calls audition.check through updateTime. Preserve that ordering here.
  const media = { get currentTime() { return player.currentTime; }, set currentTime(value) { player.currentTime = value; audition.check(value); } };
  const start = workbench.indexOf("markersView = mountMarkers({");
  const end = workbench.indexOf("\nconst commandMenu", start);
  assert.ok(start >= 0 && end > start);
  const code = workbench.slice(start, end).replace("markersView =", "return");
  let changes = 0;
  const environment = { mountMarkers, $: id => nodes[id], media, audition,
    selected: { quality: { duration: 20 } }, t: key => key,
    markDirty: () => changes++, notice: error => errors.push(error) };
  const control = Function(...Object.keys(environment), code)(...Object.values(environment));
  control.set(rows, false); control.view(0, 20);
  const removeAt = index => nodes.markerList.children[index].children.at(-1);
  t.after(() => audition.dispose());
  return { control, nodes, player, loop, states, audition, errors, doc, removeAt, changes: () => changes };
}

for (const route of ["timestamp", "tick"]) {
  test(`${route} seeking ends one-shot ownership before updating playback position`, t => {
    const h = setup(t);
    h.audition.start([0, 2], "start");
    (route === "timestamp" ? h.nodes.markerList.children[2].children[0] : h.nodes.markerTicks.children[2]).click();
    assert.equal(h.player.currentTime, 10);
    assert.equal(h.player.paused, false, "manual note navigation must not be stopped by the old audition window");
    assert.equal(h.player.plays, 1);
    assert.equal(h.loop.checked, true);
    assert.deepEqual(h.states, ["start", null]);
    assert.equal(h.changes(), 0);
    assert.deepEqual(h.errors, []);
  });
}

test("ordinary note seeking stays paused and does not change review data or loop choice", t => {
  const h = setup(t); h.loop.checked = false;
  const before = h.control.get();
  h.nodes.markerList.children[1].children[0].click();
  h.nodes.markerTicks.children[2].click();
  assert.equal(h.player.currentTime, 10);
  assert.equal(h.player.paused, true); assert.equal(h.player.plays, 0);
  assert.equal(h.loop.checked, false); assert.equal(h.changes(), 0);
  assert.deepEqual(h.control.get(), before);
});

for (const [name, index, remainingIndex] of [["first", 0, 0], ["middle", 1, 1], ["last", 2, 1]]) {
  test(`deleting the ${name} note keeps focus on the adjacent remove control`, t => {
    const h = setup(t), remove = h.removeAt(index);
    remove.focus(); remove.click();
    assert.equal(h.control.get().length, 2); assert.equal(h.changes(), 1);
    assert.ok(h.doc.activeElement === h.removeAt(remainingIndex), "focus follows the adjacent remove control");
  });
}

test("deleting the only note returns focus to the add-note input", t => {
  const h = setup(t, [{ time: 1, text: "only" }]);
  h.removeAt(0).focus(); h.removeAt(0).click();
  assert.deepEqual(h.control.get(), []);
  assert.ok(h.doc.activeElement === h.nodes.markerText, "focus returns to the add-note input");
});

test("programmatic removal never takes focus from an unrelated control", t => {
  const h = setup(t);
  h.nodes.markerText.focus(); h.removeAt(1).click();
  assert.ok(h.doc.activeElement === h.nodes.markerText, "unrelated focus stays put");
  assert.equal(h.control.get().length, 2);
});

test("removal after a pending time edit uses the updated order for its focus target", t => {
  const h = setup(t);
  h.nodes.markerList.children[0].children[1].click();
  const time = h.nodes.markerList.querySelector(".marker-edit-time");
  time.value = "15"; time.emit("input");
  const remove = h.removeAt(1); remove.focus(); remove.click();
  assert.deepEqual(h.control.get().map(row => row.time), [10, 15]);
  assert.ok(h.doc.activeElement === h.removeAt(0), "focus uses the updated row order");
});

for (const fieldClass of ["marker-edit-time", "marker-edit-text"]) {
  test(`invalid ${fieldClass} blocks deletion and retains validation focus`, t => {
    const h = setup(t), before = h.control.get();
    h.nodes.markerList.children[0].children[1].click();
    const field = h.nodes.markerList.querySelector(`.${fieldClass}`);
    field.value = ""; field.emit("input");
    const remove = h.removeAt(1); remove.focus(); remove.click();
    assert.deepEqual(h.control.get(), before);
    assert.equal(h.errors.length, 1);
    assert.ok(h.doc.activeElement === field, "invalid editor keeps focus instead of the deletion target");
    assert.equal(h.changes(), 1, "only the attempted edit marks a change");
  });
}
