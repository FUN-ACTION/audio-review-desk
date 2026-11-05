import test from "node:test";
import assert from "node:assert/strict";
import { createDraftSession } from "../src/audio_review_desk/static/draft-session.js";
import { createDraftRecovery } from "../src/audio_review_desk/static/draft-recovery.js";

// Pure coordinator/storage tests with synthetic reviews and deferred decisions.
// They exercise ownership, not browser rendering or actual reload acceptance.
const WORKSPACE = "a".repeat(64), OTHER_WORKSPACE = "b".repeat(64);
const KEY = "c".repeat(64), OTHER_KEY = "d".repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
const review = (patch = {}) => ({ version: 3, status: "fix", score: 8,
  trim_start: 1, trim_end: 9, issues: ["noise"], note: "Saved review",
  markers: [{ time: 2.123456789, text: "Saved marker" }], ...patch });
const draft = (patch = {}) => ({
  key: KEY, baseline: review(),
  form: { status: "fix", score: "0", trimStart: "01.2300", trimEnd: "bad-number",
    issues: ["noise", "other"], note: "Pending\nreview <script>" },
  markers: { rows: [{ time: 2.123456789, text: "Saved marker" }], input: "  unfinished input  ",
    editing: { index: 0, time: "1e", text: "  editing text  ", originalTime: 2.123456789, timeDirty: true } },
  ...patch,
});

function setup({ pending = null, initial = {}, readFails = false, reentrant = true,
  resetOnConfirm = true, canApply = null } = {}) {
  const data = new Map(), operations = [], views = [], confirmations = [];
  let failGet = readFails, failSet = false, failRemove = false;
  let captures = 0, applications = 0, resets = 0, nextTime = 100;
  let editor = { form: { ...draft().form, note: "Live editor" }, markers: draft().markers };
  let applyResult = true, applyThrows = false, captureThrows = false;
  const storage = {
    getItem(key) { operations.push(["get", key]); if (failGet) throw Error("denied"); return data.get(key) ?? null; },
    setItem(key, value) { operations.push(["set", key, value]); if (failSet) throw Error("quota"); data.set(key, value); },
    removeItem(key) { operations.push(["remove", key]); if (failRemove) throw Error("denied"); data.delete(key); },
  };
  const makeStore = workspaceId => createDraftRecovery({ storage, workspaceId, now: () => nextTime++ });
  if (pending) {
    const before = failGet;
    failGet = false;
    assert.equal(makeStore(WORKSPACE).write(pending).status, "saved");
    failGet = before;
    operations.length = 0;
  }
  const current = { workspaceId: WORKSPACE, key: KEY, review: review(), dirty: false, busy: false,
    selectionTurn: 1, refreshTurn: 1, historyTurn: 1, duration: 10, ...initial };
  const session = createDraftSession({
    createStore: makeStore,
    current: () => current,
    capture() {
      captures++;
      if (captureThrows) throw Error("capture failed");
      return clone(editor);
    },
    canApply: canApply || (record => record.markers.rows.every(row => row.time <= current.duration)),
    apply(record) {
      applications++;
      if (applyThrows) throw Error("apply failed");
      if (!applyResult) return false;
      editor = { form: clone(record.form), markers: clone(record.markers) };
      current.dirty = true;
      current.refreshTurn++;
      if (reentrant) session.changed();
      return true;
    },
    confirmDiscard(guard) {
      return new Promise(resolve => confirmations.push({ guard, answer(allowed) {
        // Model the workbench's pre-destructive guard, not merely a guard after
        // the asynchronous decision has already erased newer editor state.
        if (allowed && guard() && resetOnConfirm) { resets++; current.dirty = false; }
        resolve(allowed);
      } }));
    },
    onChange: value => views.push(value),
  });
  return {
    session, current, data, operations, views, confirmations,
    initialize: () => session.initialize(current.workspaceId),
    change(note = "New live draft") { editor.form.note = note; current.dirty = true; current.refreshTurn++; return session.changed(); },
    get editor() { return editor; },
    get captures() { return captures; },
    get applications() { return applications; },
    get resets() { return resets; },
    set failGet(value) { failGet = value; },
    set failSet(value) { failSet = value; },
    set failRemove(value) { failRemove = value; },
    set applyResult(value) { applyResult = value; },
    set applyThrows(value) { applyThrows = value; },
    set captureThrows(value) { captureThrows = value; },
    count: kind => operations.filter(row => row[0] === kind).length,
  };
}

