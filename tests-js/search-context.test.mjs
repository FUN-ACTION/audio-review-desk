import test from 'node:test';
import assert from 'node:assert/strict';
const { filterItems, searchTerms, reviewSearchContext } = await import(process.env.ARD_SEARCH_UI || new URL('../src/audio_review_desk/static/ui.js', import.meta.url));

const item = (note = '', markers = [], patch = {}) => ({ id: 'clip-12', label: 'Take １２.wav',
  quality: { flags: [] }, review: { status: 'fix', note, markers }, ...patch });
const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/ς/g, 'σ');
const context = (note, query) => reviewSearchContext(item(note), query);

for (const query of ['', '  \n\t ', 'take', '１２ wav', 'clip-12']) {
  test(`empty or identity-only search adds no annotation context: ${JSON.stringify(query)}`, () => {
    assert.equal(reviewSearchContext(item('take clip-12 fade', [{ time: 1, text: '１２ wav' }]), query), null);
  });
}

test('shared terms retain the established normalization and cross-field matching rules', () => {
  assert.deepEqual(searchTerms('  ＦＡＤＥ\n１２\t门响 '), ['fade', '12', '门响']);
  const row = item('Needs a tail fade', [{ time: 1.234, text: '门响 after verse' }]);
  assert.deepEqual(filterItems([row], '12 门响 fade', 'all', new Set()), [row]);
  assert.deepEqual(reviewSearchContext(row, '12 门响 fade'), { kind: 'note', time: null, excerpt: '…fade' });
  assert.deepEqual(filterItems([row], '12 missing fade', 'all', new Set()), []);
});

test('review and time notes expose their saved source without requiring every query term in one field', () => {
  assert.deepEqual(context('Needs a tail fade', 'fade'), { kind: 'note', time: null, excerpt: '…fade' });
  assert.deepEqual(reviewSearchContext(item('', [{ time: 0, text: 'Door click' }]), 'click'),
    { kind: 'marker', time: 0, excerpt: '…click' });
});

test('most unexplained terms wins, then review note, earliest marker and original tie order', () => {
  const row = item('noise', [{ time: 8, text: 'noise click' }, { time: 2, text: 'noise click earlier' }]);
  assert.deepEqual(reviewSearchContext(row, 'noise click'), { kind: 'marker', time: 2, excerpt: 'noise click earlier' });
  row.review.note = 'noise click review'; assert.equal(reviewSearchContext(row, 'noise click').kind, 'note');
  row.review.note = ''; row.review.markers.push({ time: 2, text: 'noise click later duplicate' });
  assert.equal(reviewSearchContext(row, 'noise click').excerpt, 'noise click earlier');
});

test('duplicate query terms and filename matches cannot inflate an annotation score', () => {
  const row = item('take fade', [{ time: 2, text: 'noise click' }]);
  const result = reviewSearchContext(row, 'take fade fade fade noise click');
  assert.equal(result.kind, 'marker'); assert.equal(result.excerpt, 'noise click');
});

test('context selection and excerpting never mutate source order or review contents', () => {
  const row = item('noise', [{ time: 8, text: 'noise click' }, { time: 2, text: 'noise click earlier' }]);
  const before = JSON.stringify(row);
  for (const marker of row.review.markers) Object.freeze(marker);
  Object.freeze(row.review.markers); Object.freeze(row.review); Object.freeze(row);
  assert.equal(reviewSearchContext(row, 'noise click').time, 2); assert.equal(JSON.stringify(row), before);
});

test('context reads no source path, audio, token or unsaved draft fields', () => {
  const row = item('saved needle');
  for (const key of ['source_path', 'audio', 'session', 'write_token', 'draft'])
    Object.defineProperty(row, key, { get() { assert.fail(`Read unrelated ${key}`); } });
  assert.equal(reviewSearchContext(row, 'needle').excerpt, '…needle');
});

test('short late-match Chinese notes start at the match rather than the hidden leading text', () => {
  const note = '前文'.repeat(42) + '门响之后'; assert.ok([...note].length < 100);
  assert.equal(context(note, '门响').excerpt, '…门响之后');
});

test('long late-match notes stay bounded and expose the matching tail', () => {
  const note = 'before '.repeat(500) + 'needle ' + 'after '.repeat(200);
  const result = context(note, 'needle');
  assert.ok(result.excerpt.startsWith('…needle ')); assert.ok(result.excerpt.endsWith('…'));
  assert.ok([...result.excerpt].length <= 100);
});

