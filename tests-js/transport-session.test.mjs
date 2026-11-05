import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMediaSession } from "../src/audio_review_desk/static/media-session.js";
import { mountTransport } from "../src/audio_review_desk/static/transport.js";

// Exercise the real transport/session and selected workbench event bodies with
// queued media events. This is not native browser playback or listening QA.
function setup(t, { paused = false, time = 37.123456789, duration = 100, loop = false, bounds = [0, 100] } = {}) {
  const originals = new Map(["requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map(); let frameId = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  t.after(() => { for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const element = () => ({
    listeners: new Map(), attributes: {}, classes: new Set(), disabled: false,
    addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); },
    emit(type) { for (const callback of this.listeners.get(type) || []) callback({ type }); },
    setAttribute(key, value) { this.attributes[key] = value; },
    click() { if (!this.disabled) this.emit("click"); },
    get classList() { const values = this.classes; return { add: key => values.add(key), remove: key => values.delete(key), toggle(key, value) { value ? values.add(key) : values.delete(key); } }; },
  });
  const events = [], player = Object.assign(element(), {
    paused, currentTime: time, duration, readyState: 1, plays: 0, src: "A",
    getAttribute(name) { return this[name]; },
    pause() { if (!this.paused) { this.paused = true; events.push(() => this.emit("pause")); } },
    play() { this.paused = false; this.plays++; events.push(() => this.emit("play"), () => this.emit("playing")); return Promise.resolve(); },
    load() { this.currentTime = 0; this.duration = NaN; this.readyState = 0; this.paused = true; events.push(() => this.emit("emptied"), () => this.emit("timeupdate"), () => this.emit("loadstart")); },
    metadata(value = duration) { this.duration = value; this.readyState = 1; this.emit("loadedmetadata"); this.onloadedmetadata?.(); },
  });
  const button = element(), seek = element(), back = element(), forward = element(), volume = element();
  const loopInput = { checked: loop }, errors = [], times = [], warnings = [];
  let transport;
  const media = createMediaSession({ player, playbackRate: () => 1.25,
    onChange: () => { transport.refresh(); transport.render(); }, onError: error => errors.push(error) });
  transport = mountTransport({ player, media, button, seek, back, forward, volume, loop: loopInput,
    range: () => bounds, onTime: value => times.push(value), onError: error => errors.push(error),
    onRangeUnavailable: () => warnings.push("range"), labels: () => ({ play: "Play", pause: "Pause" }) });
  const flush = () => { let count = 0; while (events.length) { assert.ok(count++ < 100, "native event queue settles"); events.shift()(); } };
  const frame = now => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(now); };
  return { player, media, transport, button, seek, back, forward, volume, loopInput, errors, times, warnings, frames, flush, frame };
}