test("startup, repeated initialization, selection and clean redraw never write, capture or apply", () => {
  for (const pending of [null, draft()]) {
    const h = setup({ pending });
    h.initialize(); h.initialize(); h.session.refresh(); h.session.changed();
    h.current.key = OTHER_KEY; h.current.selectionTurn++; h.session.refresh(); h.session.changed();
    assert.equal(h.captures, 0); assert.equal(h.applications, 0);
    assert.equal(h.count("set"), 0); assert.equal(h.count("remove"), 0);
    assert.equal(h.session.state().owned, false);
    assert.equal(h.session.state().record?.form.note ?? null, pending?.form.note ?? null);
  }
});

test("meaningful edits preserve raw form and marker drafts without flushing or normalizing", () => {
  const h = setup(); h.initialize(); h.change();
  const view = h.session.state();
  assert.equal(view.status, "available"); assert.equal(view.owned, true); assert.equal(view.protected, true);
  assert.deepEqual(view.record.form, h.editor.form); assert.deepEqual(view.record.markers, h.editor.markers);
  assert.equal(view.record.baseline.version, 3); assert.equal(view.record.baseline.note, "Saved review");
  assert.equal(h.count("set"), 1); assert.equal(h.applications, 0);
  h.session.changed(); h.session.changed();
  assert.equal(h.count("set"), 1, "identical callbacks do not rewrite timestamps/storage");
});

for (const field of ["input", "editing"]) {
  test(`Unicode ${field} draft protection returns after shortening without overwriting the last valid copy`, () => {
    const h = setup(); h.initialize();
    const setText = text => field === "input" ? h.editor.markers.input = text : h.editor.markers.editing.text = text;
    const readText = record => field === "input" ? record.markers.input : record.markers.editing.text;
    const valid = "🎧".repeat(240), invalid = "声".repeat(241), corrected = "声".repeat(240);
    setText(valid); h.change();
    assert.equal(h.session.state().protected, true);
    assert.equal(readText(h.session.state().record), valid);
    const previous = [...h.data.entries()];

    setText(invalid); h.change();
    assert.equal(h.session.state().protected, false);
    assert.equal(h.session.state().status, "invalid");
    assert.equal(readText(h.session.state().record), valid);
    assert.equal(readText(h.editor), invalid, "invalid raw input remains in the live editor");
    assert.deepEqual([...h.data.entries()], previous);

    setText(corrected); h.change();
    assert.equal(h.session.state().protected, true);
    assert.equal(readText(h.session.state().record), corrected);
    assert.equal(h.count("set"), 2);
  });
}

test("pending recovery is never overwritten by a live edit, even for the same selection and baseline", () => {
  const h = setup({ pending: draft() }); h.initialize(); h.change(); h.session.changed();
  assert.equal(h.captures, 0); assert.equal(h.count("set"), 0); assert.equal(h.count("remove"), 0);
  assert.equal(h.session.state().protected, false); assert.equal(h.session.state().reason, "pending");
  assert.equal(h.session.state().record.form.note, draft().form.note);
});

test("explicit restore applies only editor fields and persists once after reentrant markDirty", async () => {
  const h = setup({ pending: draft() }); h.initialize();
  const saved = h.current.review;
  assert.equal(h.session.state().canRestore, true);
  assert.equal(await h.session.restore(), true);
  assert.equal(h.applications, 1); assert.equal(h.captures, 1);
  assert.equal(h.current.review, saved); assert.equal(h.current.review.version, 3);
  assert.deepEqual(h.editor.form, draft().form); assert.deepEqual(h.editor.markers, draft().markers);
  assert.equal(h.current.dirty, true); assert.equal(h.session.state().protected, true);
  assert.equal(h.session.state().canRestore, false); assert.equal(await h.session.restore(), false);
  assert.equal(h.count("set"), 0, "unchanged restored snapshot already protects this exact draft");
});

