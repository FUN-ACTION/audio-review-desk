import test from "node:test";
import assert from "node:assert/strict";
import { editRange, trimHandleLimits } from "../src/audio_review_desk/static/wave-math.js";
import { mountWaveform } from "../src/audio_review_desk/static/waveform.js";

test("valid narrow intervals keep both exact endpoints on a no-op edit", () => {
  for (const [duration, start, end] of [[10, 2, 2.0004], [10, 9.9998, 10], [1 / 44100, 0, 1 / 44100], [2, 1.0004, 1.0006]]) {
    assert.deepEqual(editRange(duration, start, end, "start", start), [start, end]);
    assert.deepEqual(editRange(duration, start, end, "end", end), [start, end]);
    assert.deepEqual(editRange(duration, start, end, "start", 0), [0, end]);
    assert.deepEqual(editRange(duration, start, end, "end", duration), [start, duration]);
  }
});

test("ARIA and editing use the same exact reachable bounds", () => {
  for (const [duration, start, end] of [[10, 2, 8], [10, 2, 2.0004], [10, 9.9998, 10], [0.0005, 0, 0.0005], [1.0006, 0, 1.0006]]) {
    const limits = trimHandleLimits(duration, start, end);
    assert.deepEqual(limits.range, [start, end]);
    assert.ok(limits.start[0] <= start && start <= limits.start[1]);
    assert.ok(limits.end[0] <= end && end <= limits.end[1]);
    assert.equal(editRange(duration, start, end, "start", duration)[0], limits.start[1]);
    assert.equal(editRange(duration, start, end, "end", 0)[1], limits.end[0]);
    assert.ok(limits.start[1] < end);
    assert.ok(limits.end[0] > start);
  }
  assert.deepEqual(trimHandleLimits(10, 2, 8), { range: [2, 8], start: [0, 7.999], end: [2.001, 10] });
});

test("sample-derived intervals never move the opposite endpoint or cross", () => {
  for (const rate of [8000, 44100, 48000, 192000]) {
    for (let frame = 1; frame <= 250; frame++) {
      const duration = (frame + 100) / rate, start = frame / rate, end = (frame + 1) / rate;
      for (const value of [0, start, end, duration, duration + 1]) {
        const left = editRange(duration, start, end, "start", value);
        const right = editRange(duration, start, end, "end", value);
        assert.equal(left[1], end);
        assert.equal(right[0], start);
        for (const pair of [left, right]) assert.ok(0 <= pair[0] && pair[0] < pair[1] && pair[1] <= duration);
      }
    }
  }
});

test("unrepresentable millisecond gaps still cannot collapse an interval", () => {
  for (const [duration, start, end] of [[Number.MIN_VALUE, 0, Number.MIN_VALUE], [2 ** 46, 2 ** 45, 2 ** 46], [Number.MAX_VALUE, Number.MAX_VALUE / 2, Number.MAX_VALUE]]) {
    for (const side of ["start", "end"]) {
      for (const value of [0, start, end, duration]) {
        const [left, right] = editRange(duration, start, end, side, value);
        assert.ok(Number.isFinite(left) && Number.isFinite(right));
        assert.ok(0 <= left && left < right && right <= duration);
      }
    }
  }
});

test("invalid values use safe defaults while unknown handles leave the range alone", () => {
  for (const duration of [NaN, Infinity, 0, -1]) {
    assert.deepEqual(trimHandleLimits(duration, 1, 2), { range: [0, 0], start: [0, 0], end: [0, 0] });
    assert.deepEqual(editRange(duration, 1, 2, "end", 5), [0, 0]);
  }
  assert.deepEqual(editRange(10, NaN, NaN, "start", NaN), [0, 10]);
  assert.deepEqual(editRange(10, 2, 8, "unexpected", 5), [2, 8]);
});

