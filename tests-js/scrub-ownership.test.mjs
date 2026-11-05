import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Set SCRUB_SOURCE_ROOT to an exact restored repository for negative controls.
// These are deterministic event simulations, not native-browser acceptance.
const root = process.env.SCRUB_SOURCE_ROOT
  ? pathToFileURL(resolve(process.env.SCRUB_SOURCE_ROOT) + "/")
  : new URL("../", import.meta.url);
const source = name => new URL(`src/audio_review_desk/static/${name}`, root);
const { createMediaSession } = await import(source("media-session.js"));
const { mountTransport } = await import(source("transport.js"));

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
    range: () => bounds, onTime: value => { times.push(value); seek.value = String(value); }, onError: error => errors.push(error),
    onRangeUnavailable: () => warnings.push("range"), labels: () => ({ play: "Play", pause: "Pause" }) });
  const flush = () => { let count = 0; while (events.length) { assert.ok(count++ < 100, "native event queue settles"); events.shift()(); } };
  const frame = now => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(now); };
  return { player, media, transport, button, seek, back, forward, volume, loopInput, errors, times, warnings, frames, flush, frame };
}


const workbench = readFileSync(source("workbench.js"), "utf8");
function refreshedSelection(context) {
  const match = workbench.match(/async function select\(item,[\s\S]*?\n}\nfunction revealQueueSelection/);
  assert.ok(match, "exercise the actual workbench selection body");
  const code = match[0].replace(/\nfunction revealQueueSelection$/, "");
  const noop = () => {};
  const environment = {
    busy: false, refreshGeneration: 7, dirty: false,
    audition: { cancel: noop }, rememberPosition: noop,
    waveformReader: { cancel: noop, load: async () => true }, generation: 0,
    invalidateHistory: noop, $: id => id === "seek" ? context.seek : {},
    media: context.media, player: context.player, selected: null,
    sessionStorage: { setItem: noop }, state: { workspace: "scrub-test" },
    matchMedia: () => ({ matches: false }), updateLibraryToggle: noop,
    variant: "a", wave: {}, waveStatus: null, waveNotice: null,
    spectrumView: { setSource: noop }, waveformView: { cancelDrag() {}, reset: noop },
    notice: noop, renderQueue: noop, renderDetails: noop,
    listeningMemory: null, resumedTime: () => 12,
  };
  const select = Function(...Object.keys(environment), `${code}; return select;`)(...Object.values(environment));
  return () => select({ key: "replacement", label: "Replacement", quality: { decoded: true, duration: 100 } },
    { refreshTurn: 7, revealQueue: false });
}
function input(context, value) {
  context.seek.value = String(value);
  context.seek.emit("input");
}
function terminate(context) {
  context.seek.emit("change");
  context.seek.emit("pointerup");
  context.seek.emit("pointercancel");
  context.flush();
}

for (const metadataFirst of [true, false]) {
  test(`actual refresh selection owns playback after interrupted scrub; metadata ${metadataFirst ? "before" : "after"} release`, async t => {
    const c = setup(t);
    c.seek.emit("pointerdown"); input(c, 54);
    await refreshedSelection(c)(); c.flush();
    if (metadataFirst) { c.player.metadata(); c.flush(); }
    assert.equal(c.media.currentTime, 12);
    input(c, 81);
    assert.equal(c.media.currentTime, 12, "old drag cannot seek the replacement source");
    assert.equal(Number(c.seek.value), 12, "stale native range value is repainted from source time");
    assert.equal(c.times.at(-1), 12);
    terminate(c);
    assert.equal(Number(c.seek.value), 12, "release preserves the replacement playhead display");
    if (!metadataFirst) { c.player.metadata(); c.flush(); }
    assert.equal(c.player.src, "/media/replacement/a.wav");
    assert.equal(c.player.currentTime, 12);
    assert.equal(c.player.paused, true, "old release cannot autoplay replacement");
    assert.equal(c.player.plays, 0);
    assert.equal(c.frames.size, 0, "paused replacement creates no animation chain");
    assert.deepEqual(c.errors, []);
  });
}

test("same-key source replacement revokes the old drag, not only selection changes", t => {
  const c = setup(t);
  c.seek.emit("pointerdown"); input(c, 45);
  c.media.load({ url: "reference", key: "clip", duration: 100 });
  input(c, 90);
  assert.equal(c.media.currentTime, 45);
  terminate(c); c.player.metadata(); c.flush();
  assert.equal(c.player.paused, true);
  assert.equal(c.player.currentTime, 45);
  assert.equal(c.player.plays, 0);
});

