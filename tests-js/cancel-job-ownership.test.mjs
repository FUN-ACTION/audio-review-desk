import test from 'node:test';
import { words } from '../src/audio_review_desk/static/copy.js';
import { errorText } from '../src/audio_review_desk/static/errors.js';
import { createJobPoller } from '../src/audio_review_desk/static/job-poller.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function renderJob()'), source.indexOf('async function startImport('));
const cancelCode = source.slice(source.indexOf('$("cancelImport").addEventListener'), source.indexOf('$("rescan").addEventListener'));
const snapshot = (state = 'running', phase = 'reading') => ({ id: 'job', state, phase, done: 1, total: 2, label: 'clip' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return { AbortController,
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    get count() { return timers.size; },
    async tick(ms = 0) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      now = end; await tick();
    },
  };
}

// Native disable/hide blur is modeled here; this is not a browser focus test.
function setup({ mobile = false, onSummary = () => {}, onReveal = () => {} } = {}) {
  const document = { body: { id: 'body' }, activeElement: null };
  document.activeElement = document.body;
  const nodes = new Map(), focuses = [], posts = [], notices = [], starts = [], refreshing = deferred();
  const runtime = clock(), reads = []; let callbacks;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, isConnected: true, visible: true, _disabled: false, _hidden: false, style: {}, classList: { toggle() {} },
      get disabled() { return this._disabled; }, set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; },
      get hidden() { return this._hidden; }, set hidden(value) { this._hidden = value; if (value && id === 'jobStrip' && document.activeElement === $('cancelImport')) document.activeElement = document.body; },
      getClientRects() { return this.isConnected && this.visible && !this.hidden ? [{ width: mobile ? 32 : 180 }] : []; },
      focus(options) { document.activeElement = this; focuses.push({ id, options }); },
      removeAttribute() {}, addEventListener(type, callback) { this[type] = callback; },
    });
    return nodes.get(id);
  };
  const env = { $, document, words, errorText, clearTimeout: runtime.clearTimeout, setTimeout: runtime.setTimeout, reveal() { onReveal({ $, feedback: (...args) => control.feedback(...args) }); },
    createJobPoller(options) { callbacks = options; return createJobPoller(options, runtime); },
    request: (path, options) => { const d = deferred(); reads.push({path, signal: options.signal, ...d}); return d.promise; }, post: (path, payload) => { const d = deferred(); posts.push({path, payload, ...d}); return d.promise; },
    renderSummary: () => onSummary({ $, document }), invalidateRefresh() {},
    captureNotice: (...args) => { notices.push(args); $("notice").textContent = args[0] || ""; }, refresh: (_force, { feedback }) => { feedback.owner = { publish: (message, ...args) => notices.push([typeof message === "function" ? message() : message, ...args]) }; return Promise.resolve(true); },
  };
  const control = Function(...Object.keys(env), `let job = null, state = {}, suspendedCompletion = null, refreshGeneration = 0,
    handledJob = null, dirty = false, pendingCompletion = null, language = 'en';
    let noticeGeneration = 0, noticeResolver = null;
    let noticeTimer = null;
    const t = key => words[language][key] || key;
    ${source.slice(source.indexOf('function notice('), source.indexOf('async function request('))}
    ${source.slice(source.indexOf('function createFeedbackOwner()'), source.indexOf('function invalidateRefresh()'))}
    const importing = () => job && ['running', 'cancelling'].includes(job.state);
    ${code}\n${cancelCode}
    return { acceptJob, language(value) { language = value; if (noticeResolver) $('notice').textContent = noticeResolver(); }, feedback: notice, stop: () => jobPoller.stop(),
      get current() { return { job, cancelRequest, generation: jobSnapshotGeneration }; } };`)(...Object.values(env));
  control.acceptJob(snapshot());
  return { $, document, focuses, posts, reads, runtime, refreshing, notices, starts, callbacks, ...control, get current() { return control.current; },
    focusStop() { document.activeElement = $('cancelImport'); },
    poll(next) { return callbacks.onSnapshot(next, { restoring: false }); },
  };
}
for (const state of ['cancelled', 'failed', 'succeeded']) {
  test(`late cancellation acknowledgement cannot regress ${state} or restart observation`, async () => {
    const h = setup(), pending = h.$('cancelImport').click();
    await h.poll(snapshot(state, 'done')); const before = h.current.job, timers = h.runtime.count;
    h.posts[0].resolve(snapshot('cancelling')); await pending;
    assert.equal(h.current.job, before); assert.equal(h.current.cancelRequest, null); assert.equal(h.runtime.count, timers);
    h.stop();
  });
}
for (const failure of [false, true]) {
  test(`old cancellation ${failure ? 'failure' : 'success'} cannot replace new job or its lock`, async () => {
    const h = setup(), old = h.$('cancelImport').click(); h.acceptJob({...snapshot(), id:'new'});
    const next = h.$('cancelImport').click(), before = h.current.cancelRequest;
    if (failure) h.posts[0].reject(new Error('old failure')); else h.posts[0].resolve(snapshot('cancelling'));
    await old; assert.equal(h.current.job.id, 'new'); assert.equal(h.current.cancelRequest, before); assert.equal(h.notices.length, 0);
    h.posts[1].resolve({...snapshot('cancelling'),id:'new'}); await next;
    assert.equal(h.current.job.id, 'new'); assert.equal(h.current.job.state, 'cancelling'); h.stop();
  });
}
test('same-job progress is retained while cancellation acknowledgement changes only state', async () => {
  const h = setup(), pending = h.$('cancelImport').click();
  await h.poll({...snapshot(),done:8,total:10,label:'newer file'});
  h.posts[0].resolve(snapshot('cancelling')); await pending;
  assert.equal(h.current.job.state,'cancelling'); assert.equal(h.current.job.done,8);
  assert.equal(h.current.job.total,10); assert.equal(h.current.job.label,'newer file'); h.stop();
});
test('saving snapshot is never regressed by late cancellation acknowledgement', async () => {
  const h=setup(), pending=h.$('cancelImport').click(); await h.poll(snapshot('running','saving'));
  const current=h.current.job; h.posts[0].resolve(snapshot('cancelling')); await pending;
  assert.equal(h.current.job,current); assert.equal(h.$('cancelImport').disabled,true); h.stop();
});
test('double activation sends one POST and an accepted cancellation remains disabled', async () => {
  const h=setup(), first=h.$('cancelImport').click(); await h.$('cancelImport').click();
  assert.equal(h.posts.length,1); assert.equal(h.$('cancelImport').disabled,true);
  h.posts[0].resolve(snapshot('cancelling')); await first; await h.$('cancelImport').click();
  assert.equal(h.posts.length,1); assert.equal(h.current.job.state,'cancelling'); h.stop();
});
for (const outcome of ['reject','wrong-id','malformed']) {
  test(`uncertain ${outcome} stays locked until a GET started after POST settlement`, async () => {
    const h=setup(); await h.runtime.tick(200); assert.equal(h.reads.length,1);
    const oldRead=h.reads[0], pending=h.$('cancelImport').click();
    if(outcome==='reject') h.posts[0].reject(new Error('response lost'));
    else h.posts[0].resolve(outcome==='wrong-id'?{...snapshot('cancelling'),id:'other'}:{});
    await pending; assert.equal(h.current.cancelRequest.phase,'confirming'); assert.equal(oldRead.signal.aborted,true);
    await h.$('cancelImport').click(); assert.equal(h.posts.length,1);
    oldRead.resolve(snapshot()); await tick();
    assert.equal(h.current.cancelRequest.phase,'confirming'); assert.equal(h.$('cancelImport').disabled,true);
    await h.runtime.tick(0); assert.equal(h.reads.length,2);
    h.reads[1].resolve(snapshot()); await tick();
    assert.equal(h.current.cancelRequest,null); assert.equal(h.$('cancelImport').disabled,false);
    assert.equal(h.posts.length,1); h.stop();
  });
}
test('a successful pre-settlement GET cannot release the POST or its later confirmation lock', async () => {
  const h=setup(); await h.runtime.tick(200); const oldRead=h.reads[0], pending=h.$('cancelImport').click();
  oldRead.resolve({...snapshot(),done:2}); await tick(); assert.equal(h.current.cancelRequest.phase,'posting');
  h.posts[0].reject(new Error('lost')); await pending; assert.equal(h.current.cancelRequest.phase,'confirming');
  await h.runtime.tick(0); h.reads.at(-1).resolve(snapshot('cancelling')); await tick();
  assert.equal(h.current.cancelRequest,null); assert.equal(h.current.job.state,'cancelling'); assert.equal(h.$('cancelImport').disabled,true); h.stop();
});
test('confirmation read failures retain the lock, retry only GET, and recover on terminal', async () => {
  const h=setup(), pending=h.$('cancelImport').click(); h.posts[0].reject(new Error('lost')); await pending;
  await h.runtime.tick(0); h.reads.at(-1).reject(new Error('offline')); await tick();
  assert.equal(h.current.cancelRequest.phase,'confirming'); await h.$('cancelImport').click();assert.equal(h.posts.length,1);
  await h.runtime.tick(700);h.reads.at(-1).resolve(snapshot('cancelled','done'));await tick();
  assert.equal(h.current.job.state,'cancelled');assert.equal(h.current.cancelRequest,null);assert.equal(h.runtime.count,0);h.stop();
});
test('a newer notice is not overwritten by cancellation failure',async()=>{
  const h=setup(),pending=h.$('cancelImport').click();h.feedback('new saved notice');
  h.posts[0].reject(new Error('lost'));await pending;assert.equal(h.$('notice').textContent,'new saved notice');h.stop();
});
test('uncertain cancellation error follows language without releasing lock or repeating POST',async()=>{
  const h=setup(),pending=h.$('cancelImport').click();h.posts[0].reject(Object.assign(new Error('lost'),{code:'network'}));await pending;
  assert.equal(h.$('notice').textContent,errorText({code:'network'},'en'));
  h.language('zh');assert.equal(h.$('notice').textContent,errorText({code:'network'},'zh'));
  assert.equal(h.current.cancelRequest.phase,'confirming');await h.$('cancelImport').click();assert.equal(h.posts.length,1);h.stop();
});
for(const state of ['cancelled','failed','succeeded'])test(`late failure after ${state} cannot overwrite terminal notice`,async()=>{
 const h=setup(),pending=h.$('cancelImport').click();await h.poll(snapshot(state,'done'));h.feedback('terminal result');
 const before=h.current.job;h.posts[0].reject(new Error('late'));await pending;
 assert.equal(h.current.job,before);assert.equal(h.$('notice').textContent,'terminal result');h.stop();
});