for (const [raw, query] of [['ＮＥＥＤＬＥ', 'needle'], ['ﬃ', 'ffi'], ['e\u0301cho', 'écho'],
  ['각', '각'], ['İ', 'i'], ['ΟΣ', 'ος'], ['ＡＢＣ', 'abc']]) {
  test(`normalized excerpts retain original graphemes: ${JSON.stringify(raw)}`, () => {
    const note = '前'.repeat(180) + raw + ' rest';
    const result = reviewSearchContext(item(note, [], { id: "row-42", label: "Take.wav" }), query);
    assert.ok(result.excerpt.startsWith(`…${raw}`), result.excerpt);
    assert.ok(normalize(result.excerpt).includes(normalize(query))); assert.ok([...result.excerpt].length <= 100);
  });
}

for (const term of ['a+b', '[needle]', 'a.b', '(x)', '?', '$', '\\', '*', '^']) {
  test(`case-insensitive original lookup treats regex punctuation literally: ${JSON.stringify(term)}`, () => {
    const original = term.toUpperCase(), result = context('prefix '.repeat(30) + original + ' tail', term);
    assert.equal(result.excerpt, `…${original} tail`);
  });
}

test('compatibility expansion before a literal late match cannot shift its original anchor', () => {
  assert.equal(context('ﬃ'.repeat(300) + 'needle 尾巴', 'needle').excerpt, '…needle 尾巴');
});

for (const sequence of ['👩‍👩‍👦', '🏳️‍🌈', '🇨🇳', 'e\u0301', '✈️']) {
  test(`excerpt boundaries never split the matching or trailing grapheme: ${JSON.stringify(sequence)}`, () => {
    const note = '前'.repeat(80) + sequence.repeat(100) + 'tail';
    const result = context(note, sequence);
    const body = result.excerpt.replace(/^…/, '').replace(/…$/, '');
    assert.ok(body.startsWith(sequence)); assert.ok([...result.excerpt].length <= 100);
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(body)].map(x => x.segment);
    assert.ok(segments.every(part => part === sequence), body);
  });
}

test('an oversized single grapheme is replaced by a source-only ellipsis instead of being split', () => {
  const note = 'prefix ' + 'a' + '\u0301'.repeat(150) + ' tail';
  assert.equal(context(note, 'á').excerpt, '…');
});

test('without grapheme support, ASCII stays useful and non-ASCII cropping fails safely', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
  try {
    assert.equal(context('prefix needle tail', 'needle').excerpt, '…needle tail');
    assert.equal(context('门响 short', '门响').excerpt, '门响 short');
    assert.equal(context('前'.repeat(40) + '门响', '门响').excerpt, '…');
  } finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
});

test('HTML-like text is returned verbatim as bounded data, not interpreted or removed', () => {
  const result = context('<script>alert(1)</script> <img onerror=evil()>', '<script>');
  assert.equal(result.excerpt, '<script>alert(1)</script> <img onerror=evil()>');
});

test('malformed annotation values cannot manufacture context or stop the search', () => {
  assert.equal(reviewSearchContext(item(42, { text: 'needle' }), 'needle'), null);
  const row = item('', [null, { time: -1, text: 'needle' }, { time: Infinity, text: 'needle' },
    { time: 2, text: 42 }, { time: 0, text: 'needle valid' }]);
  assert.deepEqual(reviewSearchContext(row, 'needle'), { kind: 'marker', time: 0, excerpt: 'needle valid' });
});

for (const [prefix, term] of [['a\u030A', 'a'], ['n\u0303', 'n'], ['A\u030A', 'a']]) {
  test(`literal matches inside a normalized-away grapheme cannot hide the real hit: ${JSON.stringify(prefix)}`, () => {
    const row = item(prefix + '甲'.repeat(180) + `${term} hit`, [], { id: '42', label: 'xyz' });
    assert.deepEqual(filterItems([row], term, 'all', new Set()), [row]);
    const result = reviewSearchContext(row, term);
    assert.equal(result.excerpt, `…${term} hit`);
    assert.ok(normalize(result.excerpt).includes(term));
  });
}

test('Greek final sigma is now a verified normalized hit at its original position', () => {
  const row = item('ΟΣ ' + '甲'.repeat(180) + ' ΣIGMA', [], { id: '42', label: 'xyz' });
  assert.deepEqual(filterItems([row], 'σ', 'all', new Set()), [row]);
  assert.ok(reviewSearchContext(row, 'σ').excerpt.startsWith('…Σ '));
  assert.ok(!reviewSearchContext(row, 'σ').excerpt.includes('ΣIGMA'));
});

test('a short note cannot take the unverified original-index zero fast path', () => {
  const row = item('a\u030A' + '甲'.repeat(80) + 'a hit', [], { id: '42', label: 'xyz' });
  assert.equal(reviewSearchContext(row, 'a').excerpt, '…a hit');
});
