import { normalizeSearch, searchTerms } from "../src/audio_review_desk/static/ui.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { words } from '../src/audio_review_desk/static/copy.js';
const read = name => readFileSync(new URL(`../src/audio_review_desk/static/${name}`, import.meta.url), 'utf8');
const module = read('commands.js').replace(/^import .*\n/gm, '').replaceAll('export function', 'function');
const workbench = read('workbench.js');
// Production command module and language handlers with DOM doubles. This does
// not establish browser focus behavior or screen-reader announcement delivery.
function fixture(language = 'en') {
  let writes = 0; const nodes = new Map(), calls = [];
  const node = (tag = 'div') => ({ tag, attrs: {}, children: [], listeners: {}, dataset: {}, value: '', hidden: true, open: false,
    textContent: '', classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(k, v) { this.listeners[k] = v; }, append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; }, querySelectorAll() { return []; },
    scrollIntoView() {}, focus() { env.document.activeElement = this; }, close() { this.open = false; },
  });
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  let text = ''; Object.defineProperty($('commandEmptyStatus'), 'textContent', { get: () => text, set: value => { text = value; writes++; } });
  const env = { normalizeSearch, searchTerms, validateNote: () => {}, savingReview: null, dirty: false, $, language, document: { createElement: node, documentElement: {}, querySelectorAll: () => [], activeElement: null },
    openDialog: dialog => { dialog.open = true; },
    rows: () => ['save', 'help'].map(key => ({ label: words[env.language][key], run: () => calls.push(key) })),
    t: key => words[env.language][key], onError: error => { throw error; },
    spectrumView: { setLanguage() {} }, state: null, job: null, markersView: null,
    transport: { refresh() {} }, draftSession: null, updateLibraryToggle() {}, paintRescanReceipt() {},
    noticeResolver: null, noticeTimer: null, clearTimeout() {},
  };
  vm.createContext(env);
  vm.runInContext(`${module}\nvar commandMenu = mountCommands({ dialog: $('commandDialog'), input: $('commandInput'), list: $('commandList'), emptyStatus: $('commandEmptyStatus'), rows, emptyText: () => t('commandEmpty'), onError });`, env);
  const translate = workbench.slice(workbench.indexOf('function translate()'), workbench.indexOf('\nfunction paintRescanReceipt()'));
  vm.runInContext(translate, env);
  const start = workbench.indexOf('$("language").addEventListener("change", () => {');
  const end = workbench.indexOf('\n});', start) + 4;
  vm.runInContext(workbench.slice(start, end), env);
  const query = value => { $('commandInput').value = value; $('commandInput').listeners.input({}); };
  const key = (value, flags = {}) => { let prevented = false; $('commandInput').listeners.keydown({ key: value, preventDefault() { prevented = true; }, ...flags }); return prevented; };
  return { $, env, calls, query, key, get writes() { return writes; }, open() { env.commandMenu.open(); },
    language(value) { $('language').value = value; $('language').listeners.change(); } };
}

test('empty feedback is a persistent polite status outside the listbox', () => {
  assert.match(read('workbench.html'), /<div id="commandList" role="listbox"><\/div>\s*<p id="commandEmptyStatus" class="command-empty" role="status" aria-live="polite" aria-atomic="true"><\/p>/);
  assert.match(workbench, /emptyStatus: \$\("commandEmptyStatus"\)/);
});

test('matching, empty and recovered queries keep only options selected', () => {
  const f = fixture(); f.open();
  assert.equal(f.$('commandList').children.length, 2);
  f.key('ArrowDown'); assert.equal(f.$('commandInput').attrs['aria-activedescendant'], 'command-1');
  f.query('no-such-command');
  assert.equal(f.$('commandList').children.length, 0);
  assert.equal(f.$('commandEmptyStatus').textContent, words.en.commandEmpty);
  assert.equal(f.$('commandEmptyStatus').attrs['aria-selected'], undefined);
  assert.equal(f.$('commandInput').attrs['aria-activedescendant'], undefined);
  const writes = f.writes; f.query('still-no-such-command'); assert.equal(f.writes, writes);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) assert.equal(f.key(key), true);
  assert.deepEqual(f.calls, []); assert.equal(f.$('commandDialog').open, true);
  assert.equal(f.$('commandInput').attrs['aria-activedescendant'], undefined);
  f.query(''); assert.equal(f.$('commandEmptyStatus').textContent, '');
  assert.deepEqual(f.$('commandList').children.map(n => n.attrs.role), ['option', 'option']);
  assert.deepEqual(f.$('commandList').children.map(n => n.attrs['aria-selected']), ['true', 'false']);
  f.key('ArrowUp'); f.key('Enter'); assert.deepEqual(f.calls, ['help']);
  assert.equal(f.$('commandDialog').open, false);
});

for (const initial of ['en', 'zh']) test(`actual language-change handler updates open empty feedback from ${initial}`, () => {
  const f = fixture(initial); f.open(); f.query('no-such-command');
  const focus = f.env.document.activeElement;
  const next = initial === 'en' ? 'zh' : 'en'; f.language(next);
  assert.equal(f.$('commandEmptyStatus').textContent, words[next].commandEmpty);
  assert.equal(f.$('commandInput').value, 'no-such-command'); assert.equal(f.env.document.activeElement, focus);
  assert.equal(f.$('commandList').children.length, 0); assert.equal(f.$('commandInput').attrs['aria-activedescendant'], undefined);
  f.query(''); f.key('ArrowDown'); f.language(initial);
  assert.equal(f.$('commandInput').attrs['aria-activedescendant'], 'command-1');
  assert.equal(f.$('commandList').children[1].children[0].textContent, words[initial].help);
  assert.equal(f.$('commandEmptyStatus').textContent, '');
});

test('closing and reopening clears a stale empty query and uses current language', () => {
  const f = fixture(); f.open(); f.query('missing'); f.$('commandDialog').close();
  const writes = f.writes; f.language('zh'); assert.equal(f.writes, writes);
  f.open(); assert.equal(f.$('commandInput').value, ''); assert.equal(f.$('commandEmptyStatus').textContent, '');
  assert.equal(f.$('commandList').children[0].children[0].textContent, words.zh.save);
});