async function uncertain(h) {
  const pending = h.$('cancelImport').click();
  h.posts.at(-1).reject(Object.assign(new Error('lost'), { code: 'network' }));
  await pending;
  return h.current.cancelRequest;
}
for (const [state, phase] of [['running','reading'], ['cancelling','reading'], ['running','saving']]) {
  test(`confirmed ${state}/${phase} retires its own cancellation error`, async () => {
    const h = setup(), operation = await uncertain(h);
    assert.equal(typeof operation.errorResolver, 'function');
    h.language('zh'); assert.equal(h.$('notice').textContent, errorText({code:'network'}, 'zh'));
    await h.runtime.tick(0); h.reads.at(-1).resolve(snapshot(state, phase)); await tick();
    assert.equal(h.current.cancelRequest, null); assert.equal(operation.errorResolver, null);
    assert.equal(h.$('notice').hidden, true); assert.equal(h.$('notice').textContent, '');
    h.language('en'); assert.equal(h.$('notice').textContent, '');
    assert.equal(h.posts.length, 1); h.stop();
  });
}
for (const newer of ['fixed', 'same-text', 'clear-then-new', 'expired-success']) {
  test(`confirmation preserves newer ${newer} notification ownership`, async () => {
    const h = setup(), operation = await uncertain(h), old = h.$('notice').textContent;
    if (newer === 'clear-then-new') h.feedback();
    h.feedback(newer === 'same-text' ? () => old : 'new message', newer === 'expired-success');
    if (newer === 'expired-success') await h.runtime.tick(4000);
    const text = h.$('notice').textContent, hidden = h.$('notice').hidden;
    // Poll timing is controlled separately from direct snapshot delivery here.
    operation.snapshot = snapshot(); await h.poll(operation.snapshot);
    assert.equal(h.current.cancelRequest, null); assert.equal(operation.errorResolver, null);
    assert.equal(h.$('notice').textContent, text); assert.equal(h.$('notice').hidden, hidden);
    assert.equal(operation.feedback.owns(), false); h.stop();
  });
}
test('a new job retires only the old cancellation error before taking its own lock', async () => {
  const h = setup(), old = await uncertain(h);
  h.acceptJob({...snapshot(), id:'new'});
  assert.equal(old.errorResolver, null); assert.equal(h.$('notice').hidden, true);
  const pending = h.$('cancelImport').click(), next = h.current.cancelRequest;
  h.posts.at(-1).resolve({...snapshot('cancelling'),id:'new'}); await pending;
  assert.equal(next.errorResolver, null); assert.equal(h.current.job.id, 'new'); h.stop();
});
for (const state of ['cancelled', 'failed']) {
  test(`retiring error precedes ${state} terminal feedback`, async () => {
    const h = setup(), operation = await uncertain(h);
    await h.runtime.tick(0); h.reads.at(-1).resolve({...snapshot(state,'done'), code:'invalid_audio'}); await tick();
    assert.equal(operation.errorResolver, null); assert.equal(h.current.cancelRequest, null);
    assert.equal(h.$('notice').hidden, false);
    assert.equal(h.$('notice').textContent, state === 'cancelled' ? words.en.jobCancelled : errorText({code:'invalid_audio'},'en'));
    h.stop();
  });
}
test('failed confirmation reads replace the error without restoring cancelled feedback ownership', async () => {
  const h = setup(), operation = await uncertain(h);
  for (const delay of [0,700]) {
    await h.runtime.tick(delay); h.reads.at(-1).reject(Object.assign(new Error('read failed'),{code:'network'})); await tick();
    assert.equal(h.current.cancelRequest, operation); assert.equal(h.$('notice').hidden, false);
  }
  await h.runtime.tick(1400); h.reads.at(-1).resolve(snapshot()); await tick();
  assert.equal(h.current.cancelRequest, null); assert.equal(h.$('notice').hidden, true);
  assert.equal(operation.errorResolver, null); assert.equal(operation.feedback.owns(), false);
  assert.equal(h.posts.length, 1); h.stop();
});
test('failed publication stores no resolver and retirement cannot clear a newer fixed notice', async () => {
  const h = setup(), pending = h.$('cancelImport').click(); h.feedback('new saved message');
  h.posts.at(-1).reject(new Error('lost')); await pending;
  const operation = h.current.cancelRequest; assert.equal(operation.errorResolver, null);
  await h.runtime.tick(0); h.reads.at(-1).resolve(snapshot()); await tick();
  assert.equal(h.$('notice').textContent,'new saved message'); h.stop();
});

test('reentrant publication never records or clears the newer resolver', async () => {
  let first = true;
  const h = setup({ onReveal({ feedback }) { if (first) { first = false; feedback(() => 'new reentrant notice'); } } });
  const operation = await uncertain(h);
  assert.equal(operation.errorResolver, null);
  await h.runtime.tick(0); h.reads.at(-1).resolve(snapshot()); await tick();
  assert.equal(h.$('notice').textContent, 'new reentrant notice'); h.stop();
});
