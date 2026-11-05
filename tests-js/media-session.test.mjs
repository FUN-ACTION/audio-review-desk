import test from "node:test";
import assert from "node:assert/strict";
import { createMediaSession } from "../src/audio_review_desk/static/media-session.js";

// Deterministic media-event doubles, not a browser or audio-device assessment.
function setup({ paused = false, time = 37.123456789, duration = 90 } = {}) {
  const listeners = new Map();
  const player = {
    paused, currentTime: time, duration, playbackRate: 1,
    onloadedmetadata: null, plays: 0, loads: 0,
    addEventListener(type, callback) { listeners.set(type, callback); },
    pause() { this.paused = true; },
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    load() { this.loads++; this.currentTime = 0; this.duration = NaN; },
    metadata(value = 90) { this.duration = value; this.onloadedmetadata?.(); },
    error() { listeners.get("error")(); },
  };
  const errors = [];
  let changes = 0;
  let rate = 1.25;
  const session = createMediaSession({
    player, playbackRate: () => rate,
    onChange: () => changes++, onError: (error) => errors.push(error),
  });
  return { player, session, errors, changes: () => changes, rate: (v) => rate = v };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const deferred = () => {
  let reject;
  const promise = new Promise((_, fail) => { reject = fail; });
  return { promise, reject };
};

for (const paused of [false, true]) {
  test(`rapid same-clip source switches preserve exact time and ${paused ? "paused" : "playing"} intent`, () => {
    const { session, player } = setup({ paused });
    session.load({ url: "B", key: "clip", duration: 20 });
    assert.equal(session.currentTime, 37.123456789);
    assert.equal(session.duration, 20);
    assert.equal(session.paused, paused);
    session.load({ url: "A", key: "clip", duration: 90 });
    player.metadata();
    assert.equal(player.currentTime, 37.123456789);
    assert.equal(player.paused, paused);
    assert.equal(player.playbackRate, 1.25);
    assert.equal(session.pending, false);
    assert.equal(player.onloadedmetadata, null);
  });
}
test("remembered selection position survives an immediate source switch", () => {
  const { session, player } = setup();
  session.load({ url: "A", key: "new", time: 41.123456789, resume: false });
  session.load({ url: "B", key: "new" });
  player.metadata();
  assert.equal(player.currentTime, 41.123456789);
  assert.equal(player.paused, true);
});
test("explicit pause while loading prevents auto resume and immediately notifies", () => {
  const { session, player, changes } = setup();
  session.load({ url: "B", key: "clip" });
  const before = changes();
  session.pause();
  assert.equal(changes(), before + 1);
  assert.equal(session.paused, true);
  player.metadata();
  assert.equal(player.plays, 0);
});
test("explicit play while loading changes intent without playing an unready source", async () => {
  const { session, player, changes } = setup({ paused: true });
  session.load({ url: "B", key: "clip" });
  const before = changes();
  await session.play();
  assert.equal(changes(), before + 1);
  assert.equal(session.paused, false);
  assert.equal(player.plays, 0);
  player.metadata();
  assert.equal(player.plays, 1);
});
test("pending seek is exact across switches and clamps only to actual metadata", () => {
  const { session, player } = setup();
  session.load({ url: "B", key: "clip", duration: 10 });
  session.currentTime = 52.987654321;
  assert.equal(player.currentTime, 0);
  session.load({ url: "A", key: "clip", duration: 90 });
  assert.equal(session.currentTime, 52.987654321);
  player.metadata(40.012345678);
  assert.equal(player.currentTime, 40.012345678);
});
test("new clip does not inherit pending intent; cancel disables old metadata callbacks", () => {
  const { session, player, changes } = setup();
  session.load({ url: "B", key: "clip" });
  const old = player.onloadedmetadata;
  session.load({ url: "C", key: "other" });
  assert.equal(session.currentTime, 0);
  assert.equal(session.paused, true);
  old();
  assert.equal(session.pending, true);
  const next = player.onloadedmetadata;
  const before = changes();
  session.cancel();
  assert.equal(changes(), before);
  next();
  assert.equal(session.pending, false);
  assert.equal(player.onloadedmetadata, null);
  assert.equal(player.plays, 0);
});
test("cancel preserves a metadata callback installed by someone else", () => {
  const { session, player } = setup();
  session.load({ url: "B", key: "clip" });
  const external = () => {};
  player.onloadedmetadata = external;
  session.cancel();
  assert.equal(player.onloadedmetadata, external);
});
for (const supersede of ["pause", "cancel", "load", "play", "error"]) {
  test(`late manual play rejection is suppressed after ${supersede}`, async () => {
    const { session, player, errors } = setup();
    const failed = deferred();
    player.play = () => failed.promise;
    const result = session.play();
    if (supersede === "load") session.load({ url: "B", key: "clip" });
    else if (supersede === "error") player.error();
    else if (supersede === "play") { player.play = () => Promise.resolve(); await session.play(); }
    else session[supersede]();
    failed.reject(new Error("obsolete"));
    await result;
    assert.deepEqual(errors, []);
  });
}
test("active manual play failure rejects once without auto-resume notice", async () => {
  const { session, player, errors } = setup();
  const failure = new Error("play denied");
  player.play = () => Promise.reject(failure);
  await assert.rejects(session.play(), (error) => error === failure);
  assert.deepEqual(errors, []);
});
test("active automatic resume failure reports once; stale resume failure is silent", async () => {
  for (const stale of [false, true]) {
    const { session, player, errors } = setup();
    const failed = deferred();
    player.play = () => failed.promise;
    session.load({ url: "B", key: "clip" });
    player.metadata();
    if (stale) session.pause();
    const failure = new Error("resume denied");
    failed.reject(failure);
    await settle();
    assert.deepEqual(errors, stale ? [] : [failure]);
  }
});
test("constructor is quiet; invalid media numbers and rates remain finite", () => {
  const { session, player, changes, rate } = setup({ time: NaN, duration: Infinity });
  assert.equal(changes(), 0);
  assert.equal(session.currentTime, 0);
  assert.equal(session.duration, 0);
  session.load({ url: "A", key: "clip", time: Infinity, duration: NaN });
  session.currentTime = NaN;
  assert.equal(session.currentTime, 0);
  session.currentTime = -5;
  assert.equal(session.currentTime, 0);
  rate(Infinity);
  player.metadata(Infinity);
  assert.equal(player.currentTime, 0);
  assert.equal(player.playbackRate, 1);
  session.currentTime = Infinity;
  assert.equal(player.currentTime, 0);
});
test("native error cancels intent without duplicating the caller's native error notice", () => {
  const { session, player, errors } = setup();
  session.load({ url: "B", key: "clip" });
  const old = player.onloadedmetadata;
  player.error();
  old();
  assert.equal(session.pending, false);
  assert.equal(player.plays, 0);
  assert.deepEqual(errors, []);
});
test("synchronous load and play failures follow their respective error contracts", async () => {
  const { session, player, errors } = setup();
  const failure = new Error("load failed");
  player.load = () => { throw failure; };
  session.load({ url: "B", key: "clip" });
  assert.equal(session.pending, false);
  assert.deepEqual(errors, [failure]);
  player.play = () => { throw failure; };
  await assert.rejects(session.play(), (error) => error === failure);
});
