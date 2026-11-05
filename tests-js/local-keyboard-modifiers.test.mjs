import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mountMarkers } from '../src/audio_review_desk/static/markers.js';

// Actual mounted marker controls plus extracted command/range/global handlers.
// Deterministic DOM doubles and explicit bubbling do not cover browser defaults.
let previousDocument;
beforeEach(() => { previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document"); });
afterEach(() => {
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else delete globalThis.document;
});
function extract(file, registration) {
  const source = readFileSync(new URL(`../src/audio_review_desk/static/${file}`, import.meta.url), 'utf8');
  const start = source.indexOf(registration), indent = registration.match(/^ */)[0];
  assert.ok(start >= 0);
  assert.equal(source.indexOf(registration, start + registration.length), -1);
  const end = source.indexOf(`\n${indent}});`, start);
  assert.ok(end > start);
  return source.slice(source.indexOf('(event) => {', start), end) + '\n}';
}
const handlers = {
  commands: extract('commands.js', '  input.addEventListener("keydown", (event) => {'),
  waveform: extract('waveform.js', '    handle.addEventListener("keydown", (event) => {'),
  global: extract('workbench.js', 'document.addEventListener("keydown", (event) => {'),
};
function harness(kind, { commandOpen = false } = {}) {
  const calls = [], nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { open: id === 'commandDialog' && commandOpen,
      close() { this.open = false; }, focus() { calls.push('focus'); } });
    return nodes.get(id);
  };
  const context = vm.createContext({ $, index: 0, shown: [{}, {}],
    run() { calls.push('run'); $('commandDialog').close(); },
    highlight() { calls.push('highlight'); },
    // Explicit mounted-handle guards; the extracted test still checks raw key intent.
    handle: { disabled: false }, cancellingDrag: false,
    side: 'start', left: 1, right: 4, duration: 5,
    change(side, value) { calls.push(['range', side, value]); },
    save(advance) { calls.push(['save', advance]); }, commandMenu: { open() { calls.push('open'); } },
  });
  const marker = ['add', 'edit'].includes(kind) ? mountMarkerHarness(kind, calls) : null;
  const local = marker ? event => marker.target.emit('keydown', event) : vm.runInContext(`(${handlers[kind]})`, context);
  const global = vm.runInContext(`(${handlers.global})`, context);
  function key(key, flags = {}, bubble = false) {
    const event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      defaultPrevented: false, propagationStopped: false,
      target: marker?.target || { closest: () => ({}) },
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...flags };
    local(event);
    if (bubble && !event.propagationStopped) global(event);
    return event;
  }
  return { $, calls, context, key, global, marker };
}

