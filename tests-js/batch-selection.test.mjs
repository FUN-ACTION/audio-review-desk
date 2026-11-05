import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { words } from '../src/audio_review_desk/static/copy.js';
import { filterItems, hasItemWarnings, sortItems, queueStamp, formatTime, searchTerms, reviewSearchContext } from '../src/audio_review_desk/static/ui.js';
import { formatMarkerTime } from '../src/audio_review_desk/static/markers.js';

// Actual filtering, selection-summary, clear-selection and queue rendering.
// Small DOM doubles verify state and focus rules, not browser geometry or AT.
const file = process.env.ARD_SELECTION_WORKBENCH || fileURLToPath(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url));
const source = readFileSync(file, 'utf8'), html = readFileSync(resolve(dirname(file), 'workbench.html'), 'utf8');
const css = readFileSync(resolve(dirname(file), 'workbench.css'), 'utf8');
const code = source.slice(source.indexOf('function visibleItems()'), source.indexOf('function draftValues()')) + '\n' +
  source.slice(source.indexOf('for (const id of ["search", "filter", "sort"])'), source.indexOf('for (const [id, direction]'));
const item = key => ({ key, id: key, label: `Clip ${key}`, quality: { duration: 10, flags: [] }, review: { version: 0, status: 'pending', note: '', markers: [] } });
function setup({ keys = ['A', 'B', 'C'], language = 'en' } = {}) {
  const elements = new Map(), focuses = [], selections = [], detailCalls = [], moves = [], document = { activeElement: null };
  class Element {
    constructor(id = '') { this.id = id; this.tagName = id; this.children = []; this.value = ''; this.textContent = ''; this.checked = false; this.hidden = false; this.disabled = false; this.indeterminate = false; this.attributes = new Map(); this.style = {}; this.events = new Map(); const classes = new Set(); this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) }; }
    append(...nodes) { nodes.forEach(node => { node.parentElement = this; }); this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    set innerHTML(_) { assert.fail('Queue content must use textContent, not HTML'); }
    get offsetHeight() { return this.classList.contains('has-search-context') ? 100 : 66; }
    get offsetTop() { return (this.parentElement?.children || []).slice(0, this.parentElement.children.indexOf(this)).reduce((total, row) => total + row.offsetHeight, 0); }
    querySelector(query) { return this.children.find(node => query === 'input' ? node.tagName === 'input' : query === '.clip' ? node.className === 'clip' : false) || null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(name, fn) { this.events.set(name, fn); }
    focus(options) { if (this.disabled || this.hidden) return; document.activeElement = this; focuses.push({ id: this.id, options }); }
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  document.body = $('body'); document.activeElement = document.body;
  document.createElement = tag => new Element(tag); document.querySelectorAll = () => [];
  $('search').value = ''; $('filter').value = 'all'; $('sort').value = 'name';
  $('note').value = 'Unsaved review draft'; $('score').value = '0'; $('trimStart').value = '0.123456';
  const initial = { items: keys.map(item), stats: { duplicate_groups: [] } };
  const env = { $, document, initial, filterItems, hasItemWarnings, sortItems, queueStamp, formatTime, searchTerms, reviewSearchContext, formatMarkerTime, words, language, moveQueue: (...args) => moves.push(args), renderDetails: restore => detailCalls.push(restore), select: row => selections.push(row.key) };
  const control = Function(...Object.keys(env), `
    let state = initial, selected = state.items[0], busy = false, dirty = true, visibleCache = null,
      renderedQueueStamp = '', highlightedKey = null, queueHasPosition = false;
    const queueRows = new Map(), selectedKeys = new Set(), t = key => words[language][key] || key;
    ${code}
    renderQueue();
    return { renderQueue, renderSelection, selectedKeys, queueRows,
      clear: typeof clearSelection === 'function' ? clearSelection : null,
      setBusy(value) { busy = value; renderQueue(); },
      setLanguage(value) { language = value; renderQueue(); },
      replaceItems(items) { state = { ...state, items }; renderQueue(); },
      chooseKey(key) { selected = state.items.find(row => row.key === key); renderQueue(); },
      get current() { return { state, selected, busy, dirty }; } };
  `)(...Object.values(env));
  return { $, document, focuses, selections, detailCalls, moves, ...control, get current() { return control.current; },
    check(...keys) { keys.forEach(key => control.selectedKeys.add(key)); control.renderQueue(); },
    search(query) { $('search').value = query; control.renderQueue(); },
    inputSearch(query, isComposing = false) { $('search').value = query; $('search').events.get('input')({ isComposing }); },
    filter(value) { $('filter').value = value; control.renderQueue(); },
  };
}

test('batch context uses native non-submit controls and a visible selected count', () => {
  assert.match(html, /<button\b[^>]*id="clearSelection"[^>]*type="button"/);
  assert.match(html, /<button\b[^>]*id="applyBatch"[^>]*aria-describedby="selectedCount batchSelectionHint"/);
  assert.match(html, /<span\b[^>]*id="selectedCount"[^>]*role="status"/);
  assert.match(html, /<p\b[^>]*id="batchSelectionHint"[^>]*role="status"/);
  assert.doesNotMatch(css.match(/#selectedCount\s*\{[^}]*\}/)?.[0] || '', /display:\s*none/);
  assert.match(source, /\$\("clearSelection"\)\.addEventListener\("click", clearSelection\)/);
});

test('no selection hides the batch bar and disables every selection action', () => {
  const h = setup(); assert.equal(h.$('batchBar').hidden, true); assert.equal(h.$('selectedCount').textContent, '');
  assert.equal(h.$('applyBatch').disabled, true); assert.equal(h.$('clearSelection').disabled, true);
  assert.equal(h.$('batchSelectionHint').hidden, true); assert.equal(h.$('selectAll').checked, false);
});

test('visible selection shows its total without a hidden-selection warning', () => {
  const h = setup(); h.check('A', 'B');
  assert.equal(h.$('selectedCount').textContent, '2 selected'); assert.equal(h.$('batchBar').hidden, false);
  assert.equal(h.$('batchSelectionHint').hidden, true); assert.equal(h.$('applyBatch').disabled, false);
  assert.equal(h.$('selectAll').indeterminate, true); assert.equal(h.$('clearSelection').disabled, false);
});

for (const language of ['en', 'zh']) test(`${language} distinguishes hidden-only and mixed selections without changing scope`, () => {
  const h = setup({ language }); h.check('A', 'B'); h.search('Clip A');
  assert.equal(h.$('batchSelectionHint').textContent, words[language].selectionHidden.replace('{count}', '1'));
  assert.equal(h.$('batchSelectionHint').hidden, false); assert.equal(h.$('selectAll').checked, true);
  assert.deepEqual([...h.selectedKeys], ['A', 'B']); assert.equal(h.$('applyBatch').disabled, false);
  h.search('missing'); assert.equal(h.$('selectAll').disabled, true);
  assert.equal(h.$('batchSelectionHint').textContent, words[language].selectionHidden.replace('{count}', '2'));
  assert.equal(h.$('applyBatch').disabled, false); assert.equal(h.$('clearSelection').disabled, false);
  h.search(''); assert.equal(h.$('batchSelectionHint').hidden, true); assert.deepEqual([...h.selectedKeys], ['A', 'B']);
});

for (const count of [500, 501]) test(`${count} selected clips ${count === 500 ? 'remain valid' : 'explain the batch limit'}`, () => {
  const keys = Array.from({ length: count }, (_, i) => String(i)), h = setup({ keys }); h.check(...keys);
  assert.equal(h.$('applyBatch').disabled, count > 500); assert.equal(h.$('clearSelection').disabled, false);
  assert.equal(h.$('batchSelectionHint').hidden, count <= 500);
  if (count > 500) assert.equal(h.$('batchSelectionHint').textContent, words.en.selectionLimit);
  assert.equal(h.selectedKeys.size, count, 'never silently truncate the selected set');
});

test('limit and hidden-selection explanations coexist and localize immediately', () => {
  const keys = Array.from({ length: 501 }, (_, i) => String(i)), h = setup({ keys }); h.check(...keys); h.search('missing');
  for (const language of ['en', 'zh']) {
    h.setLanguage(language);
    assert.equal(h.$('batchSelectionHint').textContent, `${words[language].selectionHidden.replace('{count}', '501')} ${words[language].selectionLimit}`);
  }
});

for (const hiddenOnly of [false, true]) test(`clear-all clears ${hiddenOnly ? 'hidden-only' : 'mixed'} selection without changing filter or review draft`, () => {
  const h = setup(); h.check('A', 'B'); h.search(hiddenOnly ? 'missing' : 'Clip A'); h.$('clearSelection').focus();
  const before = h.current, note = h.$('note').value, score = h.$('score').value, trim = h.$('trimStart').value;
  assert.equal(typeof h.clear, 'function'); h.clear();
  assert.equal(h.selectedKeys.size, 0); assert.equal(h.$('batchBar').hidden, true); assert.equal(h.$('selectedCount').textContent, '');
  assert.equal(h.$('batchSelectionHint').hidden, true); assert.equal(h.$('search').value, hiddenOnly ? 'missing' : 'Clip A');
  assert.equal(h.current.state, before.state); assert.equal(h.current.selected, before.selected); assert.equal(h.current.dirty, true);
  assert.deepEqual([h.$('note').value, h.$('score').value, h.$('trimStart').value], [note, score, trim]);
  assert.deepEqual(h.selections, []); assert.equal(h.document.activeElement, h.$(hiddenOnly ? 'search' : 'selectAll'));
  assert.deepEqual(h.focuses.at(-1).options, { preventScroll: true });
  h.search(''); assert.equal(h.queueRows.size, 3);
  for (const row of h.queueRows.values()) assert.equal(row.querySelector('input').checked, false);
});

test('clear-all never steals focus that belongs to a review field', () => {
  const h = setup(); h.check('A'); h.$('note').focus(); assert.equal(typeof h.clear, 'function'); h.clear();
  assert.equal(h.document.activeElement, h.$('note')); assert.equal(h.current.dirty, true);
});

test('busy prevents clearing or changing batch controls, then recovers after unlock', () => {
  const h = setup(); h.check('A', 'B'); h.setBusy(true);
  for (const id of ['applyBatch', 'clearSelection', 'batchStatus', 'selectAll']) assert.equal(h.$(id).disabled, true, id);
  assert.equal(typeof h.clear, 'function'); h.clear(); assert.deepEqual([...h.selectedKeys], ['A', 'B']);
  h.setBusy(false); for (const id of ['applyBatch', 'clearSelection', 'batchStatus', 'selectAll']) assert.equal(h.$(id).disabled, false, id);
  h.clear(); assert.equal(h.selectedKeys.size, 0);
});

test('repeated clearing is harmless and does not move focus again', () => {
  const h = setup(); h.check('A'); h.$('clearSelection').focus(); assert.equal(typeof h.clear, 'function'); h.clear();
  const count = h.focuses.length; h.clear(); assert.equal(h.focuses.length, count); assert.equal(h.selectedKeys.size, 0);
});

test('actual row-checkbox changes update hidden counts without replacing review state', () => {
  const h = setup(); h.check('A'); h.search('Clip B'); const before = h.current;
  const checkbox = h.queueRows.get('B').querySelector('input'); checkbox.checked = true; checkbox.events.get('change')();
  assert.deepEqual([...h.selectedKeys], ['A', 'B']); assert.equal(h.$('selectedCount').textContent, '2 selected');
  assert.equal(h.$('batchSelectionHint').textContent, words.en.selectionHidden.replace('{count}', '1'));
  checkbox.checked = false; checkbox.events.get('change')(); assert.deepEqual([...h.selectedKeys], ['A']);
  assert.equal(h.current.state, before.state); assert.equal(h.current.selected, before.selected); assert.equal(h.current.dirty, true);
});

test('unchecking one actual row at 501 immediately restores a valid 500-item batch', () => {
  const keys = Array.from({ length: 501 }, (_, i) => String(i)), h = setup({ keys }); h.check(...keys);
  assert.equal(h.$('applyBatch').disabled, true); const checkbox = h.queueRows.get('0').querySelector('input');
  checkbox.checked = false; checkbox.events.get('change')();
  assert.equal(h.selectedKeys.size, 500); assert.equal(h.$('selectedCount').textContent, '500 selected');
  assert.equal(h.$('batchSelectionHint').hidden, true); assert.equal(h.$('batchSelectionHint').textContent, '');
  assert.equal(h.$('applyBatch').disabled, false); assert.equal(h.$('clearSelection').disabled, false);
});

test('deselecting visible results leaves hidden selections explicit and clearable', () => {
  const h = setup(); h.check('A', 'B'); h.search('Clip B');
  h.$('selectAll').checked = false; h.$('selectAll').events.get('change')();
  assert.deepEqual([...h.selectedKeys], ['A']); assert.equal(h.$('selectedCount').textContent, '1 selected');
  assert.equal(h.$('batchSelectionHint').textContent, words.en.selectionHidden.replace('{count}', '1'));
  assert.equal(h.$('applyBatch').disabled, false); assert.equal(h.$('clearSelection').disabled, false);
  assert.equal(h.queueRows.get('B').querySelector('input').checked, false);
  assert.equal(h.current.dirty, true); assert.equal(h.$('search').value, 'Clip B');
});

test('clearing keeps non-default status filtering and sort order intact', () => {
  const h = setup(); h.current.state.items[1].review.status = 'fix'; h.filter('fix');
  h.$('sort').value = 'duration'; h.check('A', 'B'); assert.equal(typeof h.clear, 'function'); h.clear();
  assert.equal(h.$('filter').value, 'fix'); assert.equal(h.$('sort').value, 'duration');
  assert.deepEqual([...h.queueRows.keys()], ['B']); assert.equal(h.current.selected.key, 'A');
  assert.equal(h.current.dirty, true); assert.equal(h.$('note').value, 'Unsaved review draft');
});

const descendants = node => [node, ...node.children.flatMap(descendants)];
const byClass = (row, name) => descendants(row).find(node => node.className === name);
const annotation = (key, note, markers = [], patch = {}) => ({ ...item(key), ...patch,
  review: { ...item(key).review, status: 'fix', note, markers } });
const excerpt = row => byClass(row, 'clip-search-excerpt')?.textContent;

test('search context is absent in the default and filename-only queue', () => {
  const h = setup(); h.replaceItems([annotation('A', 'Clip A needle')]);
  for (const query of ['', '  ', 'clip', 'A']) {
    h.inputSearch(query); const row = h.queueRows.get('A');
    assert.equal(excerpt(row), undefined); assert.equal(row.classList.contains('has-search-context'), false);
  }
});

test('identical filenames become distinguishable by saved time-note text and exact timestamp', () => {
  const h = setup(); h.replaceItems([
    annotation('A', '', [{ time: 1.234, text: 'click after verse' }], { label: 'Take.wav' }),
    annotation('B', '', [{ time: 8.4, text: 'click before chorus' }], { label: 'Take.wav' }),
  ]); h.inputSearch('click');
  assert.equal(excerpt(h.queueRows.get('A')), 'click after verse');
  assert.equal(excerpt(h.queueRows.get('B')), 'click before chorus');
  assert.equal(byClass(h.queueRows.get('A'), 'clip-search-source').textContent, 'Time note 0:01.234 · ');
  assert.equal(byClass(h.queueRows.get('B'), 'clip-search-source').textContent, 'Time note 0:08.400 · ');
});

test('search annotations remain passive safe text inside the existing selection button', () => {
  const h = setup(); const text = '<script>alert(1)</script> <img onerror=evil()>';
  h.replaceItems([annotation('A', text)]); h.inputSearch('<script>');
  const row = h.queueRows.get('A'), content = byClass(row, 'clip-search-context');
  assert.equal(content.tagName, 'span'); assert.equal(content.events.size, 0);
  assert.equal(excerpt(row), text); assert.equal(byClass(row, 'clip-search-excerpt').attributes.get('dir'), 'auto');
  assert.deepEqual(descendants(row).filter(node => ['button', 'input', 'a'].includes(node.tagName)).map(node => node.tagName), ['input', 'button']);
  row.querySelector('.clip').events.get('click')(); assert.deepEqual(h.selections, ['A']);
  assert.equal(h.current.dirty, true); assert.equal(h.$('note').value, 'Unsaved review draft');
});

test('same result keys still refresh context when the query changes its source', () => {
  const h = setup(); h.replaceItems([annotation('A', 'fade review', [{ time: 2, text: 'door time note' }])]);
  h.inputSearch('fade'); const before = h.queueRows.get('A'); assert.equal(excerpt(before), 'fade review');
  h.inputSearch('door'); const after = h.queueRows.get('A'); assert.notEqual(after, before);
  assert.equal(excerpt(after), 'door time note'); assert.equal(byClass(after, 'clip-search-source').textContent, 'Time note 0:02.000 · ');
});

test('canonically equivalent search input reuses the row and checkbox focus', () => {
  const h = setup(); h.replaceItems([annotation('A', 'fade review')]); h.inputSearch('fade');
  const row = h.queueRows.get('A'), checkbox = row.querySelector('input'); checkbox.focus();
  h.inputSearch('  ＦＡＤＥ  '); assert.equal(h.queueRows.get('A'), row); assert.equal(h.document.activeElement, checkbox);
});

test('same-version displayed annotation changes invalidate the row content cache', () => {
  const h = setup(); h.replaceItems([annotation('A', 'needle old')]); h.inputSearch('needle'); const row = h.queueRows.get('A');
  h.current.state.items[0].review.note = 'needle new'; h.renderQueue();
  assert.notEqual(h.queueRows.get('A'), row); assert.equal(excerpt(h.queueRows.get('A')), 'needle new');
});

test('fresh catalog snapshots update filtering and context even without a version bump', () => {
  const h = setup(); h.replaceItems([annotation('A', 'needle old'), annotation('B', '')]); h.inputSearch('needle');
  h.replaceItems([annotation('A', ''), annotation('B', 'needle new')]);
  assert.deepEqual([...h.queueRows.keys()], ['B']); assert.equal(excerpt(h.queueRows.get('B')), 'needle new');
});

test('clearing search removes context and restores the compact row height model', () => {
  const h = setup(); h.replaceItems([annotation('A', 'needle')]); h.inputSearch('needle');
  assert.equal(h.$('queueHighlight').style.height, '100px'); h.inputSearch('');
  assert.equal(excerpt(h.queueRows.get('A')), undefined); assert.equal(h.$('queueHighlight').style.height, '66px');
});

test('mixed compact and contextual row geometry comes from each actual row measurement', () => {
  const h = setup(); h.replaceItems([annotation('A', '', [], { label: 'needle' }), annotation('B', 'needle', [], { label: 'other' })]);
  h.inputSearch('needle'); h.chooseKey('B'); assert.equal(h.$('queueHighlight').style.height, '100px');
  assert.equal(h.moves.at(-1)[0], 66); h.chooseKey('A'); assert.equal(h.$('queueHighlight').style.height, '66px');
});

for (const language of ['en', 'zh']) test(`search-source labels localize to ${language} without modifying annotations`, () => {
  const h = setup(); h.replaceItems([annotation('A', 'needle')]); h.inputSearch('needle'); h.setLanguage(language);
  assert.equal(byClass(h.queueRows.get('A'), 'clip-search-source').textContent, `${words[language].matchedReviewNote} · `);
  assert.equal(excerpt(h.queueRows.get('A')), 'needle');
});

test('status filtering and sorting preserve hidden selections and the dirty detail fields', () => {
  const h = setup(); const first = annotation('A', 'needle'), second = annotation('B', 'needle');
  first.review.status = 'pass'; second.quality.duration = 20; h.replaceItems([first, second]); h.check('A', 'B');
  h.inputSearch('needle'); h.$('filter').value = 'fix'; h.$('filter').events.get('change')();
  h.$('sort').value = 'duration'; h.$('sort').events.get('change')();
  assert.deepEqual([...h.queueRows.keys()], ['B']); assert.deepEqual([...h.selectedKeys], ['A', 'B']);
  assert.equal(h.$('batchSelectionHint').textContent, words.en.selectionHidden.replace('{count}', '1'));
  assert.equal(h.$('note').value, 'Unsaved review draft'); assert.equal(h.$('trimStart').value, '0.123456');
  assert.equal(h.current.dirty, true); assert.ok(h.detailCalls.every(restore => restore === false)); assert.deepEqual(h.selections, []);
});

test('IME input updates passive results without switching clips, submitting or replacing the dirty form', () => {
  const h = setup(); h.replaceItems([annotation('A', '门响 after chorus'), annotation('B', 'door')]); h.$('search').focus();
  for (const [query, composing] of [['m', true], ['门', true], ['门响', false]]) h.inputSearch(query, composing);
  assert.deepEqual([...h.queueRows.keys()], ['A']); assert.equal(excerpt(h.queueRows.get('A')), '门响 after chorus');
  assert.equal(h.document.activeElement, h.$('search')); assert.equal(h.$('note').value, 'Unsaved review draft');
  assert.equal(h.current.dirty, true); assert.deepEqual(h.selections, []); assert.deepEqual(h.detailCalls, [false, false, false]);
});

test('unsaved annotation edits are not displayed or searched as saved queue context', () => {
  const h = setup(); h.replaceItems([annotation('A', 'saved needle')]); h.$('note').value = 'PRIVATE UNSAVED needle secret';
  h.inputSearch('needle'); assert.equal(excerpt(h.queueRows.get('A')), '…needle');
  h.inputSearch('secret'); assert.equal(h.queueRows.size, 0); assert.equal(h.$('note').value, 'PRIVATE UNSAVED needle secret');
});

test('contextual row checkbox selection stays scoped to visible results and honors busy state', () => {
  const h = setup(); h.replaceItems([annotation('A', 'needle'), annotation('B', '')]); h.inputSearch('needle');
  h.$('selectAll').checked = true; h.$('selectAll').events.get('change')(); assert.deepEqual([...h.selectedKeys], ['A']);
  const row = h.queueRows.get('A'); h.setBusy(true); assert.equal(row.querySelector('input').disabled, true);
  h.setBusy(false); assert.equal(h.queueRows.get('A'), row); assert.equal(row.querySelector('input').disabled, false);
});

test('long annotations stay bounded in the rendered safe text', () => {
  const h = setup(); h.replaceItems([annotation('A', '前'.repeat(1000) + 'needle ' + '后'.repeat(1000))]); h.inputSearch('needle');
  const text = excerpt(h.queueRows.get('A')); assert.equal(typeof text, 'string'); assert.ok(text.startsWith('…needle ')); assert.ok([...text].length <= 100);
});

test('context CSS bounds two lines and preserves matching intrinsic row heights', () => {
  const studio = readFileSync(resolve(dirname(file), 'workbench-studio.css'), 'utf8');
  assert.match(css, /\.clip-row\.has-search-context\s*\{[^}]*height:\s*100px;[^}]*contain-intrinsic-size:\s*auto 100px;/s);
  assert.match(css, /\.clip-search-context\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*max-height:\s*32px;[^}]*overflow:\s*hidden;/s);
  assert.match(studio, /\.clip-row\s*\{[^}]*height:\s*66px;[^}]*contain-intrinsic-size:\s*auto 66px;/s);
});

