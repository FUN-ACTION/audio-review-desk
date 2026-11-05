import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Execute production handlers against deterministic DOM/request doubles.
// This covers recovery intent and requests, not native dialog/browser rendering.
const file = process.env.ARD_IMPORT_WORKBENCH || fileURLToPath(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url));
const source = readFileSync(file, 'utf8');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source boundary: ${start} / ${end}`);
  return source.slice(a, b);
}
const handlers = [
  extract('function showImportError(', 'function renderJob('),
  extract('async function startImport(', 'function markBoundary('),
  extract('async function browse(', '$("chooseFiles").addEventListener'),
  extract('for (const id of ["closeImport", "dismissImport"])', '$("importForm").addEventListener'),
].join('\n');
function setup({ picker = ['/audio/new.wav'], pickerError = null, importError = { code: 'network' }, allowed = true, postImpl = null, discardImpl = null, animateClose = false } = {}) {
  const nodes = new Map(), calls = [], focuses = [], accepted = [], opened = [], closed = [], notices = [];
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, checked: false, dataset: {}, textContent: '',
      focus() { focuses.push(id); },
      addEventListener(type, handler) { this[type] = handler; } });
    return nodes.get(id);
  };
  $('importDialog').open = true;
  $('importSubmissionReceipt').hidden = true;
  $('importKind').value = 'directory';
  $('importPath').value = '/old/manual-folder';
  $('appendImport').checked = false;
  let remainingError = importError, discardCalls = 0;
  const env = {
    $, t: key => key, captureNotice: message => notices.push(typeof message === "function" ? message() : message), post: async (path, payload) => {
      calls.push({ path, payload });
      if (postImpl) return postImpl(path, payload);
      if (path === '/api/browse') {
        if (pickerError) throw pickerError;
        return { path: picker };
      }
      if (remainingError) {
        const error = Array.isArray(remainingError) ? remainingError.shift() : remainingError;
        if (!Array.isArray(remainingError) || !remainingError.length) remainingError = null;
        if (error) throw error;
      }
      return { id: 'accepted', state: 'running' };
    },
    discardAllowed: async () => { discardCalls++; return discardImpl ? discardImpl() : allowed; },
    renderSummary() {}, openDialog: node => { node.open = true; opened.push(node); }, closeDialog: node => { if (!animateClose) node.open = false; closed.push(node); },
    acceptJob: job => accepted.push(job), errorText: error => `Translated ${error.code}`,
  };
  const api = Function(...Object.keys(env), `let choosing = false, busy = false, language = 'en', noticeGeneration = 0;
    function notice(message) { noticeGeneration++; captureNotice(message); }
    const importing = () => false, state = { items: [{ key: 'existing' }] };
    ${handlers}
    return { browse, openImport, startImport, notify: notice };`)(...Object.values(env));
  return { $, ...api, calls, focuses, accepted, opened, closed, notices,
    get discardCalls() { return discardCalls; },
    imports: () => calls.filter(row => row.path === '/api/import'),
    submit: () => api.startImport({ preventDefault() {} }),
  };
}

for (const [kind, picker] of [
  ['files', ['/audio/new.wav', '/audio/second.wav']],
  ['directory', '/audio/new-folder'],
  ['manifest', '/audio/list.csv'],
]) {
  test(`failed quick ${kind} add retains its path and append intent for one explicit retry`, async () => {
    const h = setup({ picker });
    await h.browse(kind, true);
    assert.equal(h.imports().length, 1, 'failure must not automatically repeat a write');
    assert.deepEqual(h.imports()[0].payload, { kind, path: picker, append: true });
    assert.equal(h.$('importKind').value, kind);
    assert.equal(h.$('importPath').value, Array.isArray(picker) ? picker.join('\n') : picker);
    assert.equal(h.$('appendImport').checked, true, 'fallback must not inherit old Replace mode');
    assert.equal(h.$('replaceHint').hidden, true);
    assert.equal(h.$('importError').hidden, false);
    assert.equal(h.$('importError').dataset.code, 'network');
    assert.equal(h.$('importError').textContent, 'Translated network');
    assert.equal(h.focuses.at(-1), 'importPath');
    assert.equal(h.opened.length, 1);
    assert.equal(h.accepted.length, 0);
    await h.submit();
    assert.equal(h.imports().length, 2, 'one deliberate submit sends one additional write');
    assert.deepEqual(h.imports()[1].payload, { kind, path: picker, append: true });
    assert.equal(h.$('importError').hidden, true);
    assert.equal(h.accepted.length, 1);
    assert.equal(h.closed.length, 1);
  });

  test(`unavailable quick ${kind} picker clears unrelated manual paths and prepares append recovery`, async () => {
    const h = setup({ pickerError: { code: 'picker_unavailable' }, importError: null });
    await h.browse(kind, true);
    assert.equal(h.imports().length, 0);
    assert.equal(h.$('importKind').value, kind);
    assert.equal(h.$('importPath').value, '', 'a failed picker must not reuse unrelated previous input');
    assert.equal(h.$('appendImport').checked, true);
    assert.equal(h.$('replaceHint').hidden, true);
    assert.equal(h.$('importError').dataset.code, 'picker_unavailable');
    assert.equal(h.focuses.at(-1), 'importPath');
    await h.submit();
    assert.equal(h.imports().length, 0, 'empty retry requires a new path rather than importing stale input');
    assert.equal(h.$('importError').dataset.code, 'path_required');
    h.$('importPath').value = Array.isArray(picker) ? picker.join('\n') : picker;
    await h.submit();
    assert.deepEqual(h.imports().map(row => row.payload), [{ kind, path: picker, append: true }]);
  });
}

test('manual picker failure retains typed input and explicit Replace mode', async () => {
  const h = setup({ pickerError: { code: 'picker_unavailable' }, importError: null });
  await h.browse('directory', false);
  assert.equal(h.$('importPath').value, '/old/manual-folder');
  assert.equal(h.$('appendImport').checked, false);
  assert.equal(h.$('replaceHint').hidden, false);
  assert.equal(h.$('importError').dataset.code, 'picker_unavailable');
  assert.equal(h.focuses.at(-1), 'importPath');
  assert.equal(h.imports().length, 0);
  await h.submit();
  assert.deepEqual(h.imports()[0].payload, { kind: 'directory', path: '/old/manual-folder', append: false });
});

test('manual picker success changes the path without changing explicit Replace mode', async () => {
  const h = setup({ picker: '/audio/selected-folder', importError: null });
  await h.browse('directory', false);
  assert.equal(h.$('importPath').value, '/audio/selected-folder');
  assert.equal(h.$('appendImport').checked, false);
  assert.equal(h.imports().length, 0);
  await h.submit();
  assert.deepEqual(h.imports()[0].payload, { kind: 'directory', path: '/audio/selected-folder', append: false });
});

for (const importNow of [true, false]) {
  test(`cancelled ${importNow ? 'quick' : 'manual'} picker preserves old manual state and sends no import`, async () => {
    const h = setup({ picker: null });
    await h.browse('files', importNow);
    assert.equal(h.calls.length, 1);
    assert.equal(h.imports().length, 0);
    assert.equal(h.$('importPath').value, '/old/manual-folder');
    assert.equal(h.$('importKind').value, 'directory');
    assert.equal(h.$('appendImport').checked, false);
    assert.equal(h.opened.length, 0);
    assert.equal(h.focuses.length, 0);
  });
}

test('declining draft discard does not open the picker or mutate manual import fields', async () => {
  const h = setup({ allowed: false });
  await h.browse('files', true);
  assert.equal(h.discardCalls, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('importPath').value, '/old/manual-folder');
  assert.equal(h.$('importKind').value, 'directory');
  assert.equal(h.$('appendImport').checked, false);
  assert.equal(h.opened.length, 0);
});

test('leaving a failed add without submitting never starts a retry', async () => {
  const h = setup();
  await h.browse('files', true);
  h.$('dismissImport').click();
  assert.equal(h.closed.length, 1, 'actual Cancel handler closes the fallback');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.imports().length, 1);
  assert.equal(h.accepted.length, 0);
  assert.equal(h.$('importPath').value, '/audio/new.wav');
});


test('successful quick add uses append without resetting the hidden manual preference', async () => {
  const h = setup({ importError: null });
  h.$('replaceHint').hidden = false;
  await h.browse('files', true);
  assert.deepEqual(h.imports().map(row => row.payload), [{ kind: 'files', path: ['/audio/new.wav'], append: true }]);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.opened.length, 0);
  assert.equal(h.$('appendImport').checked, false, 'success does not need to reset a hidden manual preference');
  assert.equal(h.$('replaceHint').hidden, false);
  assert.equal(h.$('importKind').value, 'files');
  assert.equal(h.$('importPath').value, '/audio/new.wav');
});

test('a user may explicitly change recovered Add to Replace before submitting', async () => {
  const h = setup();
  await h.browse('files', true);
  assert.equal(h.$('appendImport').checked, true);
  h.$('appendImport').checked = false;
  await h.submit();
  assert.deepEqual(h.imports().map(row => row.payload.append), [true, false]);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.$('importPath').value, '/audio/new.wav');
});

test('another failed explicit retry retains the chosen path and current mode without looping', async () => {
  const h = setup({ importError: [{ code: 'network' }, { code: 'operation_failed' }] });
  await h.browse('files', true);
  h.$('appendImport').checked = false;
  await h.submit();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.imports().length, 2);
  assert.deepEqual(h.imports().map(row => row.payload.append), [true, false]);
  assert.equal(h.$('importPath').value, '/audio/new.wav');
  assert.equal(h.$('appendImport').checked, false);
  assert.equal(h.$('importError').hidden, false);
  assert.equal(h.$('importError').dataset.code, 'operation_failed');
  assert.equal(h.$('importError').textContent, 'Translated operation_failed');
  assert.equal(h.accepted.length, 0);
  assert.equal(h.closed.length, 0);
  assert.equal(h.focuses.at(-1), 'importPath');
});

for (const [kind, picker] of [
  ['directory', '/audio/intended folder '],
  ['manifest', '/lists/review.json '],
  ['files', ['/audio/take\nsecond.wav', '/audio/regular.wav']],
]) {
  test(`unchanged picked ${kind} retries the exact original paths after failure`, async () => {
    const h = setup({ picker });
    await h.browse(kind, true);
    await h.submit();
    assert.equal(h.imports().length, 2);
    assert.deepEqual(h.imports()[1].payload, { kind, path: picker, append: true });
  });
  test(`manual picker for ${kind} also preserves exact selected paths`, async () => {
    const h = setup({ picker, importError: null });
    await h.browse(kind, false);
    await h.submit();
    assert.equal(h.imports().length, 1);
    assert.deepEqual(h.imports()[0].payload, { kind, path: picker, append: false });
  });
}

test('editing a picked path discards its exact-selection identity even after returning to the displayed text', async () => {
  const picker = ['/audio/first\nsecond.wav'];
  const h = setup({ picker }); await h.browse('files', true);
  const display = h.$('importPath').value;
  h.$('importPath').value = '/audio/manual.wav'; h.$('importPath').input?.();
  h.$('importPath').value = display; h.$('importPath').input?.();
  await h.submit();
  assert.deepEqual(h.imports()[1].payload.path, ['/audio/first', 'second.wav']);
});

test('changing import kind revokes the original picker identity', async () => {
  const h = setup({ picker: '/audio/folder ' }); await h.browse('directory', true);
  h.$('importKind').value = 'manifest'; h.$('importKind').change?.();
  h.$('importDialog').open = true;
  h.$('importKind').value = 'directory'; h.$('importKind').change?.();
  await h.submit(); assert.equal(h.imports()[1].payload.path, '/audio/folder');
});

test('mutating a picker response after selection cannot change a deliberate retry', async () => {
  const picker = ['/audio/first\nsecond.wav'];
  const h = setup({ picker }); await h.browse('files', true);
  picker[0] = '/audio/unrelated.wav'; await h.submit();
  assert.deepEqual(h.imports()[1].payload.path, ['/audio/first\nsecond.wav']);
});

test('repeated explicit retries keep exact paths without sharing the request array', async () => {
  const picker = ['/audio/first\nsecond.wav'];
  const h = setup({ picker, importError: [{ code: 'network' }, { code: 'network' }, null] });
  await h.browse('files', true); await h.submit();
  h.imports()[1].payload.path[0] = '/audio/changed-after-send.wav';
  await h.submit(); assert.equal(h.imports().length, 3);
  assert.deepEqual(h.imports()[2].payload.path, picker);
});

test('a changed displayed value never sends a retained picker path even without an input event', async () => {
  const h = setup({ picker: ['/audio/first\nsecond.wav'] }); await h.browse('files', true);
  h.$('importPath').value = ' /audio/manual.wav ';
  await h.submit(); assert.deepEqual(h.imports()[1].payload.path, ['/audio/manual.wav']);
});

const deferredImport = () => {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
};
const settleImport = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('two same-turn picker requests share no discard confirmation or import mutation', async () => {
 const wait = deferredImport(), h = setup({ discardImpl: () => wait.promise, importError: null });
 const first = h.browse('files', true), second = h.browse('files', true);
 assert.equal(h.discardCalls, 1); wait.resolve(true); await Promise.all([first, second]);
 assert.equal(h.calls.filter(call => call.path === '/api/browse').length, 1);
 assert.equal(h.imports().length, 1);
});

test('pending manual submit blocks duplicate submission and picker until failure releases it', async () => {
 const wait = deferredImport(); let writes = 0;
 const h = setup({ postImpl: () => ++writes === 1 ? wait.promise : { id: 'retry', state: 'running' } });
 const first = h.submit(); await h.submit(); await h.browse('files', true);
 assert.equal(h.imports().length, 1); assert.equal(h.calls.length, 1);
 wait.reject({ code: 'network' }); await first; await h.submit();
 assert.equal(h.imports().length, 2); assert.equal(h.accepted.length, 1);
});

test('pending picker blocks manual submission and releases after cancellation', async () => {
 const wait = deferredImport(); const h = setup({ postImpl: path => path === '/api/browse' ? wait.promise : { id: 'manual', state: 'running' } });
 const picker = h.browse('files', true); await settleImport(); await h.submit();
 assert.equal(h.imports().length, 0); wait.resolve({ path: null }); await picker;
 await h.submit(); assert.equal(h.imports().length, 1);
});

test('declined discard releases picker ownership for a later explicit selection', async () => {
 let confirmations = 0;
 const h = setup({ discardImpl: () => ++confirmations > 1, importError: null });
 await h.browse('files', true); assert.equal(h.calls.length, 0);
 await h.browse('files', true); assert.equal(h.imports().length, 1);
});

for (const change of ['input', 'kind']) test(`late picker cannot overwrite newer ${change} or start its old import`, async () => {
 const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
 const pending = h.browse('files', true); await settleImport();
 if (change === 'input') { h.$('importPath').value = '/new/manual.wav'; h.$('importPath').input?.(); }
 else { h.$('importKind').value = 'manifest'; h.$('importKind').change?.(); }
 const value = h.$('importPath').value, kind = h.$('importKind').value;
 wait.resolve({ path: ['/old/picker.wav'] }); await pending;
 assert.equal(h.$('importPath').value, value); assert.equal(h.$('importKind').value, kind);
 assert.equal(h.imports().length, 0); assert.equal(h.opened.length, 0);
});

test('late picker failure cannot clear newer manual input or reopen its recovery dialog', async () => {
 const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
 const pending = h.browse('files', true); await settleImport();
 h.$('importPath').value = '/new/manual.wav'; h.$('importPath').input?.();
 wait.reject({ code: 'picker_unavailable' }); await pending;
 assert.equal(h.$('importPath').value, '/new/manual.wav'); assert.equal(h.opened.length, 0);
});

for (const change of ['input', 'kind']) test(`recovery confirmation cannot overwrite newer ${change} or reopen the old dialog`, async () => {
 const wait = deferredImport(); let confirmations = 0;
 const h = setup({ pickerError: { code: 'picker_unavailable' },
   discardImpl: () => ++confirmations === 1 ? true : wait.promise });
 const pending = h.browse('files', true); await settleImport();
 assert.equal(confirmations, 2);
 if (change === 'input') { h.$('importPath').value = '/new/confirmed.wav'; h.$('importPath').input?.(); }
 else { h.$('importKind').value = 'manifest'; h.$('importKind').change?.(); }
 const value = h.$('importPath').value, kind = h.$('importKind').value;
 wait.resolve(true); await pending;
 assert.equal(h.$('importPath').value, value); assert.equal(h.$('importKind').value, kind);
 assert.equal(h.opened.length, 0); assert.equal(h.focuses.length, 0);
 assert.equal(h.imports().length, 0);
});

for (const outcome of ['success', 'failure']) for (const change of ['input', 'kind', 'append']) {
 test(`manual ${outcome} after newer ${change} preserves the form and associates feedback with the submitted request`, async () => {
  const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
  const pending = h.submit();
  if (change === 'input') { h.$('importPath').value = '/new/next.wav'; h.$('importPath').input?.(); }
  else if (change === 'kind') { h.$('importKind').value = 'files'; h.$('importKind').change?.(); }
  else { h.$('appendImport').checked = true; h.$('appendImport').change?.(); }
  const expected = [h.$('importPath').value, h.$('importKind').value, h.$('appendImport').checked];
  if (outcome === 'success') wait.resolve({ id: 'submitted-job', state: 'running' });
  else wait.reject({ code: 'source_missing' });
  await pending;
  assert.deepEqual([h.$('importPath').value, h.$('importKind').value, h.$('appendImport').checked], expected);
  assert.equal(h.closed.length, 0); assert.equal(h.$('importError').hidden, true);
  assert.equal(h.notices.length, 0, 'Previous-request feedback must stay inside the modal');
  assert.equal(h.$('importPreviousStatus').dataset.result, outcome === 'success' ? 'started' : 'failed');
  if (outcome === 'success') { assert.equal(h.accepted[0].id, 'submitted-job'); assert.equal(h.$('importPreviousStatus').textContent, 'importEarlierStarted'); }
  else { assert.equal(h.accepted.length, 0); assert.equal(h.$('importPreviousStatus').textContent, 'importEarlierFailed Translated source_missing'); }
 });
}

test('changing append keeps exact picked paths while invalidating a late picker', async () => {
 const h = setup({ picker: ['/audio/first\nsecond.wav'] }); await h.browse('files', true);
 h.$('appendImport').checked = false; h.$('appendImport').change?.(); await h.submit();
 assert.deepEqual(h.imports()[1].payload, { kind: 'files', path: ['/audio/first\nsecond.wav'], append: false });
 const wait = deferredImport(), pendingPicker = setup({ postImpl: () => wait.promise });
 const pending = pendingPicker.browse('files', true); await settleImport();
 pendingPicker.$('appendImport').checked = true; pendingPicker.$('appendImport').change?.();
 wait.resolve({ path: ['/audio/old.wav'] }); await pending;
 assert.equal(pendingPicker.imports().length, 0);
});

test('a new deliberate submission clears the old request status', async () => {
 const h = setup({ importError: null });
 h.$('importPreviousStatus').dataset.result = 'failed'; h.$('importPreviousStatus').textContent = 'Old outcome';
 await h.submit(); assert.equal(h.$('importPreviousStatus').textContent, ''); assert.equal(h.$('importPreviousStatus').dataset.result, '');
});

for (const outcome of ['success', 'failure']) for (const edited of [false, true]) {
 test(`closed import dialog routes late ${outcome} to the page without reopening (edited=${edited})`, async () => {
  const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
  const pending = h.submit();
  if (edited) { h.$('importPath').value = '/new/kept.wav'; h.$('importPath').input(); }
  h.$('dismissImport').click();
  const path = h.$('importPath').value;
  if (outcome === 'success') wait.resolve({ id: 'accepted-once', state: 'running' });
  else wait.reject({ code: 'source_missing' });
  await pending;
  assert.equal(h.$('importDialog').open, false); assert.equal(h.opened.length, 0);
  assert.equal(h.closed.length, 1); assert.equal(h.$('importPath').value, path);
  assert.equal(h.$('importError').hidden, true);
  assert.deepEqual(h.notices, [outcome === 'success' ? 'importEarlierStarted' : 'importEarlierFailed Translated source_missing']);
  assert.equal(h.accepted.length, outcome === 'success' ? 1 : 0);
 });
}

for (const outcome of ['success', 'failure']) {
 test(`closing animation routes late ${outcome} without writing into the closing dialog`, async () => {
  const wait = deferredImport(), h = setup({ animateClose: true, postImpl: () => wait.promise });
  const pending = h.submit(); h.$('dismissImport').click();
  assert.equal(h.$('importDialog').open, true, 'The browser has not finished the close animation');
  if (outcome === 'success') wait.resolve({ id: 'closing-job', state: 'running' }); else wait.reject({ code: 'source_missing' });
  await pending;
  assert.equal(h.closed.length, 1); assert.equal(h.$('importError').hidden, true);
  assert.equal(h.$('importPreviousStatus').textContent, ''); assert.equal(h.notices.length, 1);
  assert.equal(h.accepted.length, outcome === 'success' ? 1 : 0);
 });
 test(`reopened unchanged form is not owned by an earlier ${outcome}`, async () => {
  const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
  const pending = h.submit(); h.$('dismissImport').click(); await h.openImport();
  const value = h.$('importPath').value;
  if (outcome === 'success') wait.resolve({ id: 'earlier-job', state: 'running' }); else wait.reject({ code: 'source_missing' });
  await pending;
  assert.equal(h.$('importDialog').open, true); assert.equal(h.closed.length, 1);
  assert.equal(h.$('importPath').value, value); assert.equal(h.$('importError').hidden, true);
  assert.equal(h.$('importPreviousStatus').textContent, '');
  assert.equal(h.accepted.length, outcome === 'success' ? 1 : 0);
 });
 test(`late ${outcome} preserves a newer page notification after dismissal`, async () => {
  const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
  const pending = h.submit(); h.$('dismissImport').click(); h.notify('Keep the newer notification');
  if (outcome === 'success') wait.resolve({ id: 'retained-job', state: 'running' }); else wait.reject({ code: 'source_missing' });
  await pending; assert.deepEqual(h.notices, ['Keep the newer notification']);
  assert.equal(h.accepted.length, outcome === 'success' ? 1 : 0);
 });
}

test('native cancellation revokes request ownership before its close event', async () => {
 const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
 const pending = h.submit(); h.$('importDialog').cancel();
 wait.reject({ code: 'source_missing' }); await pending;
 assert.equal(h.$('importError').hidden, true); assert.equal(h.notices.length, 1);
});

test('a queued old close event does not revoke an already reopened dialog', async () => {
 const h = setup({ importError: null }); h.$('dismissImport').click(); await h.openImport();
 h.$('importDialog').close(); await h.submit();
 assert.equal(h.accepted.length, 1); assert.equal(h.notices.length, 0);
});

test('a picker result from a dismissed session cannot overwrite an unchanged reopened form', async () => {
 const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
 const pending = h.browse('files', true); await settleImport();
 h.$('dismissImport').click(); await h.openImport();
 const path = h.$('importPath').value, kind = h.$('importKind').value;
 wait.resolve({ path: ['/stale/picker.wav'] }); await pending;
 assert.equal(h.$('importPath').value, path); assert.equal(h.$('importKind').value, kind);
 assert.equal(h.imports().length, 0); assert.equal(h.$('importDialog').open, true);
});

test('a failure suppressed by a newer notification remains readable after reopening import', async () => {
 const wait = deferredImport(), h = setup({ postImpl: () => wait.promise });
 const pending = h.submit(); h.$('dismissImport').click(); h.notify('A newer important notice');
 wait.reject({ code: 'source_missing' }); await pending;
 assert.deepEqual(h.notices, ['A newer important notice']);
 assert.equal(h.$('importSubmissionReceipt').hidden, false);
 assert.equal(h.$('importSubmissionReceipt').dataset.result, 'failed');
 assert.equal(h.$('importSubmissionReceiptText').textContent, 'importReceiptFailed Translated source_missing');
 const path = h.$('importPath').value; await h.openImport();
 assert.equal(h.$('importPath').value, path); assert.equal(h.$('importError').hidden, true);
 assert.equal(h.$('importSubmissionReceiptText').textContent, 'importReceiptFailed Translated source_missing');
 assert.equal(h.imports().length, 1);
});

test('a newer accepted submission replaces the last failure without claiming import completion', async () => {
 let calls = 0;
 const h = setup({ postImpl: () => ++calls === 1 ? Promise.reject({ code: 'network' }) : { id: 'new-job', state: 'running' } });
 await h.submit(); await h.submit();
 assert.equal(h.$('importSubmissionReceipt').dataset.result, 'started');
 assert.equal(h.$('importSubmissionReceipt').dataset.code, '');
 assert.equal(h.$('importSubmissionReceiptText').textContent, 'importReceiptStarted');
 assert.equal(h.accepted[0].id, 'new-job'); assert.equal(h.accepted.length, 1);
});

test('new input and a pending request do not erase the last completed submission feedback', async () => {
 let calls = 0; const wait = deferredImport();
 const h = setup({ postImpl: () => ++calls === 1 ? Promise.reject({ code: 'network' }) : wait.promise });
 await h.submit(); h.$('importPath').value = '/new/next.wav'; h.$('importPath').input();
 const pending = h.submit();
 assert.equal(h.$('importSubmissionReceipt').dataset.code, 'network');
 assert.equal(h.$('importSubmissionReceiptText').textContent, 'importReceiptFailed Translated network');
 wait.resolve({ id: 'new-job', state: 'running' }); await pending;
 assert.equal(h.$('importSubmissionReceipt').dataset.result, 'started');
});

test('local validation failure does not replace feedback for an actual earlier submission', async () => {
 const h = setup(); await h.submit();
 const result = h.$('importSubmissionReceiptText').textContent;
 h.$('importPath').value = ''; h.$('importPath').input(); await h.submit();
 assert.equal(h.imports().length, 1); assert.equal(h.$('importSubmissionReceiptText').textContent, result);
});

test('submission feedback stores no paths, input snapshots or raw error messages', async () => {
 const h = setup({ importError: { code: 'network', message: '/private/original.wav SECRET DETAIL' } });
 await h.submit();
 assert.deepEqual(h.$('importSubmissionReceipt').dataset, { result: 'failed', code: 'network' });
 assert.equal(h.$('importSubmissionReceiptText').textContent, 'importReceiptFailed Translated network');
});

for (const picker of [null, 'failure']) test(`picker ${picker || 'cancellation'} does not manufacture a submission receipt`, async () => {
 const h = picker === 'failure' ? setup({ pickerError: { code: 'picker_unavailable' } }) : setup({ picker });
 await h.browse('files', true); assert.equal(h.imports().length, 0);
 assert.equal(h.$('importSubmissionReceipt').hidden, true);
 assert.deepEqual(h.$('importSubmissionReceipt').dataset, {});
});

for (const success of [true, false]) test(`quick-add ${success ? 'acceptance' : 'failure'} records its actual submission result`, async () => {
 const h = setup({ importError: success ? null : { code: 'network' } });
 await h.browse('files', true); assert.equal(h.imports().length, 1);
 assert.equal(h.$('importSubmissionReceipt').dataset.result, success ? 'started' : 'failed');
 assert.equal(h.accepted.length, success ? 1 : 0);
});
