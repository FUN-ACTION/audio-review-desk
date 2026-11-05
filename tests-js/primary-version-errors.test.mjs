import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMessages, errorText } from '../src/audio_review_desk/static/errors.js';

for (const code of ['primary_unverified', 'primary_version_collision']) {
  test(`${code} gives localized recovery guidance without raw diagnostics`, () => {
    const diagnostic = { code, error: 'private filesystem path' };
    assert.equal(errorText(diagnostic, 'en'), errorMessages[code][1]);
    assert.equal(errorText(diagnostic, 'zh'), errorMessages[code][0]);
    assert.match(errorText(diagnostic, 'en'), /Back up the whole workspace/);
    assert.match(errorText(diagnostic, 'zh'), /备份整个工作区/);
    assert.doesNotMatch(errorText(diagnostic, 'en'), /private filesystem/);
    assert.match(errorText(diagnostic, 'en'), /new review/);
  });
}