for (const flag of ['ogg_ending_unconfirmed', 'ogg_check_incomplete']) {
  test(`same-key B ${flag} repaints the queue indicator and attention filter`, () => {
    const h = setup({ keys: ['A'] });
    const label = () => { const node = h.queueRows.get('A').children[1].children[1].children[0]; return node.textContent + node.children.filter(child => child.attributes.get('aria-hidden') === 'true').map(child => child.textContent).join(''); };
    assert.equal(label(), '0:10');
    const warned = { ...item('A'), reference_quality: { flags: [flag] } };
    h.replaceItems([warned]);
    assert.equal(label(), '0:10 · !');
    h.filter('warnings');
    assert.equal(h.$('queueCount').textContent, '1 / 1');
    assert.equal(label(), '0:10 · !');
    h.replaceItems([{ ...warned, quality: { ...warned.quality, flags: ['near_full_scale'] } }]);
    assert.equal(h.$('queueCount').textContent, '1 / 1');
    h.replaceItems([item('A')]);
    assert.equal(h.$('queueCount').textContent, '0 / 1');
    h.filter('all');
    assert.equal(label(), '0:10');
    assert.equal(h.current.selected.key, 'A');
    assert.equal(h.current.dirty, true);
    assert.equal(h.$('note').value, 'Unsaved review draft');
  });
}

