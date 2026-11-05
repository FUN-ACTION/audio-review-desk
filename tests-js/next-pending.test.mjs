import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextPendingItem, searchText } from '../src/audio_review_desk/static/ui.js';

// Execute the actual palette configuration, sidebar listener, selection and
// discard gate. This verifies workflow parity, not browser rendering.
const source = readFileSync(process.env.ARD_PENDING_WORKBENCH || new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const item = (key, status = 'pending') => ({ key, id: key, label: `Clip ${key}`, quality: { decoded: false, duration: 10 }, review: { version: 1, status, note: `Saved ${key}` } });
function setup({ rows = [item('A'), item('B'), item('C')], current = 'B', dirty = false } = {}) {
  const nodes = new Map(), notices = [], dialogs = [], effects = [];
  let commands;
  const document = { activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', hidden: false, open: false, listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; }, focus() { document.activeElement = this; }, setAttribute() {} }); return nodes.get(id); };
  const noop = () => {};
  const helper = source.includes('async function goToNextPending()') ? extract('async function goToNextPending()', 'const commandMenu =') : '';
  const code = [
    extract('let discardResolver =', 'function translate()'), helper,
    extract('const commandMenu =', 'function notice('),
    extract('async function select(item', 'let waveStatus ='),
    extract('let refreshLoadError =', 'async function refresh('),
    extract('$("nextPending").addEventListener', '$("markIn").addEventListener'),
  ].join('\n');
  const env = {
    draftSession: null, // This focused harness intentionally excludes reload-draft recovery.
    $, document, rows, current, initialDirty: dirty, nextPendingItem, searchText,
    mountCommands(options) { commands = options; return {}; }, t: key => key, errorText: error => error.message,
    notice: (...args) => notices.push(args), openDialog: node => dialogs.push(node.id),
    openImport: noop, browse: noop, save: () => { throw new Error('Navigation must not save reviews'); },
    audition: { cancel: noop }, rememberPosition: noop, waveformReader: { cancel: noop }, invalidateHistory: noop,
    media: { cancel: noop }, player: { pause: noop, removeAttribute: noop, load: noop }, sessionStorage: { setItem: noop },
    matchMedia: () => ({ matches: false }), updateLibraryToggle: noop,
    spectrumView: { setSource: noop }, waveformView: { cancelDrag() {}, reset: noop }, renderQueue: noop,
    afterRender: (selected, restore) => { effects.push([selected?.key, restore]); if (restore && selected) $('note').value = selected.review.note; },
  };
  const control = Function(...Object.keys(env), `
    let state = { items: rows, workspace_id: 'pending-test' }, selected = rows.find(row => row.key === current) || (current ? { ...rows[0], key: current } : null),
      dirty = initialDirty, busy = false, generation = 0, refreshGeneration = 0, refreshController = null, refreshRead = null,
      suspendedCompletion = null, wave = {}, waveStatus = null, waveNotice = null, variant = 'a';
    const job = null;
    function renderDetails(restore = true) { afterRender(selected, restore); }
    ${code}
    $('note').value = initialDirty ? 'Unsent draft' : selected?.review.note || '';
    return { select,
      answer(allowed) { const resolve = discardResolver; discardResolver = null; resolve(allowed); },
      setBusy(value) { busy = value; },
      setCurrent(key) { selected = state.items.find(row => row.key === key); },
      replaceRows(rows) { state.items = rows; },
      get current() { return { selected, state, dirty, busy }; } };
  `)(...Object.values(env));
  return { $, document, notices, dialogs, effects, control,
    palette: () => commands.rows().find(row => row.label === 'nextPending'),
    sidebar: () => $('nextPending').listeners.click(),
    run: entry => entry === 'palette' ? commands.rows().find(row => row.label === 'nextPending').run() : $('nextPending').listeners.click(),
    get current() { return control.current; },
  };
}

for (const entry of ['palette', 'sidebar']) {
  for (const [name, current, rows, expected] of [
    ['advances from the current clip instead of restarting at the first', 'B', [item('A'), item('B'), item('C')], 'C'],
    ['wraps after the last clip', 'C', [item('A'), item('B'), item('C')], 'A'],
    ['skips reviews that are no longer pending', 'A', [item('A'), item('B', 'fix'), item('C', 'pass'), item('D')], 'D'],
    ['starts at the first pending clip when current is outside the catalog', 'detached', [item('A', 'exclude'), item('B')], 'B'],
  ]) test(`${entry} ${name}`, async () => {
    const h = setup({ rows, current }); await h.run(entry);
    assert.equal(h.current.selected.key, expected); assert.equal(h.current.selected, rows.find(row => row.key === expected));
    assert.equal(h.current.dirty, false); assert.deepEqual(h.dialogs, []);
  });

  for (const rows of [[item('B')], [item('A', 'pass'), item('B'), item('C', 'exclude')]]) {
    test(`${entry} excludes the current clip when it is the only pending review among ${rows.length}`, async () => {
      const h = setup({ rows }); const before = h.current.selected; await h.run(entry);
      assert.equal(h.current.selected, before); assert.deepEqual(h.notices, [['noPending', true]]); assert.deepEqual(h.effects, []);
    });
  }

  for (const allowed of [false, true]) test(`${entry} ${allowed ? 'continues after' : 'respects cancellation of'} the real unsaved-draft gate`, async () => {
    const h = setup({ dirty: true }), pending = h.run(entry); await tick();
    assert.deepEqual(h.dialogs, ['discardDialog']); assert.equal(h.current.selected.key, 'B');
    assert.equal(h.$('note').value, 'Unsent draft'); assert.equal(h.document.activeElement, h.$('keepEditing'));
    h.control.answer(allowed); await pending;
    assert.equal(h.current.selected.key, allowed ? 'C' : 'B'); assert.equal(h.current.dirty, !allowed);
    assert.equal(h.$('note').value, allowed ? 'Saved C' : 'Unsent draft');
  });

  test(`${entry} cannot navigate or display a misleading no-pending message during a write`, async () => {
    const h = setup({ rows: [item('B')] }); h.control.setBusy(true); await h.run(entry);
    assert.equal(h.current.selected.key, 'B'); assert.deepEqual(h.notices, []); assert.deepEqual(h.dialogs, []);
    h.control.setBusy(false); await h.run(entry); assert.deepEqual(h.notices, [['noPending', true]]);
  });
}

test('both entry points use the identical navigation action', () => {
  const h = setup(); assert.equal(h.palette().run, h.$('nextPending').listeners.click);
});

test('repeated command-palette navigation traverses the catalog instead of bouncing between two clips', async () => {
  const h = setup({ current: 'A' }), visited = [];
  for (let i = 0; i < 4; i++) { await h.run('palette'); visited.push(h.current.selected.key); }
  assert.deepEqual(visited, ['B', 'C', 'A', 'B']);
});

test('a previously opened palette action uses the latest catalog and current selection', async () => {
  const h = setup(), action = h.palette(); h.control.setCurrent('C');
  const rows = [item('A', 'pass'), item('B'), item('C'), item('D')]; h.control.replaceRows(rows);
  await action.run(); assert.equal(h.current.selected, rows[3]);
});

test('an empty catalog has no palette action and the sidebar remains harmless', async () => {
  const h = setup({ rows: [], current: null }); assert.equal(h.palette(), undefined); await h.sidebar();
  assert.equal(h.current.selected, null); assert.deepEqual(h.notices, [['noPending', true]]);
});

for (const entry of ['palette', 'sidebar']) test(`${entry} starts at the first pending clip without a current selection`, async () => {
  const h = setup({ current: null, rows: [item('A', 'pass'), item('B'), item('C')] }); await h.run(entry);
  assert.equal(h.current.selected.key, 'B'); assert.deepEqual(h.dialogs, []);
});

for (const entry of ['palette', 'sidebar']) test(`${entry} keeps filters and sort while navigating the full catalog`, async () => {
  const h = setup(); h.$('filter').value = 'fix'; h.$('sort').value = 'recent'; h.$('search').value = 'Clip A';
  await h.run(entry); assert.equal(h.current.selected.key, 'C');
  assert.deepEqual([h.$('filter').value, h.$('sort').value, h.$('search').value], ['fix', 'recent', 'Clip A']);
});
