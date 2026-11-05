import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copy } from '../src/audio_review_desk/static/tour/tour-copy.js';
import { createMusicPlayer } from '../src/audio_review_desk/static/tour/music-player.js';
const source = readFileSync(new URL('../src/audio_review_desk/static/tour/tour.js', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  onError: (_error, kind) => {') + '  onError: '.length, source.indexOf('\n});\nfunction paintMusic')).trim().replace(/,$/, '');
const translation = source.slice(source.indexOf('function translate() {'), source.indexOf("$('languageToggle').addEventListener"));
function ui() {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { hidden: true, dataset: {}, setAttribute() {} }); return nodes.get(id); };
  const document = { documentElement: {}, querySelector: () => $('stub'), querySelectorAll: () => [] };
  // Run the production callback and complete translate function. Unrelated
  // motion/workspace/card painters are inert; error routing is not replaced.
  return Function('$', 'document', 'copy', `let language = 'zh'; const t = key => copy[language][key] || key;
    const paintWorkspaceLink = () => {}, paintMusic = () => {}, paintMotion = () => {}; let examples;
    const onError = ${callback}; ${translation}
    return { onError, node: $('musicError'), translate(languageValue) { language = languageValue; translate(); } };`)($, document, copy);
}
for (const [kind, key] of [['unavailable', 'musicUnavailable'], ['resume', 'musicResumeError'], ['decode', 'musicDecodeError'], ['unsupported', 'musicUnsupported'], ['playback', 'musicPlaybackError'], [undefined, 'musicPlaybackError'], ['__proto__', 'musicPlaybackError']]) {
  test(`production UI error ${kind} retains classification through language changes`, () => {
    const view = ui(); view.onError(new Error('PRIVATE SENTINEL'), kind);
    assert.equal(view.node.hidden, false); assert.equal(view.node.dataset.errorKey, key);
    for (const language of ['en', 'zh', 'en']) {
      view.translate(language); assert.equal(view.node.textContent, copy[language][key]);
      assert.ok(!view.node.textContent.includes('PRIVATE SENTINEL'));
    }
  });
}
for (const failure of ['missing', 'resume']) {
  test(`actual player ${failure} reaches production UI without blaming a file`, async () => {
    const view = ui();
    const runtime = { cancelAnimationFrame() {} };
    if (failure === 'resume') runtime.AudioContext = class {
      async resume() { const error = new Error('restricted'); error.name = 'NotAllowedError'; throw error; }
      async close() {}
    };
    const player = createMusicPlayer({ onError: view.onError }, runtime);
    await player.toggle();
    assert.equal(view.node.dataset.errorKey, failure === 'missing' ? 'musicUnavailable' : 'musicResumeError');
    assert.equal(player.state.name, ''); assert.equal(player.state.pending, false);
    view.translate('en'); assert.ok(!view.node.textContent.includes('file')); player.dispose();
  });
}

test('production play click hides a prior error before retry without clearing its language key', () => {
  const view = ui(); view.onError(new Error('old'), 'resume');
  const handler = source.slice(source.indexOf("$('musicPlay').addEventListener('click', () => {") + "$('musicPlay').addEventListener('click', ".length, source.indexOf("\n$('chooseMusic')")).trim().replace(/\);$/, '');
  let paused = 0, toggled = 0;
  const click = Function('$', 'examples', 'music', `return (${handler});`)(() => view.node, { pause() { paused++; } }, { toggle() { toggled++; } });
  click(); assert.equal(view.node.hidden, true); assert.equal(paused, 1); assert.equal(toggled, 1);
  view.translate('en'); assert.equal(view.node.hidden, true); assert.equal(view.node.dataset.errorKey, 'musicResumeError');
});