// Model name-from-content traversal, not a browser accessibility tree. The
// production nodes retain native button semantics and hide only punctuation.
const accessibleText = node => node.attributes.get('aria-hidden') === 'true' ? '' :
  [node.textContent, ...node.children.map(accessibleText)].filter(Boolean).join(' ');
for (const language of ['en', 'zh']) {
  for (const flag of ['near_full_scale', 'ogg_ending_unconfirmed', 'ogg_check_incomplete', 'mp3_frame_count_differs', 'mp3_check_incomplete']) {
    for (const side of flag === 'near_full_scale' ? ['A'] : ['A', 'B']) {
      test(`${language}: ${side} ${flag} gives queue attention meaningful name-from-content`, () => {
        const h = setup({ keys: ['A'], language });
        const clip = item('A');
        if (side === 'A') clip.quality.flags = [flag];
        else clip.reference_quality = { flags: [flag] };
        h.replaceItems([clip]);
        const button = h.queueRows.get('A').children[1];
        assert.equal(button.tagName, 'button');
        assert.equal(button.type, 'button');
        assert.equal(button.attributes.has('aria-label'), false);
        const duration = button.children[1].children[0];
        assert.equal(duration.textContent, '0:10');
        assert.equal(duration.children.length, 2);
        assert.equal(duration.children[0].textContent, ' · !');
        assert.equal(duration.children[0].attributes.get('aria-hidden'), 'true');
        const descriptor = duration.children[1];
        assert.equal(descriptor.tagName, 'span');
        assert.equal(descriptor.className, 'sr-only');
        assert.equal(descriptor.attributes.has('aria-hidden'), false);
        assert.equal(descriptor.attributes.has('tabindex'), false);
        assert.equal(duration.children[0].tagName, 'span');
        assert.equal(duration.children[0].attributes.has('tabindex'), false);
        assert.equal(descriptor.attributes.has('role'), false);
        assert.equal(descriptor.attributes.has('aria-live'), false);
        const name = accessibleText(button);
        assert.ok(name.includes('Clip A'));
        assert.ok(name.includes(words[language].pending));
        assert.ok(name.includes(words[language].flags));
        assert.ok(!name.includes('!'));
        assert.equal(name.split(words[language].flags).length - 1, 1);
      });
    }
  }
}
test('queue attention language and clearing update without dropping search context', () => {
  const h = setup({ keys: ['A'] });
  const clip = item('A'); clip.review.note = 'needle note';
  clip.reference_quality = { flags: ['mp3_check_incomplete'] };
  h.replaceItems([clip]); h.search('needle');
  let button = h.queueRows.get('A').children[1];
  assert.ok(accessibleText(button).includes('needle note'));
  assert.ok(accessibleText(button).includes(words.en.flags));
  h.setLanguage('zh');
  button = h.queueRows.get('A').children[1];
  assert.ok(accessibleText(button).includes(words.zh.flags));
  assert.ok(!accessibleText(button).includes(words.en.flags));
  assert.ok(accessibleText(button).includes('needle note'));
  h.replaceItems([{ ...clip, reference_quality: { flags: [] } }]);
  button = h.queueRows.get('A').children[1];
  assert.equal(button.children[1].children[0].children.length, 0);
  assert.ok(!accessibleText(button).includes(words.zh.flags));
  assert.ok(accessibleText(button).includes('needle note'));
});

test('queue attention reuses visually clipped text rather than removing it from accessibility', () => {
  const rule = css.match(/\.sr-only\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden/);
});
