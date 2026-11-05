import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the real document handler with native-target and action doubles.
const source = readFileSync(process.env.ARD_SHORTCUT_WORKBENCH || new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const start = source.indexOf('document.addEventListener("keydown", (event) => {');
const end = source.indexOf('\n});', start);
assert.ok(start >= 0 && end > start);
const code = source.slice(source.indexOf('(event) => {', start), end) + '\n}';
function setup({ decoded = true, busy = false } = {}) {
  const calls = [], nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { open: false, click: () => calls.push(id), close() { this.open = false; calls.push(`${id}.close`); } }); return nodes.get(id); };
  const context = vm.createContext({ $, busy, selected: { quality: { decoded } }, variant: 'a',
    commandMenu: { open() { $('commandDialog').open = true; calls.push('command.open'); } },
    save: advance => calls.push(['save', advance]), openDialog: () => calls.push('help'),
    markersView: { focus: () => calls.push('marker.focus') }, switchVariant: () => calls.push('variant'), markBoundary: () => calls.push('boundary'),
  });
  const handler = vm.runInContext(`(${code})`, context);
  const keydown = (key, { target = 'div', ...flags } = {}) => {
    const event = { key, code: key === ' ' ? 'Space' : '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false,
      target: { closest: selector => selector.split(',').includes(target) ? {} : null },
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...flags };
    handler(event); return event;
  };
  return { $, calls, keydown, context };
}

for (const modifier of ['ctrlKey', 'metaKey']) {
  test(`${modifier}+Enter saves once per physical keypress, including after the previous save is complete`, () => {
    const h = setup(); assert.equal(h.keydown('Enter', { [modifier]: true }).defaultPrevented, true);
    for (let i = 0; i < 3; i++) assert.equal(h.keydown('Enter', { [modifier]: true, repeat: true }).defaultPrevented, true);
    assert.deepEqual(h.calls, [['save', false]]);
    h.keydown('Enter', { [modifier]: true }); assert.deepEqual(h.calls, [['save', false], ['save', false]]);
  });
  test(`${modifier}+K stays open while held and closes only on a fresh keypress`, () => {
    const h = setup(); h.keydown('k', { [modifier]: true });
    for (let i = 0; i < 3; i++) assert.equal(h.keydown('K', { [modifier]: true, repeat: true }).defaultPrevented, true);
    assert.equal(h.$('commandDialog').open, true); assert.deepEqual(h.calls, ['command.open']);
    h.keydown('k', { [modifier]: true }); assert.equal(h.$('commandDialog').open, false);
    assert.deepEqual(h.calls, ['command.open', 'commandDialog.close']);
    h.keydown('k', { [modifier]: true, repeat: true }); assert.equal(h.$('commandDialog').open, false);
  });
  test(`${modifier}+Enter still works from a text field without intercepting repeated native text`, () => {
    const h = setup(); h.keydown('Enter', { [modifier]: true, target: 'textarea' });
    h.keydown('Enter', { [modifier]: true, target: 'textarea', repeat: true }); assert.deepEqual(h.calls, [['save', false]]);
    assert.equal(h.keydown('Enter', { target: 'textarea', repeat: true }).defaultPrevented, false);
    assert.equal(h.calls.length, 1);
  });
}

test('global Space toggles playback once while every repeat still blocks page scrolling', () => {
  const h = setup(); assert.equal(h.keydown(' ').defaultPrevented, true);
  for (let i = 0; i < 3; i++) assert.equal(h.keydown(' ', { repeat: true }).defaultPrevented, true);
  assert.deepEqual(h.calls, ['play']); h.keydown(' '); assert.deepEqual(h.calls, ['play', 'play']);
});

for (const target of ['button', 'a', 'summary', 'input', 'textarea', 'select']) {
  test(`Space retains native ${target} behavior on initial and repeating events`, () => {
    const h = setup();
    for (const repeat of [false, true]) assert.equal(h.keydown(' ', { target, repeat }).defaultPrevented, false);
    assert.deepEqual(h.calls, []);
  });
}

for (const [key, action] of [['j', 'next'], ['k', 'previous']]) test(`held ${key.toUpperCase()} keeps intentional queue repetition`, () => {
  const h = setup(); h.keydown(key); h.keydown(key, { repeat: true }); h.keydown(key, { repeat: true });
  assert.deepEqual(h.calls, [action, action, action]);
});

for (const flags of [{ isComposing: true }, { keyCode: 229 }]) test(`IME ${flags.isComposing ? 'composition' : 'legacy boundary'} takes precedence over all repeat handling`, () => {
  const h = setup();
  for (const [key, modifier] of [['Enter', 'ctrlKey'], ['Enter', 'metaKey'], ['k', 'ctrlKey'], ['k', 'metaKey'], [' ', null]]) {
    assert.equal(h.keydown(key, { ...(modifier ? { [modifier]: true } : {}), repeat: true, ...flags }).defaultPrevented, false);
  }
  assert.deepEqual(h.calls, []);
});

test('modal exclusions still block saves and transport while repeated menu chord remains inert', () => {
  for (const id of ['importDialog', 'discardDialog', 'helpDialog']) {
    const h = setup(); h.$(id).open = true;
    h.keydown('Enter', { ctrlKey: true, repeat: true }); h.keydown(' ', { repeat: true });
    h.keydown('k', { ctrlKey: true, repeat: true }); assert.deepEqual(h.calls, []);
  }
});