test("dirty editor restore asks once, cancellation keeps both pending recovery and live input", async () => {
  const h = setup({ pending: draft() }); h.initialize(); h.change("Keep my current edit");
  const pending = h.session.restore();
  assert.equal(h.confirmations.length, 1); assert.equal(h.session.state().restoring, true);
  assert.equal(await h.session.restore(), false);
  assert.equal(h.session.forget(), false); assert.equal(h.session.discardCurrent(), false);
  h.confirmations[0].answer(false);
  assert.equal(await pending, false); assert.equal(h.applications, 0); assert.equal(h.resets, 0);
  assert.equal(h.editor.form.note, "Keep my current edit"); assert.equal(h.current.dirty, true);
  assert.equal(h.session.state().record.form.note, draft().form.note); assert.equal(h.session.state().restoring, false);
});

test("accepted dirty restore uses the guard before discard and preserves the server baseline", async () => {
  const h = setup({ pending: draft() }); h.initialize(); h.change();
  const pending = h.session.restore(); h.confirmations[0].answer(true);
  assert.equal(await pending, true); assert.equal(h.resets, 1); assert.equal(h.applications, 1);
  assert.equal(h.current.dirty, true); assert.equal(h.current.review.note, "Saved review");
});

const staleChanges = {
  selection: h => { h.current.selectionTurn++; },
  key: h => { h.current.key = OTHER_KEY; },
  sourceMissing: h => { h.current.key = null; h.current.review = null; },
  workspace: h => { h.current.workspaceId = OTHER_WORKSPACE; },
  refresh: h => { h.current.refreshTurn++; },
  history: h => { h.current.historyTurn++; },
  busy: h => { h.current.busy = true; },
  version: h => { h.current.review = review({ version: 4 }); },
  sameVersionDifferentContent: h => { h.current.review = review({ note: "Changed content at version 3" }); },
};
for (const [name, change] of Object.entries(staleChanges)) {
  test(`restore decision cannot discard or overwrite newer context: ${name}`, async () => {
    const h = setup({ pending: draft() }); h.initialize(); h.change("Keep newer edit");
    const pending = h.session.restore(); change(h); h.session.refresh();
    assert.equal(h.confirmations[0].guard(), false);
    h.confirmations[0].answer(true);
    assert.equal(await pending, false); assert.equal(h.resets, 0); assert.equal(h.applications, 0);
    assert.equal(h.current.dirty, true); assert.equal(h.editor.form.note, "Keep newer edit");
    assert.equal(h.session.state().record.form.note, draft().form.note);
    assert.equal(h.count("set"), 0); assert.equal(h.count("remove"), 0);
  });
}

test("context mismatches refuse restore immediately, but retain stale recovery for inspection and forgetting", async () => {
  for (const change of [staleChanges.key, staleChanges.sourceMissing, staleChanges.workspace,
    staleChanges.busy, staleChanges.version, staleChanges.sameVersionDifferentContent]) {
    const h = setup({ pending: draft() }); h.initialize(); change(h);
    assert.equal(h.session.state().canRestore, false); assert.equal(await h.session.restore(), false);
    assert.equal(h.confirmations.length, 0); assert.equal(h.applications, 0);
    assert.ok(h.session.state().record); assert.equal(h.count("remove"), 0);
  }
});

test("canonical baseline matching ignores metadata and issue order, but checks markers and all review values", async () => {
  const pending = draft({ baseline: review({ issues: ["noise", "other"] }) });
  const h = setup({ pending, initial: { review: review({ issues: ["other", "noise"], origin: "ui", updated_utc: "later" }) } });
  h.initialize(); assert.equal(await h.session.restore(), true);
  for (const patch of [{ score: 0 }, { status: "pass" }, { trim_start: 0 }, { trim_end: null },
    { issues: [] }, { markers: [{ time: 2.123456790, text: "Saved marker" }] }]) {
    const stale = setup({ pending: draft(), initial: { review: review(patch) } }); stale.initialize();
    assert.equal(await stale.session.restore(), false);
  }
});