test("a later explicit pause revokes old input and resume even when already paused", t => {
  const c = setup(t);
  c.seek.emit("pointerdown"); input(c, 40);
  c.media.pause(); input(c, 80); terminate(c);
  assert.equal(c.player.currentTime, 40);
  assert.equal(c.player.paused, true);
  assert.equal(c.player.plays, 0);
});

test("later button play then pause wins over the original scrub resume", t => {
  const c = setup(t);
  c.seek.emit("pointerdown"); input(c, 40);
  c.button.click(); c.flush(); c.button.click(); c.flush();
  input(c, 80); terminate(c);
  assert.equal(c.player.currentTime, 40);
  assert.equal(c.player.paused, true);
  assert.equal(c.player.plays, 1);
});

test("a later explicit play is not duplicated by an old gesture finish", t => {
  const c = setup(t);
  c.seek.emit("pointerdown"); input(c, 40);
  c.button.click(); c.flush(); input(c, 80); terminate(c);
  assert.equal(c.player.currentTime, 40);
  assert.equal(c.player.paused, false);
  assert.equal(c.player.plays, 1);
  assert.equal(c.frames.size, 1, "explicit play retains exactly one animation chain");
  assert.equal(Number(c.seek.value), 40);
});

for (const paused of [false, true]) {
  test(`normal ${paused ? "paused" : "playing"} scrub preserves its intent and terminates once`, t => {
    const c = setup(t, { paused });
    c.seek.emit("pointerdown"); input(c, 61.23456789); c.flush();
    terminate(c);
    assert.equal(c.player.currentTime, 61.23456789);
    assert.equal(c.player.paused, paused);
    assert.equal(c.player.plays, paused ? 0 : 1);
    assert.equal(c.frames.size, paused ? 0 : 1);
  });
}

for (const metadataFirst of [true, false]) {
  test(`scrub begun during pending A/B load survives old queued events and metadata ${metadataFirst ? "before" : "after"} release`, t => {
    const c = setup(t);
    c.media.load({ url: "reference", key: "clip", duration: 100 });
    c.seek.emit("pointerdown");
    c.flush(); // Delayed pause/emptied/timeupdate/loadstart predate this gesture.
    input(c, 61.23456789);
    if (metadataFirst) { c.player.metadata(); c.flush(); }
    terminate(c);
    if (!metadataFirst) { c.player.metadata(); c.flush(); }
    assert.equal(c.player.currentTime, 61.23456789);
    assert.equal(c.player.paused, false);
    assert.equal(c.player.plays, 1);
    assert.equal(c.frames.size, 1);
  });
}

test("a fresh gesture after interruption can seek and resume the new source", t => {
  const c = setup(t);
  c.seek.emit("pointerdown");
  c.media.load({ url: "replacement", key: "new", time: 12, resume: false, duration: 100 });
  c.player.metadata(); c.flush(); terminate(c);
  c.button.click(); c.flush();
  c.seek.emit("pointerdown"); input(c, 24); terminate(c);
  assert.equal(c.player.currentTime, 24);
  assert.equal(c.player.paused, false);
  assert.equal(c.player.plays, 2);
});

for (const interruption of ["cancel", "error"]) {
  test(`${interruption} revokes the gesture without accepting stale input`, t => {
    const c = setup(t);
    c.seek.emit("pointerdown"); input(c, 40);
    if (interruption === "cancel") c.media.cancel();
    else c.player.emit("error");
    input(c, 80); terminate(c);
    assert.equal(c.player.currentTime, 40);
    assert.equal(c.player.paused, true);
    assert.equal(c.player.plays, 0);
  });
}

test("keyboard-style seek input without a pointer gesture remains available", t => {
  const c = setup(t, { paused: true });
  input(c, 26); c.seek.emit("change"); c.flush();
  assert.equal(c.player.currentTime, 26);
  assert.equal(c.player.paused, true);
  assert.equal(c.player.plays, 0);
});

for (const metadataFirst of [true, false]) {
  test(`old release alone cannot autoplay a replacement; metadata ${metadataFirst ? "before" : "after"} release`, async t => {
    const c = setup(t);
    c.seek.emit("pointerdown");
    await refreshedSelection(c)(); c.flush();
    if (metadataFirst) { c.player.metadata(); c.flush(); }
    terminate(c);
    if (!metadataFirst) { c.player.metadata(); c.flush(); }
    assert.equal(c.player.paused, true);
    assert.equal(c.player.plays, 0);
    assert.equal(c.player.currentTime, 12);
  });
}
