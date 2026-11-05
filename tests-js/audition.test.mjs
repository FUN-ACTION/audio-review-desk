import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { words } from "../src/audio_review_desk/static/copy.js";
import { auditionBounds, quietRange, createAudition } from "../src/audio_review_desk/static/audition.js";

test("edge audition includes context on both sides and clamps to actual media", () => {
  assert.deepEqual(auditionBounds(12, 2, 9, "start"), [0.75, 3.25]);
  assert.deepEqual(auditionBounds(12, 2, 11.5, "end"), [10.25, 12]);
  assert.deepEqual(auditionBounds(12, 0, 9, "start"), [0, 1.25]);
  assert.deepEqual(auditionBounds(12, 2, 9, "selection"), [2, 9]);
  assert.equal(auditionBounds(12, 8, 3, "selection"), null);
  assert.equal(auditionBounds(NaN, 0, 1, "start"), null);
});

test("quiet suggestion refuses all-silent, undecoded and invalid boundaries", () => {
  const q = { decoded: true, duration: 10, leading_quiet_seconds: 0.2, trailing_quiet_seconds: 0.3 };
  assert.deepEqual(quietRange(q), [0.2, 9.7]);
  assert.equal(quietRange({ ...q, decoded: false }), null);
  assert.equal(quietRange({ ...q, leading_quiet_seconds: 10 }), null);
  assert.equal(quietRange({ ...q, trailing_quiet_seconds: NaN }), null);
  assert.equal(quietRange({ ...q, leading_quiet_seconds: 0, trailing_quiet_seconds: 0 }), null);
});

function setup() {
  const player = new EventTarget();
  Object.assign(player, { src: "/media/fixture/a.wav", readyState: 4, duration: 12, currentTime: 0, paused: true, plays: [] });
  player.play = () => { player.paused = false; return new Promise((resolve, reject) => player.plays.push({ resolve, reject })); };
  player.pause = () => { player.paused = true; player.dispatchEvent(new Event("pause")); };
  const loop = { checked: true }, changes = [], errors = [], unavailable = [];
  return { player, loop, changes, errors, unavailable, control: createAudition({ player, loop, onChange: value => changes.push(value), onError: e => errors.push(e), onRangeUnavailable: () => unavailable.push(true) }) };
}

test("one-shot stops at the end and restores the user's previous loop setting", () => {
  const { control, player, loop, changes } = setup();
  control.start([2, 5], "selection");
  assert.equal(player.currentTime, 2);
  assert.equal(loop.checked, false);
  control.check(4.99);
  assert.equal(player.paused, false);
  control.check(5.02);
  assert.equal(player.paused, true);
  assert.equal(loop.checked, true);
  assert.deepEqual(changes, ["selection", null]);
});

test("obsolete playback failure cannot cancel a newer audition", async () => {
  const { control, player, loop, errors } = setup();
  control.start([0, 2], "start");
  control.start([7, 9], "end");
  player.plays[0].reject(new Error("interrupted old play"));
  await Promise.resolve();
  assert.equal(loop.checked, false);
  assert.equal(errors.length, 0);
  control.check(8);
  assert.equal(player.paused, false);
  player.plays[1].reject(new Error("current play failed"));
  await Promise.resolve();
  assert.equal(loop.checked, true);
  assert.equal(errors.length, 1);
});

test("user changes to loop during audition survive cancellation", () => {
  const { control, loop, player } = setup();
  control.start([0, 2], "start");
  loop.checked = false;
  control.cancel({ restore: false });
  player.pause();
  assert.equal(loop.checked, false);
  control.dispose();
});

test("native pause then ended completes a one-shot without ordinary loop restart", () => {
  const { control, player, loop } = setup();
  player.duration = 12;
  let restarts = 0;
  player.addEventListener("ended", () => { if (loop.checked) restarts++; });
  control.start([10, 12], "end");
  player.currentTime = 12;
  player.ended = true;
  player.pause();
  player.dispatchEvent(new Event("ended"));
  assert.equal(loop.checked, true, "loop preference is retained for future ordinary playback");
  assert.equal(restarts, 0);
  // Ordinary playback completion is not swallowed after the guard is consumed.
  player.dispatchEvent(new Event("ended"));
  assert.equal(restarts, 1);
});

test("a final timeupdate before native ended retains the one-shot guard", () => {
  const { control, player, loop } = setup();
  player.duration = 12;
  let restarts = 0;
  player.addEventListener("ended", () => { if (loop.checked) restarts++; });
  control.start([10, 12], "end");
  player.currentTime = 12;
  control.check(12);
  player.dispatchEvent(new Event("ended"));
  assert.equal(restarts, 0);
  assert.equal(loop.checked, true);
});