test("clean owned draft clears only its own live snapshot; clean unowned draft remains", () => {
  const h = setup(); h.initialize(); h.change(); h.current.dirty = false; h.session.changed();
  assert.equal(h.session.state().status, "empty"); assert.equal(h.session.state().record, null);
  assert.equal(h.count("remove"), 1); h.session.changed(); assert.equal(h.count("remove"), 1);
  const pending = setup({ pending: draft() }); pending.initialize(); pending.session.changed();
  assert.equal(pending.count("remove"), 0); assert.ok(pending.session.state().record);
});

test("owned snapshot cannot silently become another selection's live draft or clear after navigating away and back", () => {
  const h = setup(); h.initialize(); h.change();
  h.current.key = OTHER_KEY; h.current.selectionTurn++; h.change("Other clip draft");
  assert.equal(h.session.state().owned, false); assert.equal(h.count("set"), 1);
  assert.equal(h.session.discardCurrent(), false);
  h.current.key = KEY; h.current.selectionTurn++; h.current.dirty = false; h.session.changed();
  assert.equal(h.session.state().owned, false); assert.equal(h.count("remove"), 0);
  assert.equal(h.session.state().canRestore, true);
});

test("discardCurrent removes only an applicable owned snapshot, including retry after deletion failure", () => {
  const h = setup(); h.initialize(); h.change(); h.failRemove = true;
  assert.equal(h.session.discardCurrent(), false); assert.equal(h.session.state().status, "unavailable");
  assert.equal(h.session.state().protected, false); assert.ok(h.session.state().record);
  h.failRemove = false; assert.equal(h.session.discardCurrent(), true);
  assert.equal(h.session.state().record, null); assert.equal(h.session.discardCurrent(), false);
  const pending = setup({ pending: draft() }); pending.initialize();
  assert.equal(pending.session.discardCurrent(), false); assert.equal(pending.count("remove"), 0);
});

test("confirmed save clears only the owned submitted baseline even after the server version changes", () => {
  const h = setup(); h.initialize(); h.change();
  assert.equal(h.session.saved(OTHER_KEY, 3), false); assert.equal(h.session.saved(KEY, 2), false);
  assert.ok(h.session.state().record);
  h.current.review = review({ version: 4, note: h.editor.form.note }); h.current.dirty = false; h.current.busy = true;
  assert.equal(h.session.saved(KEY, 3), true); assert.equal(h.session.saved(KEY, 3), false);
  assert.equal(h.count("remove"), 1); assert.equal(h.session.state().record, null);
});

test("successful save never clears an unowned pending snapshot, even on the same key/version", () => {
  for (const pending of [draft(), draft({ baseline: review({ version: 1 }) }), draft({ key: OTHER_KEY })]) {
    const h = setup({ pending }); h.initialize(); h.current.review = review({ version: 4 });
    assert.equal(h.session.saved(KEY, 3), false); assert.ok(h.session.state().record);
    assert.equal(h.count("remove"), 0);
  }
});

test("failed or uncertain POST paths that do not call saved preserve the protected draft", () => {
  const h = setup(); h.initialize(); h.change(); const before = h.session.state().record;
  h.current.busy = true; h.session.refresh(); h.session.changed();
  h.current.busy = false; h.session.refresh();
  assert.deepEqual(h.session.state().record, before); assert.equal(h.session.state().protected, true);
  assert.equal(h.count("remove"), 0);
});

test("confirmed save clear failure keeps recovery visible and retryable", () => {
  const h = setup(); h.initialize(); h.change(); h.failRemove = true;
  h.current.review = review({ version: 4 });
  assert.equal(h.session.saved(KEY, 3), false); assert.equal(h.session.state().status, "unavailable");
  assert.ok(h.session.state().record); h.failRemove = false;
  assert.equal(h.session.saved(KEY, 3), true); assert.equal(h.session.state().record, null);
});

