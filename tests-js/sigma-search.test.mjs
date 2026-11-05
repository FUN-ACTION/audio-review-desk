import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, searchTerms, searchText, filterItems, reviewSearchContext } from '../src/audio_review_desk/static/ui.js';
import { findCommands } from '../src/audio_review_desk/static/commands.js';
const item = (patch = {}) => ({ id: 'clip', label: 'Take.wav', key: 'key', quality: { flags: [] },
  review: { status: 'pending', note: '', markers: [] }, ...patch });
for (const raw of ['Σ', 'σ', 'ς']) for (const query of ['Σ', 'σ', 'ς']) {
  test(`sigma search is shared across fields and commands: ${raw}/${query}`, () => {
    assert.equal(normalizeSearch(raw), 'σ'); assert.deepEqual(searchTerms(query), ['σ']);
    for (const field of ['label', 'id', 'note', 'marker']) {
      const row = item();
      if (field === 'label' || field === 'id') row[field] = raw;
      else if (field === 'note') row.review.note = raw;
      else row.review.markers = [{time: 1.25, text: raw}];
      const before = JSON.stringify(row);
      assert.deepEqual(filterItems([row], query, 'all', new Set()), [row]);
      const command = { label: row.label, search: searchText(row) };
      assert.deepEqual(findCommands([command], query), [command]);
      const context = reviewSearchContext(row, query);
      if (field === 'label' || field === 'id') assert.equal(context, null);
      else assert.deepEqual(context, {kind: field === 'note' ? 'note' : 'marker', time: field === 'note' ? null : 1.25, excerpt: raw});
      assert.equal(JSON.stringify(row), before);
    }
  });
}
test('literal uppercase Greek prefix matches filename and direct command label', () => {
  const row = item({label:'ΟΣΑ.wav'}), command = {label:'ΟΣΑ.wav'};
  for (const query of ['ΟΣ', 'οσ', 'ος']) {
    assert.deepEqual(filterItems([row], query, 'all', new Set()), [row]);
    assert.deepEqual(findCommands([command], query), [command]);
  }
});
for (const prefix of ['ﬃ'.repeat(300), 'İ'.repeat(180), 'a\u030A'.repeat(180), '👩‍👩‍👦'.repeat(100)]) {
  test(`sigma excerpt uses original offsets after ${JSON.stringify(prefix.slice(0, 8))}`, () => {
    const row = item(); row.review.note = prefix + 'ΟΣΑ tail';
    for (const query of ['ΟΣ', 'ος']) {
      assert.deepEqual(filterItems([row], query, 'all', new Set()), [row]);
      assert.equal(reviewSearchContext(row, query).excerpt, '…ΟΣΑ tail');
    }
  });
}
test('sigma cropping keeps trailing emoji and combining graphemes intact', () => {
  const row = item(); row.review.note = '前'.repeat(180) + 'ΟΣΑ ' + '👩‍👩‍👦e\u0301'.repeat(80);
  const excerpt = reviewSearchContext(row, 'ος').excerpt;
  assert.ok(excerpt.startsWith('…ΟΣΑ ')); assert.ok([...excerpt].length <= 100);
  const parts = [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(excerpt.slice(1,-1))].map(x=>x.segment);
  assert.ok(parts.every(p=>['Ο','Σ','Α',' ','👩‍👩‍👦','e\u0301'].includes(p)));
});
test('without Segmenter, long sigma context falls back without slicing folded offsets', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl,'Segmenter',{value:undefined,configurable:true});
  try {
    const row=item(); row.review.note='ﬃ'.repeat(180)+'ΟΣΑ';
    assert.equal(filterItems([row],'ος','all',new Set()).length,1);
    assert.equal(reviewSearchContext(row,'ος').excerpt,'…');
  } finally { Object.defineProperty(Intl,'Segmenter',descriptor); }
});
test('sigma folding does not introduce accent removal, transliteration or sharp-s expansion', () => {
  for(const [label,query] of [['Straße','strasse'],['café','cafe'],['ΟΣΑ','osa']]) {
    assert.equal(filterItems([item({label})],query,'all',new Set()).length,0);
    assert.equal(findCommands([{label}],query).length,0);
  }
  assert.equal(normalizeSearch('ＦＡＤＥ１２'),'fade12');
  assert.equal(normalizeSearch('e\u0301'),'é');
});
test('large catalogs retain status intersections, AND terms, command limit and source bytes', () => {
  const statuses=['pending','pass','fix','exclude'];
  const rows=Array.from({length:10000},(_,i)=>item({id:String(i),key:String(i),label:`ΟΣΑ ${i}.wav`,review:{status:statuses[i%4],note:'门响',markers:[]}}));
  const before=JSON.stringify(rows);
  for(const status of statuses) assert.equal(filterItems(rows,'ος 门响',status,new Set()).length,2500);
  assert.equal(filterItems(rows,'ος missing','all',new Set()).length,0);
  const commands=rows.map(row=>({label:row.label,search:searchText(row)}));
  assert.deepEqual(findCommands(commands,'ος 门响'),commands.slice(0,16));
  assert.equal(JSON.stringify(rows),before);
});