function mountMarkerHarness(kind, calls) {
  const document = { activeElement: null };
  class Element {
    constructor(tag = 'div') { Object.assign(this, { tag, children: [], parent: null, className: '', listeners: new Map(), attributes: {}, style: {}, value: '' }); }
    get classList() { return { contains: name => this.className.split(' ').includes(name), add: name => { this.className += ` ${name}`; } }; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) {
      if (this.children.some(node => node.contains(document.activeElement))) document.activeElement = document.body;
      for (const node of this.children) node.parent = null;
      this.children = []; this.append(...nodes);
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : selector.split(',').includes(this.tag); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    emit(type, event = { target: this }) { for (const fn of this.listeners.get(type) || []) fn(event); }
    click() { if (!this.disabled) this.emit('click'); }
    focus() { if (!this.disabled) document.activeElement = this; }
  }
  document.body = new Element('body'); document.activeElement = document.body;
  document.createElement = tag => new Element(tag); globalThis.document = document;
  const input = new Element('input'), add = new Element('button'), list = new Element(), ticks = new Element();
  document.body.append(input, add, list, ticks);
  const view = mountMarkers({ input, add, list, ticks, player: { currentTime: 3 }, duration: () => 10,
    t: key => key, onChange() { calls.push('change'); }, onError(error) { calls.push(['error', error]); } });
  view.set([{ time: 1, text: 'original' }], false);
  let target = input;
  if (kind === 'edit') {
    list.querySelector('.marker-note').click();
    target = list.querySelector('.marker-edit-text');
    target.value = 'edited'; target.emit('input');
  } else { input.value = 'added'; input.emit('input'); }
  target.focus(); calls.length = 0;
  return { view, input, list, target, document };
}

const localKeys = { commands: ['Enter', 'ArrowUp', 'ArrowDown'], add: ['Enter'], edit: ['Enter', 'Escape'] };
for (const [kind, keys] of Object.entries(localKeys)) for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
  test(`${kind} leaves ${modifier} combinations to their owner`, () => {
    const h = harness(kind);
    for (const key of keys) assert.equal(h.key(key, { [modifier]: true }).defaultPrevented, false);
    assert.deepEqual(h.calls, []);
  });
}
for (const kind of ['commands', 'add', 'edit', 'waveform']) {
  test(`${kind} respects consumed and composing events`, () => {
    const h = harness(kind), key = kind === 'waveform' ? 'ArrowRight' : 'Enter';
    for (const flags of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }]) h.key(key, flags);
    assert.deepEqual(h.calls, []);
  });
}
for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
  test(`waveform ignores ${modifier} even with Shift`, () => {
    const h = harness('waveform');
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) for (const shiftKey of [false, true]) {
      assert.equal(h.key(key, { [modifier]: true, shiftKey }).defaultPrevented, false);
    }
    assert.deepEqual(h.calls, []);
  });
}
test('waveform retains plain/Shift step sizes and Home/End boundaries', () => {
  const h = harness('waveform');
  for (const [key, flags] of [['ArrowRight', {}], ['ArrowRight', { shiftKey: true }], ['ArrowLeft', {}], ['ArrowLeft', { shiftKey: true }], ['Home', {}], ['End', {}]]) {
    assert.equal(h.key(key, flags).defaultPrevented, true);
  }
  assert.deepEqual(h.calls, [['range', 'start', 1.01], ['range', 'start', 1.1], ['range', 'start', .99], ['range', 'start', .9], ['range', 'start', 0], ['range', 'start', 5]]);
});
for (const primary of ['ctrlKey', 'metaKey']) {
  test(`palette ${primary}+Enter does not run a command or fall through to Save`, () => {
    const h = harness('commands', { commandOpen: true });
    const event = h.key('Enter', { [primary]: true }, true);
    assert.equal(event.defaultPrevented, false); assert.equal(h.$('commandDialog').open, true);
    assert.deepEqual(h.calls, []);
  });
  for (const kind of ['add', 'edit']) test(`${kind} ${primary}+Enter delegates once to global Save`, () => {
    const h = harness(kind);
    assert.equal(h.key('Enter', { [primary]: true }, true).defaultPrevented, true);
    assert.deepEqual(h.calls, [['save', false]]);
    // Actual Save still owns markersView.flush(); this harness does not simulate persistence.
  });
  for (const extra of ['shiftKey', 'altKey']) for (const kind of ['commands', 'add', 'edit']) {
    test(`${kind} bubbling ${primary}+${extra}+Enter is not consumed`, () => {
      const h = harness(kind, { commandOpen: kind === 'commands' });
      assert.equal(h.key('Enter', { [primary]: true, [extra]: true }, true).defaultPrevented, false);
      assert.deepEqual(h.calls, []);
    });
  }
}
for (const [kind, expected] of [['commands', 'run'], ['add', 'change'], ['edit', 'change']]) {
  test(`${kind} plain Enter acts once and bubbling does not add a global action`, () => {
    const h = harness(kind, { commandOpen: kind === 'commands' });
    assert.equal(h.key('Enter', {}, true).defaultPrevented, true);
    assert.deepEqual(h.calls, [expected], 'exactly one local action, no duplicate change or global Save');
    if (kind === 'add') {
      assert.deepEqual(h.marker.view.get(), [{ time: 1, text: 'original' }, { time: 3, text: 'added' }]);
      assert.equal(h.marker.input.value, '');
      assert.equal(h.marker.document.activeElement, h.marker.input);
    }
    if (kind === 'edit') {
      assert.deepEqual(h.marker.view.get(), [{ time: 1, text: 'edited' }]);
      assert.equal(h.marker.view.snapshot().editing, null);
      assert.equal(h.marker.document.activeElement, h.marker.list.querySelector('.marker-note'));
    }
  });
}
test('global handler respects a consumed primary Enter after another handler closes a dialog', () => {
  const h = harness('commands', { commandOpen: true });
  h.$('commandDialog').close();
  h.global({ key: 'Enter', ctrlKey: true, defaultPrevented: true, preventDefault() { throw new Error('must not consume twice'); } });
  assert.deepEqual(h.calls, []);
});