test("failed writes keep the previous snapshot, never claim protection and can retry the latest raw editor", () => {
  const h = setup(); h.initialize(); h.change("First draft"); const previous = h.session.state().record;
  h.failSet = true; h.change("Newest unsaved input");
  assert.equal(h.session.state().status, "unavailable"); assert.equal(h.session.state().protected, false);
  assert.deepEqual(h.session.state().record, previous); assert.equal(h.editor.form.note, "Newest unsaved input");
  h.failSet = false; h.session.changed();
  assert.equal(h.session.state().protected, true); assert.equal(h.session.state().record.form.note, "Newest unsaved input");
});

test("invalid captured data keeps the previous record and later valid edits recover protection", () => {
  const h = setup(); h.initialize(); h.change("First draft"); const previous = h.session.state().record;
  h.editor.form.score = 4; h.session.changed();
  assert.equal(h.session.state().status, "invalid"); assert.equal(h.session.state().protected, false);
  assert.deepEqual(h.session.state().record, previous);
  h.editor.form.score = "4"; h.session.changed(); assert.equal(h.session.state().protected, true);
});

test("initial read failures cannot overwrite a hidden pending snapshot when access returns", () => {
  const h = setup({ pending: draft(), readFails: true }); h.initialize(); h.change();
  assert.equal(h.session.state().status, "unavailable"); assert.equal(h.count("set"), 0);
  h.failGet = false; h.change();
  assert.equal(h.session.state().status, "available"); assert.equal(h.session.state().owned, false);
  assert.equal(h.session.state().record.form.note, draft().form.note); assert.equal(h.count("set"), 0);
});

test("initially inaccessible empty storage can recover on a later edit", () => {
  const h = setup({ readFails: true }); h.initialize(); h.change();
  assert.equal(h.session.state().protected, false); h.failGet = false; h.change();
  assert.equal(h.session.state().protected, true); assert.equal(h.count("set"), 1);
});

test("malformed stored data is not auto-deleted or overwritten; explicit forget can retry safely", () => {
  const h = setup(); h.data.set(`ard-reload-draft-v1:${WORKSPACE}`, "{broken-json"); h.initialize(); h.change();
  assert.equal(h.session.state().status, "invalid"); assert.equal(h.captures, 0);
  assert.equal(h.count("set"), 0); assert.equal(h.count("remove"), 0);
  h.failRemove = true; assert.equal(h.session.forget(), false); assert.equal(h.session.state().status, "unavailable");
  h.failRemove = false; assert.equal(h.session.forget(), true); assert.equal(h.session.state().status, "empty");
  assert.equal(h.editor.form.note, "New live draft"); assert.equal(h.current.dirty, true);
  h.session.changed(); assert.equal(h.session.state().protected, true);
});

test("explicit forget removes pending cache only, without discarding or auto-persisting live input", () => {
  const h = setup({ pending: draft() }); h.initialize(); h.change("Keep current input");
  assert.equal(h.session.forget(), true); assert.equal(h.session.forget(), true);
  assert.equal(h.count("remove"), 1); assert.equal(h.count("set"), 0);
  assert.equal(h.current.dirty, true); assert.equal(h.editor.form.note, "Keep current input");
  assert.equal(h.applications, 0); assert.equal(h.resets, 0);
});

test("switching workspaces reads separate slots and invalidates an outstanding restore guard", async () => {
  const h = setup({ pending: draft() }); h.initialize(); h.change(); const pending = h.session.restore();
  h.current.workspaceId = OTHER_WORKSPACE; h.initialize(); h.change("Other workspace");
  h.confirmations[0].answer(true); assert.equal(await pending, false); assert.equal(h.resets, 0);
  assert.equal(h.session.state().record.workspaceId, OTHER_WORKSPACE);
  assert.ok(h.data.has(`ard-reload-draft-v1:${WORKSPACE}`));
  assert.equal(h.session.saved(KEY, 2), false);
});

