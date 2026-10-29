import test from 'node:test';
import assert from 'node:assert/strict';
import { acousticLayout, smoothTarget, mountSignalStage } from '../src/audio_review_desk/static/tour/signal-stage.js';

test('acoustic geometry is bounded, ordered and reproducible at every supported density', () => {
  for (const count of [8, 24, 44, 64]) {
    const rings = acousticLayout(count);
    assert.equal(rings.length, count);
    assert.deepEqual(rings, acousticLayout(count));
    assert.equal(rings[0].x, -3.55);
    assert.equal(rings.at(-1).x, 3.55);
    for (let index = 0; index < rings.length; index++) {
      const ring = rings[index];
      assert.ok(Object.values(ring).every(Number.isFinite));
      assert.ok(ring.radius >= .16 && ring.radius < 1.33);
      if (index) assert.ok(ring.x > rings[index - 1].x);
    }
    assert.ok(rings[Math.floor(count / 2)].radius > rings[0].radius * 3);
  }
  for (const count of [0, 7, 65, 12.5, NaN]) assert.throws(() => acousticLayout(count), RangeError);
});

test('pointer smoothing approaches targets without overshoot and clamps suspended frame gaps', () => {
  let value = 0;
  for (let step = 0; step < 120; step++) {
    const next = smoothTarget(value, 1, 1 / 60);
    assert.ok(next >= value && next <= 1);
    value = next;
  }
  assert.ok(value > .99999);
  assert.equal(smoothTarget(0, 1, 5), smoothTarget(0, 1, .05));
  assert.equal(smoothTarget(0, 1, -1), 0);
  assert.ok(smoothTarget(value, -1, 1 / 60) < value);
});

test('explicit graphics fallback remains usable and owns no animation loop', () => {
  const target = () => ({
    listeners: new Map(),
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    removeEventListener(type) { this.listeners.delete(type); },
  });
  const canvas = { ...target(), setAttribute() {}, remove() { this.removed = true; } };
  const document = { ...target(), hidden: false, createElement: () => canvas };
  const host = { ...target(), ownerDocument: document, dataset: {}, prepend() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1120, height: 440 }) };
  let requested = 0, disconnected = 0;
  class Observer {
    observe() {}
    disconnect() { disconnected++; }
  }
  const runtime = {
    location: { search: '?graphics=off' },
    IntersectionObserver: Observer, ResizeObserver: Observer,
    requestAnimationFrame() { requested++; return 1; }, cancelAnimationFrame() {},
  };
  const stage = mountSignalStage(host, {}, runtime);
  assert.equal(stage.ready, false);
  assert.equal(host.dataset.renderer, 'fallback');
  stage.setPaused(true); stage.setAudioLevel(.8); stage.setPaused(false);
  assert.equal(requested, 0);
  assert.equal(host.dataset.paused, 'false');
  stage.dispose(); stage.dispose();
  assert.equal(disconnected, 2);
  assert.equal(host.listeners.size, 0);
  assert.equal(document.listeners.size, 0);
  assert.equal(canvas.listeners.size, 0);
  assert.equal(canvas.removed, true);
});