const workbench = readFileSync(new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
function switching(context) {
  const code = workbench.match(/async function switchVariant\(next\) \{[\s\S]*?\n\}\nfunction showImportError/)[0].replace(/\nfunction showImportError$/, "");
  const environment = { selected: { key: "clip", quality: { decoded: true, duration: 100 }, reference_quality: { duration: 10 } },
    variant: "a", player: context.player, media: context.media, audition: { cancel() {} },
    spectrumView: { setSource() {} }, $: id => id === "seek" ? context.seek : { value: "1.25" },
    renderDetails() {}, updateTime() {}, notice: error => context.errors.push(error), errorText: error => error, language: "en" };
  return Function(...Object.keys(environment), `${code}; return switchVariant;`)(...Object.values(environment));
}

test("actual rapid A/B switching keeps the playhead and a useful Pause button while loading", async (t) => {
  const context = setup(t), switchVariant = switching(context);
  await switchVariant("b"); context.flush();
  assert.equal(context.button.attributes["aria-label"], "Pause");
  assert.equal(context.media.currentTime, 37.123456789);
  assert.equal(context.times.at(-1), 37.123456789);
  assert.ok(context.button.classes.has("is-loading"));
  await switchVariant("a"); context.flush();
  context.player.metadata(100); context.flush();
  assert.equal(context.player.currentTime, 37.123456789);
  assert.equal(context.player.paused, false);
  assert.equal(context.frames.size, 1);
  assert.deepEqual(context.errors, []);
});

test("one explicit button pause during loading survives metadata and later native events", async (t) => {
  const context = setup(t), switchVariant = switching(context);
  await switchVariant("b"); context.flush();
  context.button.click();
  assert.equal(context.button.attributes["aria-label"], "Play");
  assert.equal(context.button.classes.has("is-loading"), false);
  context.player.metadata(10); context.flush();
  assert.equal(context.player.paused, true);
  assert.equal(context.player.plays, 0);
  assert.equal(context.player.currentTime, 10);
});

test("Space shares the button intent path rather than resuming an obsolete closure", async (t) => {
  const context = setup(t), switchVariant = switching(context);
  await switchVariant("b"); context.flush();
  const source = workbench.match(/  if \(event.code === "Space"\) \{[\s\S]*?\n  \}\n  if \(event.key/)[0].replace(/\n  if \(event.key$/, "");
  const invoke = Function("event", "selected", "$", "player", "media", "range", "notice", "errorText", "language", source);
  const event = { code: "Space", target: { closest: () => null }, preventDefault() {} };
  invoke(event, { quality: { decoded: true } }, id => id === "play" ? context.button : context.loopInput,
    context.player, context.media, () => [0, 100], () => {}, error => error, "en");
  context.player.metadata(10); context.flush();
  assert.equal(context.player.paused, true);
  assert.equal(context.player.plays, 0);
});

test("transport skip and scrub update pending positions without losing original resume intent", (t) => {
  const context = setup(t);
  context.media.load({ url: "B", key: "clip", duration: 100 }); context.flush();
  context.back.click();
  assert.equal(context.media.currentTime, 32.123456789);
  context.forward.click();
  context.seek.emit("pointerdown");
  context.seek.value = "61.23456789"; context.seek.emit("input"); context.seek.emit("pointerup");
  context.player.metadata(100); context.flush();
  assert.equal(context.player.currentTime, 61.23456789);
  assert.equal(context.player.paused, false);
  assert.equal(context.frames.size, 1);
});

test("loop correction cannot synchronously reenter or create duplicate animation chains", (t) => {
  const context = setup(t, { time: 0, duration: 100, loop: true, bounds: [20, 30] });
  context.transport.render();
  assert.equal(context.player.currentTime, 20);
  assert.equal(context.frames.size, 1);
  for (let count = 1; count <= 20; count++) {
    context.player.currentTime = 30;
    context.frame(count * 16);
    assert.equal(context.player.currentTime, 20);
    assert.equal(context.frames.size, 1);
  }
  context.media.pause(); context.flush();
  assert.equal(context.frames.size, 0);
});

test("a short reference outside the selected loop pauses once with a specific warning", (t) => {
  const context = setup(t, { time: 0, duration: 10, loop: true, bounds: [20, 30] });
  context.transport.render(); context.flush();
  assert.equal(context.player.paused, true);
  assert.equal(context.frames.size, 0);
  assert.equal(context.warnings.length, 1);
  context.button.click(); context.flush();
  assert.equal(context.player.plays, 0);
  assert.equal(context.warnings.length, 2);
  context.loopInput.checked = false;
  context.button.click(); context.flush();
  assert.equal(context.player.paused, false);
  assert.equal(context.frames.size, 1);
});

test("a partially covered reference loops only the playable part", (t) => {
  const context = setup(t, { time: 10, duration: 10, loop: true, bounds: [5, 20] });
  context.transport.render();
  assert.equal(context.player.currentTime, 5);
  assert.equal(context.frames.size, 1);
  assert.equal(context.warnings.length, 0);
});

test("old ended events during loading do not override an explicit pause", (t) => {
  const context = setup(t, { loop: true });
  context.media.load({ url: "B", key: "clip", duration: 100 });
  context.media.pause(); context.player.emit("ended");
  context.player.metadata(100); context.flush();
  assert.equal(context.player.paused, true);
  assert.equal(context.player.plays, 0);
});