test("state and onChange snapshots cannot mutate the internally owned record", async () => {
  const h = setup({ pending: draft() }); h.initialize();
  h.session.state().record.form.note = "Mutated view";
  h.views.at(-1).record.baseline.version = 99;
  assert.equal(await h.session.restore(), true);
  assert.equal(h.editor.form.note, draft().form.note); assert.equal(h.current.review.version, 3);
});

test("failed apply and thrown capture remain usable and preserve recovery", async () => {
  for (const behavior of ["applyResult", "applyThrows"]) {
    const h = setup({ pending: draft() }); h.initialize(); h[behavior] = behavior === "applyThrows";
    assert.equal(await h.session.restore(), false); assert.equal(h.session.state().owned, false);
    assert.equal(h.session.state().restoring, false); assert.ok(h.session.state().record);
  }
  const h = setup(); h.initialize(); h.captureThrows = true; h.change();
  assert.equal(h.session.state().status, "unavailable"); assert.equal(h.count("set"), 0);
  h.captureThrows = false; h.session.changed(); assert.equal(h.session.state().protected, true);
});

test("restore succeeds locally despite write failure but never reports storage protection", async () => {
  const h = setup({ pending: draft() }); h.initialize();
  // A failed prior operation leaves a readable old snapshot with unavailable
  // storage. Re-applying it is useful even when it cannot be re-verified.
  h.failRemove = true; assert.equal(h.session.forget(), false); h.failSet = true;
  assert.equal(await h.session.restore(), true); assert.equal(h.current.dirty, true);
  assert.equal(h.session.state().protected, false); assert.equal(h.session.state().status, "unavailable");
  assert.equal(h.editor.form.note, draft().form.note); assert.ok(h.session.state().record);
});

test("busy state does not capture, discard or forget a draft", () => {
  const h = setup(); h.initialize(); h.change(); const count = h.captures;
  h.current.busy = true; h.session.changed();
  assert.equal(h.captures, count); assert.equal(h.session.discardCurrent(), false);
  assert.equal(h.session.forget(), false); assert.equal(h.session.state().canForget, false);
  assert.ok(h.session.state().record);
});

test("saved and discardCurrent cannot remove the snapshot after workspace or selection ownership changes", () => {
  for (const change of [staleChanges.selection, staleChanges.key, staleChanges.workspace]) {
    const h = setup(); h.initialize(); h.change(); change(h);
    assert.equal(h.session.saved(KEY, 3), false); assert.equal(h.session.discardCurrent(), false);
    assert.equal(h.count("remove"), 0); assert.ok(h.session.state().record);
  }
});

test("a copied tab's cache is independent and cannot restore against a newer backend baseline", async () => {
  const first = setup(); first.initialize(); first.change("First tab draft");
  const copied = setup();
  for (const [key, value] of first.data) copied.data.set(key, value);
  copied.current.review = review({ version: 4, note: "Saved elsewhere" }); copied.initialize();
  assert.equal(copied.session.state().canRestore, false); assert.equal(await copied.session.restore(), false);
  assert.equal(copied.session.forget(), true); assert.equal(copied.data.size, 0);
  assert.equal(first.session.state().protected, true); assert.equal(first.data.size, 1);
});

test("storage-factory and unexpected storage-method exceptions never escape into editor callbacks", () => {
  for (const createStore of [() => { throw Error("denied getter"); }, () => ({
    read() { throw Error("read failure"); }, write() { throw Error("write failure"); },
    clear() { throw Error("remove failure"); },
  })]) {
    const session = createDraftSession({ createStore,
      current: () => ({ workspaceId: WORKSPACE, key: KEY, review: review(), dirty: true }),
      capture: () => ({ form: draft().form, markers: draft().markers }),
      apply: () => true, confirmDiscard: async () => false,
    });
    assert.doesNotThrow(() => session.initialize(WORKSPACE));
    assert.doesNotThrow(() => session.changed());
    assert.equal(session.state().status, "unavailable"); assert.equal(session.state().protected, false);
    assert.equal(session.forget(), false);
  }
});


