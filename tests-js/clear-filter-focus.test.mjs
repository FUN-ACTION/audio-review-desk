import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterItems } from '../src/audio_review_desk/static/ui.js';
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/audio_review_desk/static/workbench.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/audio_review_desk/static/workbench.css', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('for (const id of ["clearFilters", "showAllAudio"])'), source.indexOf('$("reopenLast").addEventListener'));
const hideOutside = source.split('\n').find(line => line.includes('$("outsideFilter").hidden ='));
// Execute the shipped handlers/filtering and detail visibility statement.
// DOM doubles model CSS-hidden focus rejection and ancestor-hide blur, not AT.
function setup({ layout = 'desktop', selected = true } = {}) {
  const body = { id: 'body' }, document = { activeElement: body };
  const nodes = new Map(), focuses = [], restores = [];
  const classes = new Set(layout === 'mobile-collapsed' ? ['mobile-library-collapsed'] : layout === 'focus-mode' ? ['focus-mode'] : []);
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', isConnected: true, disabled: false, visible: true, _hidden: false,
      get hidden() { return this._hidden; }, set hidden(value) { this._hidden = value;
        if (value && ((id === 'outsideFilter' && document.activeElement === $('showAllAudio')) ||
          (id === 'emptyFilter' && document.activeElement === $('clearFilters')))) document.activeElement = body; },
      getClientRects() {
        const hiddenSearch = id === 'search' && (classes.has('mobile-library-collapsed') || classes.has('focus-mode'));
        return this.isConnected && this.visible && !this.hidden && !hiddenSearch ? [{}] : [];
      },
      focus(options) { if (!this.disabled && this.getClientRects().length) { document.activeElement = this; focuses.push({ id, options }); } },
      addEventListener(type, callback) { this[type] = callback; },
    });
    return nodes.get(id);
  };
  const item = { key: 'clip', id: 'clip', label: 'Clip', quality: { flags: [] }, review: { status: 'pass', note: 'Saved', markers: [] } };
  $('search').value = 'no match'; $('filter').value = 'pending';
  $('note').value = 'Unsaved note'; $('trimStart').value = '0.123456'; $('score').value = '0';
  $('clipTitle').hidden = !selected;
  let rows = [];
  const visibleItems = () => filterItems([item], $('search').value, $('filter').value, new Set());
  const renderQueue = () => { rows = visibleItems(); $('emptyFilter').hidden = rows.length > 0; };
  const renderDetails = restore => {
    restores.push(restore);
    if (restore) $('note').value = item.review.note;
    Function('$', 'index', hideOutside)($, visibleItems().findIndex(row => row.key === item.key));
  };
  Function('$', 'selected', 'renderQueue', 'renderDetails', handlers)($, selected ? item : null, renderQueue, renderDetails);
  return { $, document, body, classes, focuses, restores, get rows() { return rows; },
    click(id) { document.activeElement = $(id); $(id).click(); } };
}
// clearFilters itself is hidden in collapsed/focus layouts; those combinations
// exercise the shared handler defensively, not a reachable native click. The
// detail-panel showAllAudio action is the real hidden-search reproduction.
for (const layout of ['desktop', 'mobile-expanded', 'mobile-collapsed', 'focus-mode']) {
  for (const action of ['clearFilters', 'showAllAudio']) {
    test(`${layout}: ${action} clears results without focusing hidden search or altering drafts/layout`, () => {
      const h = setup({ layout }), classes = [...h.classes];
      h.click(action);
      const expected = ['mobile-collapsed', 'focus-mode'].includes(layout) ? 'clipTitle' : 'search';
      assert.equal(h.document.activeElement, h.$(expected));
      assert.deepEqual(h.focuses, [{ id: expected, options: { preventScroll: true } }]);
      assert.equal(h.$('search').value, ''); assert.equal(h.$('filter').value, 'all');
      assert.equal(h.rows.length, 1); assert.deepEqual(h.restores, [false]);
      assert.equal(h.$('outsideFilter').hidden, true);
      assert.equal(h.$('note').value, 'Unsaved note'); assert.equal(h.$('trimStart').value, '0.123456'); assert.equal(h.$('score').value, '0');
      assert.deepEqual([...h.classes], classes);
    });
  }
}
for (const property of ['detached', 'disabled', 'hidden']) test(`unusable ${property} search uses visible heading`, () => {
  const h = setup(); const search = h.$('search');
  if (property === 'detached') search.isConnected = false;
  if (property === 'disabled') search.disabled = true;
  if (property === 'hidden') search.visible = false;
  h.click('showAllAudio'); assert.equal(h.document.activeElement, h.$('clipTitle'));
});
for (const property of ['detached', 'disabled', 'hidden']) test(`no focus attempt on ${property} heading when search is hidden`, () => {
  const h = setup({ layout: 'mobile-collapsed' }); const heading = h.$('clipTitle');
  if (property === 'detached') heading.isConnected = false;
  if (property === 'disabled') heading.disabled = true;
  if (property === 'hidden') heading.visible = false;
  h.click('showAllAudio'); assert.equal(h.document.activeElement, h.body); assert.equal(h.focuses.length, 0);
});
test('empty/no-selection state uses search without attempting detail restoration', () => {
  const h = setup({ selected: false }); h.click('clearFilters');
  assert.equal(h.document.activeElement, h.$('search')); assert.deepEqual(h.restores, []);
});
test('no-selection hidden-search state never focuses hidden detail heading', () => {
  const h = setup({ selected: false, layout: 'mobile-collapsed' }); h.click('clearFilters');
  assert.equal(h.focuses.length, 0); assert.deepEqual(h.restores, []);
});
test('fallback is an existing named heading without a new tab stop or live region', () => {
  assert.match(html, /<h2\b[^>]*id="clipTitle"[^>]*tabindex="-1"/);
  assert.match(html, /<section\b[^>]*id="detailPanel"[^>]*aria-labelledby="clipTitle"/);
  assert.match(html, /<input\b[^>]*id="search"[^>]*type="search"/);
  assert.match(css, /\.focus-mode \.library,[\s\S]*?display:\s*none;/);
  assert.match(css, /\.mobile-library-collapsed\s+:is\(\s*\.search-field,[\s\S]*?display:\s*none !important;/);
  assert.doesNotMatch(handlers, /await|aria-live|tabindex|setTimeout/);
});