test('holding Space without decoded audio does not create a playback action', () => {
  const h = setup({ decoded: false }); h.keydown(' '); h.keydown(' ', { repeat: true }); assert.deepEqual(h.calls, []);
});

test('orphan repeats never trigger a save, command menu or playback after focus enters the app', () => {
  const h = setup();
  for (const [key, flags] of [['Enter', { ctrlKey: true }], ['k', { metaKey: true }], [' ', {}]]) {
    assert.equal(h.keydown(key, { ...flags, repeat: true }).defaultPrevented, true);
  }
  assert.deepEqual(h.calls, []);
});

test('closing the command palette elsewhere does not let a held chord reopen it', () => {
  const h = setup(); h.keydown('k', { ctrlKey: true }); h.$('commandDialog').open = false;
  h.keydown('k', { ctrlKey: true, repeat: true }); assert.equal(h.$('commandDialog').open, false);
  assert.deepEqual(h.calls, ['command.open']); h.keydown('k', { ctrlKey: true }); assert.equal(h.$('commandDialog').open, true);
});

test('busy-to-idle transition cannot activate Space that is already held', () => {
  const h = setup({ busy: true }); h.keydown(' '); h.context.busy = false; h.keydown(' ', { repeat: true });
  assert.deepEqual(h.calls, []); h.keydown(' '); assert.deepEqual(h.calls, ['play']);
});

test('newly decoded audio cannot activate Space that is already held', () => {
  const h = setup({ decoded: false }); h.keydown(' '); h.context.selected.quality.decoded = true; h.keydown(' ', { repeat: true });
  assert.deepEqual(h.calls, []); h.keydown(' '); assert.deepEqual(h.calls, ['play']);
});

test('modified Space keeps its existing native behavior', () => {
  const h = setup();
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) for (const repeat of [false, true]) {
    assert.equal(h.keydown(' ', { [modifier]: true, repeat }).defaultPrevented, false);
  }
  assert.deepEqual(h.calls, []);
});

for (const [key, action, prevents] of [['f', 'focusMode', true], ['b', 'variant', false]]) {
  test(`held ${key.toUpperCase()} toggles once and accepts the next fresh press`, () => {
    const h = setup(); assert.equal(h.keydown(key).defaultPrevented, prevents);
    for (let i = 0; i < 3; i++) assert.equal(h.keydown(key.toUpperCase(), { repeat: true }).defaultPrevented, prevents);
    assert.deepEqual(h.calls, [action]); h.keydown(key); assert.deepEqual(h.calls, [action, action]);
  });
  test(`${key.toUpperCase()} remains native text while typing, including repeat`, () => {
    const h = setup();
    for (const target of ['input', 'textarea', 'select']) for (const repeat of [false, true]) {
      assert.equal(h.keydown(key, { target, repeat }).defaultPrevented, false);
    }
    assert.deepEqual(h.calls, []);
  });
}

// Authored after the test-launcher restriction: these cases have NOT been run.
for (const key of ['k', 'Enter']) for (const primary of ['ctrlKey', 'metaKey']) {
  for (const extra of ['shiftKey', 'altKey', primary === 'ctrlKey' ? 'metaKey' : 'ctrlKey']) {
    test(`${primary}+${extra}+${key} is not consumed by the global handler in text and page contexts`, () => {
      const h = setup();
      for (const target of ['div', 'input', 'textarea', 'select']) for (const repeat of [false, true]) {
        assert.equal(h.keydown(key, { [primary]: true, [extra]: true, target, repeat }).defaultPrevented, false);
      }
      assert.deepEqual(h.calls, []);
    });
  }
}
for (const id of ['importDialog', 'discardDialog', 'helpDialog']) {
  test(`${id} global handler never consumes primary K or Enter, including text contexts`, () => {
    const h = setup(); h.$(id).open = true;
    for (const key of ['k', 'Enter']) for (const primary of ['ctrlKey', 'metaKey']) {
      for (const target of ['div', 'input', 'textarea', 'select']) for (const repeat of [false, true]) {
        assert.equal(h.keydown(key, { [primary]: true, target, repeat }).defaultPrevented, false);
      }
    }
    assert.deepEqual(h.calls, []);
  });
}
for (const primary of ['ctrlKey', 'metaKey']) {
  test(`global handler leaves extra-modifier ${primary} chords alone in the palette and exact K closes it`, () => {
    const h = setup(); h.$('commandDialog').open = true;
    for (const key of ['k', 'Enter']) for (const extra of ['shiftKey', 'altKey']) {
      assert.equal(h.keydown(key, { [primary]: true, [extra]: true, target: 'input' }).defaultPrevented, false);
    }
    assert.equal(h.keydown('Enter', { [primary]: true, target: 'input' }).defaultPrevented, false);
    assert.deepEqual(h.calls, []);
    assert.equal(h.keydown('k', { [primary]: true, target: 'input' }).defaultPrevented, true);
    assert.deepEqual(h.calls, ['commandDialog.close']);
  });
  test(`exact ${primary}+K remains available while editing outside dialogs`, () => {
    const h = setup();
    assert.equal(h.keydown('k', { [primary]: true, target: 'textarea' }).defaultPrevented, true);
    assert.deepEqual(h.calls, ['command.open']);
  });
}
