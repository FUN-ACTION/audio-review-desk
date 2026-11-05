import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const entrypoints = [
  'README.md', 'docs/README.en.md', 'docs/design.md', 'docs/artwork.md',
  'docs/showcase-media.md', 'docs/verification.md', 'docs/releases/README.md',
];
const links = text => [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
const localLinks = file => links(read(file)).filter(link => !/^(?:[a-z]+:|#)/i.test(link));

test('current documentation entrypoints link to unreleased maintenance verification', () => {
  const maintenance = resolve(root, 'docs/verification-2026-11-maintenance.md');
  for (const file of entrypoints) {
    const destinations = localLinks(file).map(link => resolve(root, dirname(file), link.split('#')[0]));
    assert.ok(destinations.includes(maintenance), `${file} must expose maintenance verification`);
  }
});

test('current documentation links resolve without replacing historical verification', () => {
  for (const file of [...entrypoints, 'docs/fonts.md']) {
    for (const link of localLinks(file)) {
      const [path, fragment] = link.split('#');
      const target = resolve(root, dirname(file), path);
      assert.ok(existsSync(target), `${file}: missing ${link}`);
      if (fragment && target.endsWith('.md')) {
        const headings = [...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)]
          .map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-'));
        assert.ok(headings.includes(decodeURIComponent(fragment)), `${file}: missing anchor ${link}`);
      }
    }
  }
  assert.match(read('docs/verification.md'), /^# Verification — 0\.13\.0/m);
  for (const file of ['README.md', 'docs/README.en.md', 'docs/design.md', 'docs/artwork.md', 'docs/showcase-media.md']) {
    assert.ok(localLinks(file).some(link => resolve(root, dirname(file), link) === resolve(root, 'docs/verification.md')),
      `${file} must retain the historical verification link`);
  }
});

test('design source links name active tour modules and the font notes name its declared family', () => {
  const tour = read('src/audio_review_desk/static/tour/tour.js');
  const imports = new Set([...tour.matchAll(/from\s+['"]\.\/([^'"?]+)(?:\?[^'"]*)?['"]/g)]
    .map(match => resolve(root, 'src/audio_review_desk/static/tour', match[1])));
  const designModules = localLinks('docs/design.md').filter(link => link.endsWith('.js'));
  assert.ok(designModules.length > 0);
  for (const link of designModules) {
    const target = resolve(root, 'docs', link);
    assert.ok(target === resolve(root, 'src/audio_review_desk/static/tour/tour.js') || imports.has(target),
      `Design describes an inactive tour module: ${link}`);
  }
  const family = read('src/audio_review_desk/static/tour/tour.css').match(/@font-face\s*\{\s*font-family:\s*"([^"]+)"/)[1];
  assert.ok(read('docs/fonts.md').includes(`\`${family}\``), 'Font notes must name the active tour font family');
});
