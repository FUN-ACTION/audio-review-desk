import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Real spring implementation and vendored scheduler, with a controlled media
// query and clock. This does not emulate OS settings or browser rendering.
test('real spring reacts mid-flight, owns only active listeners and preserves later user targets', async t => {
  const names = ['document', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const [name, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  let now = 0, id = 0;
  const frames = new Map(), listeners = new Set(), events = new Map();
  const query = { matches: false,
    addEventListener(type, fn) { assert.equal(type, 'change'); listeners.add(fn); },
    removeEventListener(type, fn) { assert.equal(type, 'change'); listeners.delete(fn); } };
  globalThis.document = { hidden: false, addEventListener: (type, fn) => events.set(type, fn) };
  globalThis.matchMedia = () => query;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  const { springValue } = await import('../src/audio_review_desk/static/motion.js');
  const values = [], move = springValue(value => values.push(value));
  const step = () => { now += 16.667; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); };
  const reduce = matches => { query.matches = matches; [...listeners].forEach(fn => fn({ matches })); };
  assert.equal(listeners.size, 0);
  move(100); assert.equal(listeners.size, 1);
  for (let n = 0; n < 4; n++) step();
  assert.ok(values.at(-1) > 0 && values.at(-1) < 100);
  const stale = [...listeners][0];
  move(200); assert.equal(listeners.size, 1);
  reduce(true); assert.equal(values.at(-1), 200); assert.equal(listeners.size, 0);
  const count = values.length;
  for (let n = 0; n < 8; n++) step();
  assert.equal(values.length, count, 'cancelled spring cannot resume on queued frames');
  stale({ matches: true }); assert.equal(values.length, count);
  reduce(false); assert.equal(values.length, count, 'preference reset does not restart old motion');
  move(300); assert.equal(listeners.size, 1);
  for (let n = 0; n < 180; n++) step();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  assert.equal(values.at(-1), 300); assert.equal(listeners.size, 0, 'natural completion releases listener');
  move(400); assert.equal(listeners.size, 1);
  move(450, true); assert.equal(values.at(-1), 450); assert.equal(listeners.size, 0);
  events.get('keydown')(); move(500); assert.equal(values.at(-1), 500); assert.equal(listeners.size, 0);
  events.get('pointerdown')(); move(600); assert.equal(listeners.size, 1);
  reduce(true); assert.equal(values.at(-1), 600); assert.equal(listeners.size, 0);
  move(700); assert.equal(values.at(-1), 700); assert.equal(listeners.size, 0);
  document.hidden = true; reduce(false); move(800); assert.equal(values.at(-1), 800); assert.equal(listeners.size, 0);
  document.hidden = false;
  const otherValues = [], other = springValue(value => otherValues.push(value));
  move(900); other(50); assert.equal(listeners.size, 2);
  reduce(true); assert.equal(values.at(-1), 900); assert.equal(otherValues.at(-1), 50);
  assert.equal(listeners.size, 0);

});

// Inject only the animation boundary to force late completion/rejection and
// synchronous startup failure; run the unchanged production spring body.
const source = readFileSync(new URL('../src/audio_review_desk/static/motion.js', import.meta.url), 'utf8');
function controlled({ throws = false } = {}) {
  const listeners = new Set(), values = [], effects = [];
  const query = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const env = { Promise, matchMedia: () => query, immediate: () => query.matches,
    motionValue: () => ({ on() {}, getVelocity: () => 0, jump: value => values.push(value) }),
    animateValue(value, target, options) {
      if (throws) throw new Error('synthetic startup failure');
      let resolve, reject;
      const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const effect = { target, options, resolve, reject, stops: 0, stop() { this.stops++; }, then: finished.then.bind(finished) };
      effects.push(effect); return effect;
    }, render: value => values.push(value) };
  vm.createContext(env);
  vm.runInContext(source.slice(source.indexOf('export function springValue'), source.indexOf('\nconst active = new WeakMap()')).replace('export ', '') + '\nmove = springValue(render);', env);
  return { ...env, listeners, values, effects, query };
}
for (const outcome of ['complete', 'resolve', 'reject']) test(`obsolete ${outcome} cannot detach a newer spring listener`, async () => {
  const h = controlled(); h.move(10); const old = h.effects[0], oldListener = [...h.listeners][0];
  h.move(20); assert.equal(old.stops, 1);
  if (outcome === 'complete') old.options.onComplete();
  else if (outcome === 'resolve') old.resolve();
  else old.reject(new Error('obsolete failure'));
  for (let n = 0; n < 6; n++) await Promise.resolve();
  assert.equal(h.listeners.size, 1);
  h.query.matches = true; oldListener(); assert.equal(h.values.length, 0);
  [...h.listeners][0](); assert.equal(h.values.at(-1), 20); assert.equal(h.listeners.size, 0);
});
test('startup failure releases the listener and allows later immediate action', () => {
  const h = controlled({ throws: true });
  assert.throws(() => h.move(10), /synthetic startup failure/); assert.equal(h.listeners.size, 0);
  h.query.matches = true; h.move(20); assert.equal(h.values.at(-1), 20); assert.equal(h.listeners.size, 0);
});
test('active rejection releases preference ownership', async () => {
  const h = controlled(); h.move(10); h.effects[0].reject(new Error('synthetic failure'));
  for (let n = 0; n < 6; n++) await Promise.resolve();
  assert.equal(h.listeners.size, 0);
});