test("incompatible marker duration prevents confirmation and apply without discarding live or cached input", async () => {
  const h = setup({ pending: draft(), initial: { duration: 1 } }); h.initialize(); h.change("Keep live editor");
  assert.equal(h.session.state().canRestore, false); assert.equal(h.session.state().reason, "incompatible");
  assert.equal(await h.session.restore(), false); assert.equal(h.confirmations.length, 0);
  assert.equal(h.applications, 0); assert.equal(h.resets, 0);
  assert.equal(h.current.dirty, true); assert.equal(h.editor.form.note, "Keep live editor");
  assert.equal(h.session.state().record.form.note, draft().form.note);
  assert.equal(h.count("set"), 0); assert.equal(h.count("remove"), 0);
});

test("compatibility changes during confirmation revoke the guard before destructive reset", async () => {
  const h = setup({ pending: draft() }); h.initialize(); h.change("Keep live editor");
  const pending = h.session.restore(); assert.equal(h.confirmations.length, 1);
  h.current.duration = 1;
  assert.equal(h.confirmations[0].guard(), false); h.confirmations[0].answer(true);
  assert.equal(await pending, false); assert.equal(h.applications, 0); assert.equal(h.resets, 0);
  assert.equal(h.editor.form.note, "Keep live editor"); assert.equal(h.current.dirty, true);
  assert.equal(h.session.state().reason, "incompatible"); assert.ok(h.session.state().record);
});


test("non-destructive confirmation keeps live editor intact if atomic apply subsequently rejects", async () => {
  const h = setup({ pending: draft(), resetOnConfirm: false }); h.initialize(); h.change("Keep live editor");
  h.applyResult = false; const pending = h.session.restore(); h.confirmations[0].answer(true);
  assert.equal(await pending, false); assert.equal(h.resets, 0); assert.equal(h.applications, 1);
  assert.equal(h.current.dirty, true); assert.equal(h.editor.form.note, "Keep live editor");
  assert.equal(h.session.state().owned, false); assert.equal(h.session.state().record.form.note, draft().form.note);
});

test("compatibility preflight cannot corrupt the record and exceptions fail closed", async () => {
  const safe = setup({ pending: draft(), canApply(record) { record.form.note = "Mutated preflight"; return true; } });
  safe.initialize(); assert.equal(await safe.session.restore(), true);
  assert.equal(safe.editor.form.note, draft().form.note);
  const throws = setup({ pending: draft(), canApply() { throw Error("preflight failure"); } }); throws.initialize();
  assert.equal(throws.session.state().reason, "incompatible"); assert.equal(await throws.session.restore(), false);
  assert.equal(throws.confirmations.length, 0); assert.equal(throws.applications, 0); assert.ok(throws.session.state().record);
});


test("owned cached draft loses protection while incompatible without mutating the snapshot", () => {
  const h = setup(); h.initialize(); h.change("Protected live draft");
  const before = h.session.state().record, operations = h.operations.length, captures = h.captures;
  assert.equal(h.session.state().protected, true);
  h.current.duration = 1;
  const incompatible = h.session.refresh();
  assert.equal(incompatible.owned, true); assert.equal(incompatible.reason, "incompatible");
  assert.equal(incompatible.protected, false); assert.deepEqual(incompatible.record, before);
  assert.equal(h.current.dirty, true); assert.equal(h.editor.form.note, "Protected live draft");
  assert.equal(h.operations.length, operations); assert.equal(h.captures, captures);
  assert.equal(h.applications, 0); assert.equal(h.resets, 0);
  h.current.duration = 10;
  const compatible = h.session.refresh();
  assert.equal(compatible.protected, true); assert.equal(compatible.reason, "owned");
  assert.deepEqual(compatible.record, before); assert.equal(h.operations.length, operations);
  assert.equal(h.captures, captures); assert.equal(h.applications, 0); assert.equal(h.resets, 0);
});