function mounted(t, duration, startTime, endTime, onEdit = () => {}) {
  const originals = new Map(["ResizeObserver", "getComputedStyle", "document", "devicePixelRatio"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {
    ResizeObserver: class { observe() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "#0068d1" }),
    document: { documentElement: {} }, devicePixelRatio: 1,
  });
  t.after(() => { for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const handle = () => ({
    style: {}, attributes: {}, listeners: {},
    captures: new Set(),
    classList: { add() {}, remove() {} }, focus() { document.activeElement = this; },
    setPointerCapture(id) { this.captures.add(id); },
    hasPointerCapture(id) { return this.captures.has(id); },
    releasePointerCapture(id) { this.captures.delete(id); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  });
  const start = handle(), end = handle(), calls = [], views = [];
  const canvas = { clientWidth: 300, clientHeight: 100, getBoundingClientRect: () => ({ left: 0, width: 300 }), getContext: () => ({ scale() {}, beginPath() {}, roundRect() {}, fill() {} }) };
  const wave = mountWaveform(canvas, {}, { style: {} }, { style: {} }, {
    start, end, pan: {}, onView: (...args) => views.push(args), onEdit: (...args) => { calls.push(args); onEdit(...args); },
  });
  wave.set([], duration, startTime, endTime);
  return { start, end, calls, views, wave };
}

test("painted submillisecond sliders expose valid exact ARIA values", (t) => {
  const duration = 1 / 44100;
  const { start, end } = mounted(t, duration, 0, duration);
  assert.equal(Number(start.attributes["aria-valuemax"]), 0);
  assert.equal(Number(end.attributes["aria-valuemin"]), duration);
  assert.equal(Number(end.attributes["aria-valuemax"]), duration);
  assert.equal(Number(end.attributes["aria-valuenow"]), duration);
  assert.equal(end.attributes["aria-valuetext"], `${duration} s`);
});

test("painted fractional EOF does not round beyond its ARIA maximum", (t) => {
  const { end } = mounted(t, 1.0006, 0, 1.0006);
  assert.equal(end.attributes["aria-valuenow"], "1.0006");
  assert.ok(Number(end.attributes["aria-valuenow"]) <= Number(end.attributes["aria-valuemax"]));
});

test("keyboard Home preserves the untouched narrow endpoint and repaint agrees", (t) => {
  const { start, end, calls } = mounted(t, 10, 2, 2.0004);
  assert.equal(start.attributes["aria-valuemax"], "2");
  assert.equal(end.attributes["aria-valuemin"], "2.0004");
  start.listeners.keydown({ key: "Home", preventDefault() {} });
  assert.deepEqual(calls, [[0, 2.0004, "start"]]);
  assert.equal(end.attributes["aria-valuenow"], "2.0004");
});

test("keyboard End preserves an exact near-EOF start and repaint agrees", (t) => {
  const { start, end, calls } = mounted(t, 10, 9.9998, 10);
  end.listeners.keydown({ key: "End", preventDefault() {} });
  assert.deepEqual(calls, [[9.9998, 10, "end"]]);
  assert.equal(start.attributes["aria-valuenow"], "9.9998");
});

// Real waveform module with DOM/canvas doubles, not native keyboard-focus QA.
for (const [side, key, expectedRange] of [
  ['start', 'Home', [0, 6]], ['start', 'End', [5.999, 6]],
  ['end', 'Home', [4, 4.001]], ['end', 'End', [4, 10]],
]) test(`zoomed ${side} ${key} keeps the edited slider visible at the same zoom`, t => {
  const f = mounted(t, 10, 4, 6); f.wave.zoom(2, 5);
  const handle = f[side]; handle.focus();
  handle.listeners.keydown({ key, preventDefault() {} });
  assert.deepEqual(f.calls, [[...expectedRange, side]]);
  assert.equal(handle.hidden, false); assert.equal(document.activeElement, handle);
  const [a, b, zoom] = f.views.at(-1), value = Number(handle.attributes['aria-valuenow']);
  assert.equal(zoom, 2); assert.equal(b - a, 5); assert.ok(a <= value && value <= b);
  const expectedView = key === 'Home' && side === 'start' ? [0, 5, 2]
    : key === 'End' && side === 'end' ? [5, 10, 2] : [2.5, 7.5, 2];
  assert.deepEqual(f.views.at(-1), expectedView);
});

for (const [side, key, start, end, shiftKey] of [
  ['start', 'ArrowLeft', 2.5, 6, false], ['end', 'ArrowRight', 4, 7.5, false],
  ['start', 'ArrowLeft', 2.5, 6, true], ['end', 'ArrowRight', 4, 7.5, true],
]) test(`edge-crossing ${side} ${key} shift=${shiftKey} pans only the keyboard step`, t => {
  const f = mounted(t, 10, start, end); f.wave.zoom(2, 5);
  const step = shiftKey ? .1 : .01, direction = side === 'start' ? -1 : 1;
  f[side].listeners.keydown({ key, shiftKey, preventDefault() {} });
  assert.equal(f[side].hidden, false);
  const [a, b, zoom] = f.views.at(-1);
  assert.ok(Math.abs(a - (2.5 + direction * step)) < 1e-10);
  assert.ok(Math.abs(b - (7.5 + direction * step)) < 1e-10); assert.equal(zoom, 2);
  assert.equal(Number(f[side === 'start' ? 'end' : 'start'].attributes['aria-valuenow']), side === 'start' ? end : start);
});

test('visible keyboard steps leave viewport and zoom unchanged', t => {
  const f = mounted(t, 10, 4, 6); f.wave.zoom(4, 5);
  f.start.listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.deepEqual(f.views.at(-1), [3.75, 6.25, 4]); assert.equal(f.start.hidden, false);
});

test('keyboard reveal precedes a synchronous onEdit repaint', t => {
  const observed = []; let f;
  f = mounted(t, 10, 4, 6, (start, end) => {
    f.wave.set([], 10, start, end);
    observed.push({ hidden: f.start.hidden, view: f.views.at(-1) });
  });
  f.wave.zoom(2, 5); f.start.listeners.keydown({ key: 'Home', preventDefault() {} });
  assert.deepEqual(observed, [{ hidden: false, view: [0, 5, 2] }]);
});

test('pointer dragging still clamps to the existing viewport without panning', t => {
  const f = mounted(t, 10, 4, 6); f.wave.zoom(2, 5);
  f.start.listeners.pointerdown({ clientX: 90, pointerId: 1, preventDefault() {} });
  f.start.listeners.pointermove({ clientX: -100, pointerId: 1 });
  assert.deepEqual(f.calls.at(-1), [2.5, 6, 'start']);
  assert.deepEqual(f.views.at(-1), [2.5, 7.5, 2]);
  f.start.listeners.pointerup({ type: 'pointerup', pointerId: 1 });
});

for (const side of ['start', 'end']) for (const key of ['ArrowUp', 'ArrowDown']) for (const shiftKey of [false, true]) {
  test(`${side} ${key} uses ${shiftKey ? 'coarse' : 'fine'} steps without moving the other endpoint`, t => {
    const h = mounted(t, 10, 2, 8); let prevented = 0;
    h[side].listeners.keydown({ key, shiftKey, preventDefault() { prevented++; } });
    const value = (side === 'start' ? 2 : 8) + (key === 'ArrowUp' ? 1 : -1) * (shiftKey ? 0.1 : 0.01);
    assert.equal(prevented, 1); assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0], side === 'start' ? [value, 8, side] : [2, value, side]);
    assert.equal(Number(h[side].attributes['aria-valuenow']), value);
  });
}

for (const side of ['start', 'end']) for (const key of ['ArrowUp', 'ArrowDown']) {
  test(`${side} ${key} clamps safely in a submillisecond interval`, t => {
    const h = mounted(t, 0.0005, 0.0001, 0.0004);
    h[side].listeners.keydown({ key, shiftKey: true, preventDefault() {} });
    const expected = editRange(0.0005, 0.0001, 0.0004, side, (side === 'start' ? 0.0001 : 0.0004) + (key === 'ArrowUp' ? 0.1 : -0.1));
    assert.deepEqual(h.calls[0], [...expected, side]);
    assert.ok(expected[0] < expected[1]); assert.ok(expected[0] >= 0 && expected[1] <= 0.0005);
    assert.equal(Number(h[side].attributes['aria-valuenow']), expected[side === 'start' ? 0 : 1]);
  });
}

for (const [side, key, start, end] of [['start', 'ArrowDown', 2.5, 6], ['end', 'ArrowUp', 4, 7.5]]) for (const shiftKey of [false, true]) {
  test(`${side} ${key} keeps a zoom-edge handle visible (Shift=${shiftKey})`, t => {
    const h = mounted(t, 10, start, end); h.wave.zoom(2, 5); h[side].focus();
    h[side].listeners.keydown({ key, shiftKey, preventDefault() {} });
    const value = Number(h[side].attributes['aria-valuenow']), [a, b, zoom] = h.views.at(-1);
    assert.equal(zoom, 2); assert.ok(Math.abs(b - a - 5) < 1e-12);
    assert.ok(value >= a - 1e-12 && value <= b + 1e-12); assert.equal(h[side].hidden, false);
    assert.equal(document.activeElement, h[side]);
    assert.equal(h.calls[0][side === 'start' ? 1 : 0], side === 'start' ? end : start);
  });
}

for (const side of ['start', 'end']) for (const key of ['ArrowUp', 'ArrowDown']) for (const flags of [
  { defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
]) test(`${side} ${key} leaves guarded event untouched ${JSON.stringify(flags)}`, t => {
  const h = mounted(t, 10, 2, 8); let prevented = 0;
  h[side].listeners.keydown({ key, ...flags, preventDefault() { prevented++; } });
  assert.equal(prevented, 0); assert.deepEqual(h.calls, []);
  assert.equal(h.start.attributes['aria-valuenow'], '2'); assert.equal(h.end.attributes['aria-valuenow'], '8');
});

test('held vertical key repeats ordinary incremental adjustment', t => {
  const h = mounted(t, 10, 2, 8); let prevented = 0;
  for (let i = 0; i < 3; i++) h.start.listeners.keydown({ key: 'ArrowUp', repeat: i > 0, preventDefault() { prevented++; } });
  assert.equal(h.calls.length, 3); assert.equal(prevented, 3);
  assert.ok(Math.abs(Number(h.start.attributes['aria-valuenow']) - 2.03) < 1e-12);
  assert.equal(h.end.attributes['aria-valuenow'], '8');
});
