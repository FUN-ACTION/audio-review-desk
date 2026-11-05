import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the production B control rule and selection guard, without a browser.
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const rule = source.match(/\$\("variantB"\)\.disabled = [^;]+;/)?.[0];
assert.ok(rule);
const start = source.indexOf('async function switchVariant(next)');
const end = source.indexOf('function showImportError', start);
assert.ok(start >= 0 && end > start);
for (const decoded of [false, true]) {
  for (const digest of [null, 'a'.repeat(64)]) {
    test(`a byte digest does not enable B (decoded=${decoded}, digest=${!!digest})`, async () => {
      const item = { quality: { decoded }, reference_sha256: digest };
      const button = { disabled: false };
      Function('$', 'item', 'busy', rule)(() => button, item, false);
      assert.equal(button.disabled, true);
      const select = Function('selected', `let variant = 'a'; ${source.slice(start, end)}; return switchVariant;`)(item);
      // All other playback globals are absent: reaching them fails this test.
      await select('b');
    });
  }
}
test('healthy B remains selectable, and busy disables its control', () => {
  const item = { quality: { decoded: true }, reference_quality: { decoded: true } };
  for (const busy of [false, true]) {
    const button = {};
    Function('$', 'item', 'busy', rule)(() => button, item, busy);
    assert.equal(button.disabled, busy);
  }
});


test('reference recovery errors have localized actionable guidance', async () => {
  const { errorText } = await import('../src/audio_review_desk/static/errors.js');
  for (const language of ['en', 'zh']) {
    for (const code of ['reference_unverified', 'source_unavailable', 'reference_legacy_collision']) {
      const text = errorText({ code }, language);
      assert.notEqual(text, errorText({ code: 'operation_failed' }, language));
      assert.match(text, language === 'en' ? /workspace/ : /工作区/);
    }
  }
});