// Production controller with media doubles; not native playback/listening QA.
for (const kind of ['selection', 'start', 'end']) test(`short B reference rejects unavailable ${kind} audition without changing the review window`, () => {
  const { control, player, loop, changes, unavailable } = setup();
  player.duration = 10;
  const bounds = auditionBounds(100, 50, 60, kind), original = [...bounds];
  assert.equal(control.start(bounds, kind), false);
  assert.deepEqual(bounds, original);
  assert.equal(player.currentTime, 0);
  assert.equal(player.plays.length, 0);
  assert.equal(player.paused, true);
  assert.equal(loop.checked, true);
  assert.deepEqual(changes, []);
  assert.equal(unavailable.length, 1);
});

for (const [kind, start, end, expectedStart] of [['selection', 5, 20, 5], ['start', 9.5, 20, 8.25], ['end', 5, 10.5, 9.25]])
  test(`partially covered ${kind} audition stops at B's duration and restores loop`, () => {
    const { control, player, loop, unavailable } = setup();
    player.duration = 10;
    const bounds = auditionBounds(100, start, end, kind), original = [...bounds];
    assert.equal(control.start(bounds, kind), true);
    assert.equal(player.currentTime, expectedStart);
    assert.equal(loop.checked, false);
    control.check(9.99); assert.equal(player.paused, false);
    control.check(10); assert.equal(player.paused, true);
    assert.equal(loop.checked, true);
    assert.deepEqual(bounds, original);
    assert.deepEqual(unavailable, []);
  });

for (const duration of [NaN, Infinity, -1, 0, undefined]) test(`unknown or invalid active duration ${duration} does not issue an audition seek`, () => {
  const { control, player, loop, unavailable } = setup();
  player.duration = duration;
  assert.equal(control.start([2, 5], 'selection'), false);
  assert.equal(player.currentTime, 0); assert.equal(player.plays.length, 0);
  assert.equal(loop.checked, true); assert.equal(unavailable.length, 1);
});

for (const bounds of [null, [], [2], [2, 5, 8], [NaN, 5], [2, Infinity], [-1, 5], [5, 5], [6, 5], ['2', 5]])
  test(`invalid audition bounds ${JSON.stringify(bounds)} preserve active playback`, () => {
    const { control, player, loop, unavailable } = setup();
    control.start([2, 5], 'selection');
    assert.equal(control.start(bounds, 'end'), false);
    assert.equal(player.currentTime, 2); assert.equal(player.plays.length, 1);
    assert.equal(loop.checked, false); assert.equal(unavailable.length, 1);
    control.check(5); assert.equal(player.paused, true); assert.equal(loop.checked, true);
  });

test('a range starting exactly at active EOF is unavailable', () => {
  const { control, player, unavailable } = setup(); player.duration = 10;
  assert.equal(control.start([10, 12], 'selection'), false);
  assert.equal(player.plays.length, 0); assert.equal(unavailable.length, 1);
});

test('unloaded media stays inert without reporting a range mismatch', () => {
  for (const override of [{ readyState: 0 }, { src: '' }]) {
    const { control, player, changes, unavailable } = setup(); Object.assign(player, override);
    assert.equal(control.start([2, 5], 'selection'), false);
    assert.equal(player.plays.length, 0); assert.deepEqual(changes, []); assert.deepEqual(unavailable, []);
  }
});


test('sparse bounds cannot bypass finite endpoint validation', () => {
  const { control, player, unavailable } = setup();
  assert.equal(control.start(new Array(2), 'selection'), false);
  assert.equal(player.plays.length, 0); assert.equal(unavailable.length, 1);
});

for (const language of ['en', 'zh']) test(`workbench wires a localized unavailable audition notice (${language})`, () => {
  const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
  const registration = source.match(/const audition = createAudition\(\{[\s\S]*?\n\}\);/)[0];
  const h = setup(), messages = [], attributes = [];
  h.player.duration = 10;
  const context = { createAudition, player: h.player, $: id => id === 'loop' ? h.loop : { setAttribute: (...args) => attributes.push(args) },
    t: key => words[language][key], notice: value => messages.push(typeof value === 'function' ? value() : value) };
  vm.runInNewContext(`${registration}\naudition.start([50, 60], 'selection');`, context);
  assert.ok(words[language].auditionUnavailable);
  assert.deepEqual(messages, [words[language].auditionUnavailable]);
  assert.deepEqual(attributes, []); assert.equal(h.player.plays.length, 0); assert.equal(h.loop.checked, true);
});
