import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { words } from '../src/audio_review_desk/static/copy.js';
import { filterItems, hasItemWarnings, queueStamp, reviewPayload } from '../src/audio_review_desk/static/ui.js';

const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const ending = 'mp4_extent_exceeds_file', incomplete = 'mp4_check_incomplete', indexed = 'mp4_indexed_audio_bytes_unavailable';
const make = (a = [], b = []) => ({ key: 'same-key', id: 'clip', label: 'Clip', eligible: true,
  quality: { flags: a, decoded: true, duration: 2 }, reference_quality: { flags: b, decoded: true },
  review: { version: 7, status: 'pass', note: 'Keep', markers: [] } });
// Execute the production detail flag renderer. These controlled DOM checks do
// not establish native rendering, decoder behavior or recording completeness.
function render(item, language = 'en') {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { hidden: false, replaceChildren(...children) { this.children = children; } }); return nodes.get(id); };
  const code = source.slice(source.indexOf('  const names = {', source.indexOf('function renderDetails(')), source.indexOf('  $("audioSection").hidden', source.indexOf('function renderDetails(')));
  assert.ok(code.includes('qualityFlags'));
  Function('$', 'document', 'item', 'q', 't', 'errorText', 'language', code)(
    $, { createElement: () => ({}) }, item, item.quality, key => words[language][key], () => 'A could not decode', language);
  return $('qualityFlags');
}
for (const language of ['zh', 'en']) {
  test(`${language}: A and B MP4 advisories are explicit and check-incomplete is neutral`, () => {
    const item = make([ending], [incomplete]), before = JSON.stringify(item);
    const panel = render(item, language);
    assert.equal(panel.hidden, false);
    assert.deepEqual(panel.children.map(row => row.textContent), [
      `A: ${words[language].mp4ExtentExceedsFile}`, `B: ${words[language].mp4CheckIncomplete}`,
    ]);
    assert.equal(panel.children[0].className, 'flag');
    assert.equal(panel.children[1].className, 'flag neutral');
    assert.equal(JSON.stringify(item), before);
  });
  test(`${language}: B-only extent advisory is visible without a misleading A success badge`, () => {
    const panel = render(make([], [ending]), language);
    assert.equal(panel.hidden, false);
    assert.equal(panel.children.length, 1);
    assert.equal(panel.children[0].textContent, `B: ${words[language].mp4ExtentExceedsFile}`);
    assert.equal(panel.children[0].className, 'flag');
  });
}
for (const flag of [ending, incomplete, indexed]) {
  test(`${flag}: B-only warnings enter the queue once, without changing status filters`, () => {
    const warned = make([], [flag]);
    assert.equal(hasItemWarnings(warned), true);
    assert.deepEqual(filterItems([warned], '', 'warnings', new Set()), [warned]);
    assert.deepEqual(filterItems([warned], '', 'pass', new Set()), [warned]);
    assert.deepEqual(filterItems([warned], '', 'pending', new Set()), []);
    assert.equal(filterItems([make(['near_full_scale', flag], [flag])], '', 'warnings', new Set()).length, 1);
    const start = source.indexOf('        duration.textContent =');
    const code = source.slice(start, source.indexOf('        status.textContent =', start));
    const duration = { children: [], append(...nodes) { this.children.push(...nodes); } };
    const document = { createElement: () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }) };
    Function('duration', 'item', 'formatTime', 'hasItemWarnings', 'document', 't', code)(
      duration, warned, () => '0:02', hasItemWarnings, document, key => words.en[key]);
    assert.equal(duration.textContent, '0:02');
    assert.equal(duration.children[0].textContent, ' · !');
    assert.equal(duration.children[0].attributes['aria-hidden'], 'true');
    assert.equal(duration.children[1].className, 'sr-only');
    assert.equal(duration.children[1].textContent, ' · Needs attention');
  });
  test(`${flag}: same-key B change invalidates queue rendering and removal restores clean state`, () => {
    const clean = make(), warned = make([], [flag]);
    assert.notEqual(queueStamp([clean], 'en'), queueStamp([warned], 'en'));
    assert.equal(hasItemWarnings(clean), false);
    assert.equal(render(clean).hidden, true);
    assert.deepEqual(render(clean).children, []);
    assert.deepEqual(filterItems([clean], '', 'warnings', new Set()), []);
  });
}
test('A failure does not hide or label a B check-incomplete advisory as an error', () => {
  const item = make(['decode_error'], [incomplete]); item.error = 'failed';
  const panel = render(item);
  assert.equal(panel.children[0].className, 'flag error');
  assert.equal(panel.children[1].textContent, `B: ${words.en.mp4CheckIncomplete}`);
  assert.equal(panel.children[1].className, 'flag neutral');
});
test('advisories do not enter review payload, change version identity or manufacture a review decision', () => {
  const clean = make(), flagged = make([ending], [incomplete]);
  const values = { status: 'pass', score: '5', trimStart: '', trimEnd: '', issues: [], note: 'Keep', markers: [] };
  assert.deepEqual(reviewPayload(flagged, values), reviewPayload(clean, values));
  assert.equal(reviewPayload(flagged, values).key, 'same-key');
});
test('both languages distinguish extent overrun from incomplete check without claiming corruption', () => {
  for (const language of ['en', 'zh']) {
    const { mp4ExtentExceedsFile: endingText, mp4CheckIncomplete: checkText } = words[language];
    assert.notEqual(endingText, checkText);
    assert.match(endingText, language === 'en' ? /may be incomplete or metadata inconsistent/ : /不完整或元数据不一致/);
    assert.match(checkText, language === 'en' ? /could not be determined/ : /无法判断/);
    assert.doesNotMatch(`${endingText} ${checkText}`, /corrupt|reject|损坏|拒绝/i);
  }
});

for (const language of ['en', 'zh']) {
  for (const side of ['a', 'b']) {
    test(`${language}: ${side} indexed-byte advisory is nonblocking and explicitly attributed`, () => {
      const item = make(side === 'a' ? [indexed] : [], side === 'b' ? [indexed] : []);
      const before = JSON.stringify(item), panel = render(item, language);
      assert.equal(panel.children.length, 1);
      assert.equal(panel.children[0].textContent, `${side.toUpperCase()}: ${words[language].mp4IndexedBytesUnavailable}`);
      assert.equal(panel.children[0].className, 'flag');
      assert.equal(JSON.stringify(item), before);
      assert.doesNotMatch(panel.children[0].textContent, /corrupt|reject|complete recording|损坏|拒绝/i);
    });
  }
}
test('indexed-byte wording does not claim why the indexed bytes are unavailable', () => {
  assert.equal(words.en.mp4IndexedBytesUnavailable, 'Some indexed audio bytes unavailable or container metadata inconsistent');
});
