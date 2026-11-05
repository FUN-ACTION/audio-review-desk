import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountTransport } from '../src/audio_review_desk/static/transport.js';
import { createListeningMemory } from '../src/audio_review_desk/static/listening.js';
import { words } from '../src/audio_review_desk/static/copy.js';
const read = name => readFileSync(new URL(`../src/audio_review_desk/static/${name}`, import.meta.url), 'utf8');
const css = read('workbench.css'), studio = read('workbench-studio.css'), html = read('workbench.html'), source = read('workbench.js');
const mobile = css.slice(css.indexOf('@media (max-width: 720px)'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
const rule = selector => mobile.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}'))?.[1] || '';

test('one native named volume range retains transport DOM order and bounds', () => {
 assert.equal([...html.matchAll(/id="volume"/g)].length, 1);
 const input = html.match(/<input\s+id="volume"[^>]+>/)[0];
 for (const attribute of ['type="range"', 'min="0"', 'max="1"', 'step="0.01"', 'aria-label="Volume"']) assert.ok(input.includes(attribute));
 assert.doesNotMatch(input, /tabindex|hidden/);
 assert.ok(html.indexOf('id="skipForward"') < html.indexOf('id="volume"'));
 assert.ok(html.indexOf('id="volume"') < html.indexOf('id="loop"'));
});
test('mobile volume has its own shrinkable row and a 32px input box, without later studio overrides', () => {
 assert.match(mobile, /\.transport\s*\{[^}]*flex-wrap:\s*wrap;/);
 assert.match(rule('.transport .volume-control'), /display:\s*flex;/);
 assert.match(rule('.transport .volume-control'), /flex:\s*0 0 100%;/);
 assert.match(rule('.transport .volume-control'), /margin-left:\s*0;/);
 assert.match(rule('.transport .volume-control input'), /flex:\s*0 1 160px;/);
 assert.match(rule('.transport .volume-control input'), /min-width:\s*0;/);
 assert.match(rule('.transport .volume-control input'), /height:\s*32px;/);
 assert.doesNotMatch(mobile, /\.volume-control,\s*\.playback-shortcut/);
 // All existing later rules are less specific and contain no !important.
 const later = [...studio.matchAll(/([^{}]*\.volume-control[^{}]*)\{([^}]+)\}/g)];
 assert.ok(later.length > 0);
 for (const [, selector, declarations] of later) {
  assert.ok(['.volume-control', '.volume-control input'].includes(selector.trim()));
  assert.doesNotMatch(declarations, /!important|display\s*:|height\s*:|flex\s*:|min-width\s*:/);
 }
});
function element() {
 const listeners = new Map();
 return { value: '', listeners, addEventListener(type, fn) { listeners.set(type, fn); },
  emit(type) { listeners.get(type)?.(); }, setAttribute() {},
  classList: { add() {}, remove() {}, toggle() {} } };
}
for (const initial of [0, 0.37]) test(`actual transport input and preference restoration preserve ${initial} until user changes it`, () => {
 const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
 const saved = new Map(), storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
 const memory = createListeningMemory(storage, 'synthetic'); memory.preferences({ volume: initial });
 let plays = 0;
 const player = Object.assign(element(), { volume: 1, paused: true, play() { plays++; return Promise.resolve(); } });
 const restoreStart = source.indexOf('      const preferences = listeningMemory.get();');
 const restoreLast = '      $("rememberPosition").checked = preferences.remember;';
 const restoreEnd = source.indexOf(restoreLast, restoreStart);
 assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
 // End at the preference assignment itself, not a later selection lifecycle.
 const restore = source.slice(restoreStart, restoreEnd + restoreLast.length);
 const apply = listeningMemory => Function('$', 'player', 'listeningMemory', restore)($, player, listeningMemory);
 apply(memory); assert.equal(player.volume, initial);
 mountTransport({ player, button: $('play'), seek: $('seek'), back: $('back'), forward: $('forward'), volume: $('volume'),
  range: () => [0, 10], loop: { checked: false }, onTime() {}, onError() {}, labels: () => ({ play: 'Play', pause: 'Pause' }) });
 const start = source.indexOf('$("volume").addEventListener("change"'), end = source.indexOf('$("rememberPosition").addEventListener', start);
 assert.ok(start >= 0 && end > start);
 Function('$', 'player', 'listeningMemory', source.slice(start, end))($, player, memory);
 assert.equal(player.volume, initial, 'mounting cannot unmute or reset');
 $('volume').value = '0.64'; $('volume').emit('input'); assert.equal(player.volume, 0.64);
 $('volume').emit('change'); apply(createListeningMemory(storage, 'synthetic'));
 assert.equal(player.volume, 0.64); assert.equal(Number($('volume').value), 0.64); assert.equal(plays, 0);
});
test('production translation includes volume in its localized accessible-name mapping', () => {
 const start = source.indexOf('  for (const [id, key] of [\n    ["seek", "position"]');
 const end = source.indexOf('  for (const label of', start);
 assert.ok(start >= 0 && end > start);
 for (const language of ['en', 'zh']) {
  const names = new Map();
  Function('$', 't', source.slice(start, end))(id => ({ setAttribute(name, value) { names.set(`${id}:${name}`, value); } }), key => words[language][key]);
  assert.equal(names.get('volume:aria-label'), language === 'en' ? 'Volume' : '音量');
 }
});
// CSS assertions establish authored rules, not computed geometry, native range
// key behavior, touch hit-testing, browser audio output or visual acceptance.
