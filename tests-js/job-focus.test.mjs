import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function renderJob()'), source.indexOf('async function startImport('));
const cancelCode = source.slice(source.indexOf('$("cancelImport").addEventListener'), source.indexOf('$("rescan").addEventListener'));
const snapshot = (state = 'running', phase = 'reading') => ({ id: 'job', state, phase, done: 1, total: 2, label: 'clip' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Native disable/hide blur is modeled here; this is not a browser focus test.
function setup({ mobile = false, onSummary = () => {} } = {}) {
  const document = { body: { id: 'body' }, activeElement: null };
  document.activeElement = document.body;
  const nodes = new Map(), focuses = [], posts = [], notices = [], starts = [], refreshing = deferred();
  const pending = deferred(); let callbacks;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, isConnected: true, visible: true, _disabled: false, _hidden: false, style: {},
      get disabled() { return this._disabled; }, set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; },
      get hidden() { return this._hidden; }, set hidden(value) { this._hidden = value; if (value && id === 'jobStrip' && document.activeElement === $('cancelImport')) document.activeElement = document.body; },
      getClientRects() { return this.isConnected && this.visible && !this.hidden ? [{ width: mobile ? 32 : 180 }] : []; },
      focus(options) { document.activeElement = this; focuses.push({ id, options }); },
      removeAttribute() {}, addEventListener(type, callback) { this[type] = callback; },
    });
    return nodes.get(id);
  };
  const env = { $, document, t: key => key, errorText: error => error.message,
    createJobPoller(options) { callbacks = options; return { start: value => starts.push(value) }; },
    request: async () => snapshot(), post: (...args) => { posts.push(args); return pending.promise; },
    renderSummary: () => onSummary({ $, document }), invalidateRefresh() {},
    captureNotice: (...args) => notices.push(args), refresh: (_force, { feedback }) => { feedback.owner = { publish: (message, ...args) => notices.push([typeof message === "function" ? message() : message, ...args]) }; return refreshing.promise; },
  };
  const control = Function(...Object.keys(env), `let job = null, state = {}, suspendedCompletion = null, refreshGeneration = 0,
    handledJob = null, dirty = false, pendingCompletion = null, language = 'en';
    let noticeGeneration = 0, noticeResolver = null;
    function notice(message = '', ...args) { noticeGeneration++; noticeResolver = typeof message === 'function' ? message : null; if (arguments.length) captureNotice(noticeResolver ? noticeResolver() : message, ...args); else captureNotice(); }
    ${source.slice(source.indexOf('function createFeedbackOwner()'), source.indexOf('function invalidateRefresh()'))}
    const importing = () => job && ['running', 'cancelling'].includes(job.state);
    ${code}\n${cancelCode}
    return { acceptJob };`)(...Object.values(env));
  control.acceptJob(snapshot());
  return { $, document, focuses, posts, pending, refreshing, notices, starts, callbacks, ...control,
    focusStop() { document.activeElement = $('cancelImport'); },
    poll(next) { return callbacks.onSnapshot(next, { restoring: false }); },
  };
}
for (const mobile of [false, true]) {
  for (const [state, phase] of [['cancelling', 'reading'], ['running', 'saving'], ['succeeded', 'done'], ['cancelled', 'done'], ['failed', 'done']]) {
    test(`${mobile ? 'mobile' : 'desktop'} ${state}/${phase} hands off Stop once`, async () => {
      const h = setup({ mobile }); h.focusStop();
      const poll = h.poll(snapshot(state, phase));
      assert.equal(h.document.activeElement, h.$('openCommands'));
      assert.deepEqual(h.focuses, [{ id: 'openCommands', options: { preventScroll: true } }]);
      h.refreshing.resolve(true); await poll;
      await h.poll(snapshot(state, phase));
      assert.equal(h.focuses.length, 1);
    });
  }
}
test('actual cancel POST acceptance hands focus off without repeating the mutation', async () => {
  const h = setup(); h.focusStop(); const cancel = h.$('cancelImport').click();
  assert.deepEqual(h.posts, [['/api/cancel-import', { id: 'job' }]]);
  h.pending.resolve(snapshot('cancelling')); await cancel;
  assert.equal(h.document.activeElement, h.$('openCommands'));
  await h.poll(snapshot('cancelled', 'done'));
  assert.equal(h.posts.length, 1); assert.equal(h.focuses.length, 1);
});
for (const blur of [false, true]) test(`cancel response preserves newer ${blur ? 'moved then blurred' : 'focused'} target`, async () => {
  const h = setup(); h.focusStop(); const cancel = h.$('cancelImport').click();
  h.document.activeElement = h.$('search');
  if (blur) h.document.activeElement = h.document.body;
  h.pending.resolve(snapshot('cancelling')); await cancel;
  assert.equal(h.document.activeElement, blur ? h.document.body : h.$('search'));
  assert.equal(h.focuses.length, 1);
});
test('cancel failure keeps Stop locked until fresh observation without repeat POST', async () => {
  const h = setup(); h.focusStop(); const cancel = h.$('cancelImport').click();
  h.pending.reject(new Error('failure')); await cancel;
  assert.equal(h.document.activeElement, h.$('openCommands'));
  assert.equal(h.$('cancelImport').disabled, true);
  assert.equal(h.posts.length, 1); assert.equal(h.focuses.length, 1);
  assert.equal(h.starts.at(-1), undefined);
});
for (const unavailable of ['detached stop', 'detached fallback', 'hidden fallback', 'disabled fallback']) test(`${unavailable} prevents unsafe fallback`, async () => {
  const h = setup(); h.focusStop();
  if (unavailable === 'detached stop') h.$('cancelImport').isConnected = false;
  if (unavailable === 'detached fallback') h.$('openCommands').isConnected = false;
  if (unavailable === 'hidden fallback') h.$('openCommands').visible = false;
  if (unavailable === 'disabled fallback') h.$('openCommands').disabled = true;
  await h.poll(snapshot('running', 'saving'));
  assert.equal(h.focuses.length, 0);
});
test('synchronous rendering redirect keeps its newer focus', async () => {
  let redirect = false;
  const h = setup({ onSummary: ({ $, document }) => { if (redirect) document.activeElement = $('search'); } });
  h.focusStop(); redirect = true; await h.poll(snapshot('running', 'saving'));
  assert.equal(h.document.activeElement, h.$('search')); assert.equal(h.focuses.length, 0);
});
test('ordinary reading poll leaves enabled Stop focused', async () => {
  const h = setup(); h.focusStop(); await h.poll(snapshot());
  assert.equal(h.document.activeElement, h.$('cancelImport')); assert.equal(h.focuses.length, 0);
});
test('no handoff if disabling Stop did not displace focus', async () => {
  const h = setup();
  Object.defineProperty(h.$('cancelImport'), 'disabled', { value: false, writable: true });
  h.focusStop(); await h.poll(snapshot('running', 'saving'));
  assert.equal(h.$('cancelImport').disabled, true);
  assert.equal(h.document.activeElement, h.$('cancelImport'));
  assert.equal(h.focuses.length, 0);
});
test('later catalog refresh does not take focus back from deliberate navigation', async () => {
  const h = setup(); h.focusStop();
  const poll = h.poll(snapshot('succeeded', 'done'));
  assert.equal(h.document.activeElement, h.$('openCommands'));
  h.document.activeElement = h.$('search');
  h.refreshing.resolve(true); await poll;
  assert.equal(h.document.activeElement, h.$('search'));
  assert.equal(h.focuses.length, 1);
});
