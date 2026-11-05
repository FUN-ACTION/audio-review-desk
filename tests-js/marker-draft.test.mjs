import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run the production marker module with deterministic DOM doubles. These are
// editor/state tests, not claims about native browser rendering or an OS IME.
const root = process.env.ARD_MARKER_DRAFT_SOURCE_ROOT;
const { mountMarkers, formatMarkerTime } = await import(root
  ? pathToFileURL(resolve(root, "src/audio_review_desk/static/markers.js"))
  : new URL("../src/audio_review_desk/static/markers.js", import.meta.url));

const codepointCases = [
  ["150 supplementary", "😀".repeat(150)],
  ["240 supplementary", "🎧".repeat(240)],
  ["240 mixed", "a声🎵".repeat(80)],
];

for (const [label, text] of codepointCases) {
  test(`valid ${label} imported note commits unchanged with its exact timestamp`, t => {
    const rows = [{ time: 1.123456789, text }], h = setup(t, { rows });
    h.edit(0);
    assert.equal(h.field("text").maxLength, 480);
    assert.equal(h.control.hasChanges(rows), false);
    assert.equal(h.control.flush(), true);
    assert.deepEqual(h.control.get(), rows);
    assert.deepEqual(h.errors, []);
  });
  test(`restored ${label} pending input flushes exactly once without truncation`, t => {
    const h = setup(t, { rows: [] });
    assert.equal(h.control.restore({ rows: [], input: text, editing: null }, false), true);
    assert.equal(h.control.flush(), true);
    assert.equal(h.control.flush(), true);
    assert.deepEqual(h.control.get(), [{ time: 2.5, text }]);
    assert.equal(h.input.value, "");
    assert.deepEqual(h.errors, []);
  });
}

for (const [label, text] of [["BMP", "声".repeat(241)], ["supplementary", "😀".repeat(241)],
                            ["mixed", "a声🎵".repeat(80) + "z"]]) {
  for (const route of ["add", "inline"]) {
    test(`241 ${label} codepoints are rejected through ${route} without losing raw text or rows`, t => {
      const rows = [{ time: 1.123456789, text: "Keep this saved note" }], h = setup(t, { rows });
      if (route === "inline") h.edit(0);
      const field = route === "inline" ? h.field("text") : h.input;
      h.type(field, text);
      assert.equal(h.control.flush(), false);
      assert.deepEqual(h.control.get(), rows);
      assert.equal(field.value, text);
      assert.equal(h.doc.activeElement, field);
      assert.equal(h.errors.at(-1), "markerRequired");
    });
  }
}

test("restored 240-codepoint inline text commits without changing its precise time", t => {
  const h = setup(t), text = "🎵".repeat(240), time = 1.123456789;
  const saved = { rows: [{ time, text: "Original" }], input: "",
    editing: { index: 0, time: "0:01.123", text, originalTime: time, timeDirty: false } };
  assert.equal(h.control.restore(saved, false), true);
  assert.equal(h.control.flush(), true);
  assert.deepEqual(h.control.get(), [{ time, text }]);
  assert.deepEqual(h.errors, []);
});

test("native marker input ceiling accommodates every valid 240-codepoint note", () => {
  const html = readFileSync(root ? resolve(root, "src/audio_review_desk/static/workbench.html")
    : new URL("../src/audio_review_desk/static/workbench.html", import.meta.url), "utf8");
  assert.match(html, /id="markerText"\s+maxlength="480"/);
});

function setup(t, { rows = [{ time: 1, text: "First" }, { time: 5, text: "Second" }], duration = 10, locked = false, onChange = () => {} } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { activeElement: null, focuses: 0 };
  class Element {
    constructor() {
      this.children = []; this.className = ""; this.listeners = new Map();
      this.attributes = {}; this.style = {}; this.value = ""; this.disabled = false;
    }
    get classList() { return { contains: key => this.className.split(" ").includes(key), add: key => { this.className += ` ${key}`; } }; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) {
      if (this.children.some(node => node.contains(doc.activeElement))) doc.activeElement = doc.body;
      for (const node of this.children) node.parent = null;
      this.children = []; this.append(...nodes);
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.startsWith(".") && this.classList.contains(selector.slice(1)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    emit(type, values = {}) { for (const listener of this.listeners.get(type) || []) listener({ target: this, ...values }); }
    click() { if (!this.disabled) this.emit("click"); }
    focus() { doc.activeElement = this; doc.focuses++; }
  }
  doc.body = new Element(); doc.activeElement = doc.body; doc.createElement = () => new Element();
  globalThis.document = doc;
  t.after(() => previous ? Object.defineProperty(globalThis, "document", previous) : delete globalThis.document);
  const input = new Element(), add = new Element(), list = new Element(), ticks = new Element(), other = new Element();
  doc.body.append(input, add, list, ticks, other);
  const errors = [], player = { currentTime: 2.5 };
  let changes = 0, limit = duration;
  const control = mountMarkers({ input, add, list, ticks, player, duration: () => limit,
    t: key => key, onChange: () => { changes++; onChange(); }, onError: error => errors.push(error) });
  control.set(rows, locked); control.view(0, duration || 10);
  function type(field, value, flags = {}) { field.value = value; field.emit("input", flags); }
  function key(field, key, flags = {}) {
    const effects = { prevented: 0, stopped: 0 };
    field.emit("keydown", { key, isComposing: false, keyCode: 0,
      preventDefault: () => effects.prevented++, stopPropagation: () => effects.stopped++, ...flags });
    return effects;
  }
  const edit = index => list.children[index].querySelector(".marker-note").click();
  const field = name => list.querySelector(`.marker-edit-${name}`);
  const action = name => list.querySelector(".marker-edit-actions").children.find(node => node.textContent === name);
  return { control, input, add, list, ticks, other, errors, player, doc, type, key, edit, field, action,
    changes: () => changes, duration: value => { limit = value; } };
}

const snapshot = (patch = {}) => ({ rows: [{ time: 1, text: "First" }, { time: 5, text: "Second" }], input: "  pending 候选  ",
  editing: { index: 0, time: "1:", text: "  unfinished text  ", originalTime: 1, timeDirty: true }, ...patch });

test("snapshot copies exact row order, precision and uncommitted input without side effects", t => {
  const rows = [{ time: 5.123456789, text: "  Second  " }, { time: 1 / 44100, text: "First 🎧" }];
  const h = setup(t, { rows }); h.type(h.input, "   待输入 🎧   "); h.other.focus();
  const changes = h.changes(), focuses = h.doc.focuses, children = [...h.list.children];
  const saved = h.control.snapshot();
  assert.deepEqual(saved, { rows, input: "   待输入 🎧   ", editing: null });
  assert.deepEqual(h.control.get(), rows); assert.equal(h.changes(), changes);
  assert.deepEqual(h.errors, []); assert.equal(h.doc.focuses, focuses);
  assert.equal(h.doc.activeElement, h.other); assert.deepEqual(h.list.children, children);
  saved.rows[0].time = 0; saved.rows[0].text = "Mutated"; saved.rows.push({ time: 7, text: "New" }); saved.input = "Changed";
  rows[0].text = "Changed source";
  assert.equal(h.control.snapshot().rows[0].time, 5.123456789);
  assert.equal(h.control.snapshot().rows[0].text, "  Second  ");
  assert.equal(h.control.snapshot().rows.length, 2); assert.equal(h.input.value, "   待输入 🎧   ");
});

test("snapshot includes the complete raw inline editor without applying or rounding it", t => {
  const exact = 1.0006, h = setup(t, { rows: [{ time: exact, text: "Original" }], duration: exact });
  h.edit(0); h.type(h.field("text"), "   Editing 候选   "); h.type(h.input, "  New note  ");
  const before = h.changes(), timeField = h.field("time"), focuses = h.doc.focuses;
  assert.deepEqual(h.control.snapshot(), { rows: [{ time: exact, text: "Original" }], input: "  New note  ",
    editing: { index: 0, time: "0:01.001", text: "   Editing 候选   ", originalTime: exact, timeDirty: false } });
  assert.equal(h.changes(), before); assert.equal(h.field("time"), timeField);
  assert.equal(h.doc.focuses, focuses); assert.deepEqual(h.errors, []);
  const exported = h.control.snapshot(); exported.editing.text = "Changed"; exported.editing.timeDirty = true;
  assert.equal(h.control.snapshot().editing.text, "   Editing 候选   ");
  assert.equal(h.control.snapshot().editing.timeDirty, false);
});

for (const raw of ["", "1:", ".", "not a time", "-1", "0:61", "11", "0.1234", "  0:03.125  "]) {
  test(`restoring raw inline time ${JSON.stringify(raw)} does not validate, flush or normalize it`, t => {
    const h = setup(t), saved = snapshot(); saved.editing.time = raw; saved.editing.text = "   ";
    h.other.focus(); const changes = h.changes(), focuses = h.doc.focuses;
    assert.equal(h.control.restore(saved, false), true);
    assert.deepEqual(h.control.snapshot(), saved); assert.deepEqual(h.control.get(), saved.rows);
    assert.equal(h.field("time").value, raw); assert.equal(h.field("text").value, "   ");
    assert.equal(h.input.value, saved.input); assert.equal(h.changes(), changes);
    assert.deepEqual(h.errors, []); assert.equal(h.doc.focuses, focuses); assert.equal(h.doc.activeElement, h.other);
  });
}

test("restored draft and every exported snapshot have independent rows and editor objects", t => {
  const h = setup(t), saved = snapshot(), expected = structuredClone(saved);
  assert.equal(h.control.restore(saved, false), true);
  saved.rows[0].time = 9; saved.rows[0].text = "Changed"; saved.rows.length = 1;
  saved.editing.index = 1; saved.editing.text = "Changed editor"; saved.input = "Changed input";
  assert.deepEqual(h.control.snapshot(), expected);
  const exported = h.control.snapshot(); exported.rows.reverse(); exported.editing.time = "9";
  assert.deepEqual(h.control.snapshot(), expected);
  h.type(h.field("text"), "New local edit");
  assert.equal(exported.editing.text, expected.editing.text); assert.equal(expected.rows[0].text, "First");
});

test("restore preserves unsorted rows and untrimmed text until an explicit Apply", t => {
  const h = setup(t), saved = snapshot({ rows: [{ time: 8, text: "  Later  " }, { time: 1, text: "Earlier" }],
    editing: { index: 0, time: " 0:00.250 ", text: "  Updated 🎧  ", originalTime: 8, timeDirty: true } });
  assert.equal(h.control.restore(saved, false), true);
  assert.deepEqual(h.control.snapshot(), saved);
  assert.equal(h.list.children[1].querySelector(".marker-note").textContent, "Earlier");
  assert.equal(h.changes(), 0); h.action("apply").click();
  assert.deepEqual(h.control.get(), [{ time: 0.25, text: "Updated 🎧" }, { time: 1, text: "Earlier" }]);
  assert.equal(h.control.snapshot().editing, null); assert.equal(h.input.value, saved.input);
  assert.equal(h.changes(), 1); assert.deepEqual(h.errors, []);
});

for (const exact of [1.0006, 1 / 44100, 0.123456789]) {
  test(`unedited timestamp ${exact} remains exact after a stored round trip and explicit Apply`, t => {
    const h = setup(t, { rows: [{ time: exact, text: "Original" }], duration: exact });
    h.edit(0); h.type(h.field("text"), "  Updated  ");
    const saved = JSON.parse(JSON.stringify(h.control.snapshot())); h.control.set([], false);
    const changes = h.changes();
    assert.equal(h.control.restore(saved, false), true);
    assert.equal(h.field("time").value, formatMarkerTime(exact));
    assert.equal(h.control.snapshot().editing.originalTime, exact);
    assert.equal(h.control.snapshot().editing.timeDirty, false); assert.equal(h.changes(), changes);
    h.action("apply").click();
    assert.deepEqual(h.control.get(), [{ time: exact, text: "Updated" }]);
    assert.equal(h.changes(), changes + 1); assert.deepEqual(h.errors, []);
  });
}

for (const route of ["button", "Escape"]) {
  test(`Cancel by ${route} after restore discards only inline edits`, t => {
    const h = setup(t), saved = snapshot(); assert.equal(h.control.restore(saved, false), true);
    if (route === "button") h.action("cancel").click();
    else assert.deepEqual(h.key(h.field("text"), "Escape"), { prevented: 1, stopped: 1 });
    assert.deepEqual(h.control.get(), saved.rows); assert.equal(h.control.snapshot().editing, null);
    assert.equal(h.input.value, saved.input); assert.equal(h.changes(), 1); assert.deepEqual(h.errors, []);
    assert.equal(h.doc.activeElement, h.list.children[0].querySelector(".marker-note"));
  });
}

for (const invalid of [{ time: "1:", text: "Valid", error: "markerTimeInvalid", focus: "time" },
  { time: "2.5", text: "   ", error: "markerBlankEdit", focus: "text" }]) {
  test(`explicit Apply still rejects a restored invalid ${invalid.focus} and preserves the draft`, t => {
    const h = setup(t), saved = snapshot(); Object.assign(saved.editing, { time: invalid.time, text: invalid.text });
    assert.equal(h.control.restore(saved, false), true); h.action("apply").click();
    assert.deepEqual(h.control.snapshot(), saved); assert.deepEqual(h.errors, [invalid.error]);
    assert.equal(h.changes(), 0); assert.equal(h.doc.activeElement, h.field(invalid.focus));
    h.type(h.field(invalid.focus), invalid.focus === "time" ? "2.5" : "Corrected"); h.action("apply").click();
    assert.equal(h.control.snapshot().editing, null); assert.equal(h.control.get()[0].time, 2.5);
    assert.equal(h.changes(), 2);
  });
}

test("locked restore renders disabled editor, add and remove controls without losing raw input", t => {
  const h = setup(t), saved = snapshot(); assert.equal(h.control.restore(saved, true), true);
  for (const node of [h.input, h.add, h.field("time"), h.field("text"), h.action("apply"), h.action("cancel"),
    h.list.children[1].querySelector(".marker-note"), h.list.children[1].querySelector(".marker-remove")]) assert.equal(node.disabled, true);
  h.action("apply").click(); h.action("cancel").click(); h.add.click();
  h.list.children[1].querySelector(".marker-remove").click();
  assert.deepEqual(h.control.snapshot(), saved); assert.equal(h.changes(), 0); assert.deepEqual(h.errors, []);
  const focuses = h.doc.focuses; h.control.focus(); assert.equal(h.doc.focuses, focuses);
  h.control.refresh(false); assert.deepEqual(h.control.snapshot(), saved);
  assert.equal(h.field("time").disabled, false); assert.equal(h.action("cancel").disabled, false);
  h.action("cancel").click(); assert.equal(h.control.snapshot().editing, null);
});

test("new uncommitted marker text is appended only by an explicit later Add", t => {
  const h = setup(t), saved = snapshot({ editing: null, input: "  A new 🎧 note  " });
  assert.equal(h.control.restore(saved, false), true); assert.equal(h.changes(), 0);
  assert.deepEqual(h.control.get(), saved.rows); h.add.click();
  assert.deepEqual(h.control.get(), [{ time: 1, text: "First" }, { time: 2.5, text: "A new 🎧 note" }, { time: 5, text: "Second" }]);
  assert.equal(h.input.value, ""); assert.equal(h.changes(), 1); assert.deepEqual(h.errors, []);
});

for (const flags of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
  test(`restored editor retains IME key guards (${JSON.stringify(flags)})`, t => {
    const h = setup(t), saved = snapshot(); saved.editing.time = "2.5";
    assert.equal(h.control.restore(saved, false), true);
    h.type(h.field("text"), "  候选文字  ", flags); h.type(h.input, "  新候选  ", flags);
    const before = h.control.snapshot(), changes = h.changes();
    for (const field of [h.field("text"), h.field("time")]) {
      for (const key of ["Enter", "Escape"]) assert.deepEqual(h.key(field, key, flags), { prevented: 0, stopped: 0 });
    }
    assert.deepEqual(h.key(h.input, "Enter", flags), { prevented: 0, stopped: 0 });
    assert.deepEqual(h.control.snapshot(), before); assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
    assert.deepEqual(h.key(h.field("text"), "Enter"), { prevented: 1, stopped: 0 });
    assert.deepEqual(h.control.get()[0], { time: 2.5, text: "候选文字" });
    assert.equal(h.input.value, "  新候选  "); assert.equal(h.changes(), changes + 1);
  });
}

test("malformed snapshots fail atomically without replacing rows, editor, input, locks or focus", t => {
  const h = setup(t); h.edit(1); h.type(h.field("time"), "5:"); h.type(h.input, "Keep pending input");
  const invalid = [null, undefined, [], {}, snapshot({ rows: null }), snapshot({ rows: {} }), snapshot({ input: null }),
    snapshot({ input: 3 }), snapshot({ input: "😀".repeat(241) }),
    snapshot({ editing: undefined }), snapshot({ editing: {} }), snapshot({ editing: [] }),
    ...[null, "1", NaN, Infinity, -0.1].map(time => snapshot({ rows: [{ time, text: "First" }] })),
    ...[null, 3, "", "  ", "🎧".repeat(241)].map(text => snapshot({ rows: [{ time: 1, text }] })),
    snapshot({ rows: Array(2) }), snapshot({ rows: Array.from({ length: 101 }, () => ({ time: 1, text: "First" })) }),
    ...[-1, 2, 0.5, "0", null].map(index => ({ ...snapshot(), editing: { ...snapshot().editing, index } })),
    ...[2, null, "1", NaN, Infinity].map(originalTime => ({ ...snapshot(), editing: { ...snapshot().editing, originalTime } })),
    ...[null, 3].flatMap(value => ["time", "text"].map(key => ({ ...snapshot(), editing: { ...snapshot().editing, [key]: value } }))),
    ...[null, 0, "false"].map(timeDirty => ({ ...snapshot(), editing: { ...snapshot().editing, timeDirty } })),
    { ...snapshot(), editing: { ...snapshot().editing, time: "1".repeat(129) } },
    { ...snapshot(), editing: { ...snapshot().editing, text: "🎧".repeat(241) } }];
  for (const candidate of invalid) {
    const before = h.control.snapshot(), children = [...h.list.children], focuses = h.doc.focuses, active = h.doc.activeElement, changes = h.changes();
    assert.equal(h.control.restore(candidate, true), false);
    assert.deepEqual(h.control.snapshot(), before); assert.deepEqual(h.list.children, children);
    assert.equal(h.input.disabled, false); assert.equal(h.field("time").disabled, false);
    assert.equal(h.doc.activeElement, active); assert.equal(h.doc.focuses, focuses);
    assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
  }
});

for (const duration of [4.999999, -1, NaN, Infinity, undefined, null]) {
  test(`rows incompatible with current duration ${String(duration)} reject the complete snapshot`, t => {
    const h = setup(t); h.type(h.input, "Keep me"); const before = h.control.snapshot(); h.duration(duration);
    const children = [...h.list.children], changes = h.changes();
    assert.equal(h.control.restore(snapshot(), true), false);
    assert.deepEqual(h.control.snapshot(), before); assert.deepEqual(h.list.children, children);
    assert.equal(h.input.disabled, false); assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
  });
}

test("empty marker drafts restore for locked clips without a playable duration", t => {
  const h = setup(t); h.duration(null);
  const saved = { rows: [], input: "  unfinished text  ", editing: null };
  assert.equal(h.control.restore(saved, true), true);
  assert.deepEqual(h.control.snapshot(), saved); assert.equal(h.list.children.length, 0);
  assert.equal(h.input.disabled, true); assert.equal(h.changes(), 0); assert.deepEqual(h.errors, []);
});

test("valid Unicode markers and raw editor limits count codepoints without truncation", t => {
  const h = setup(t), saved = { rows: [{ time: 0, text: "🎧".repeat(240) }], input: "  " + "😀".repeat(236) + "  ",
    editing: { index: 0, time: "1:".repeat(64), text: "  " + "🎵".repeat(236) + "  ", originalTime: 0, timeDirty: true } };
  assert.equal(h.control.restore(saved, false), true);
  assert.deepEqual(h.control.snapshot(), saved);
  assert.equal(h.field("text").value, saved.editing.text); assert.equal(h.field("time").value, saved.editing.time);
  assert.equal(h.input.value, saved.input); assert.equal(h.changes(), 0); assert.deepEqual(h.errors, []);
});

test("snapshot itself never truncates or rejects raw values exceeding recovery storage limits", t => {
  const h = setup(t); h.edit(0);
  h.type(h.input, "x".repeat(1000)); h.type(h.field("time"), "1:".repeat(1000));
  h.type(h.field("text"), "  " + "候选".repeat(1000));
  const saved = h.control.snapshot(), changes = h.changes();
  assert.equal(saved.input, h.input.value); assert.equal(saved.editing.time, h.field("time").value);
  assert.equal(saved.editing.text, h.field("text").value);
  assert.equal(h.control.restore(saved, true), false, "storage overflow is rejected, never silently shortened");
  assert.deepEqual(h.control.snapshot(), saved); assert.equal(h.input.disabled, false);
  assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
});

test("restore accepts inclusive duration boundaries and the full 100-row limit", t => {
  const h = setup(t, { locked: true });
  const rows = Array.from({ length: 100 }, (_, index) => ({ time: index / 10, text: `Marker ${index}` }));
  const saved = { rows, input: "", editing: null };
  assert.equal(h.control.restore(saved, false), true);
  assert.deepEqual(h.control.snapshot(), saved); assert.equal(h.list.children.length, 100);
  assert.equal(h.input.disabled, false); assert.equal(h.add.disabled, false);
  h.duration(0);
  assert.equal(h.control.restore({ rows: [{ time: 0, text: "Start" }], input: "", editing: null }, false), true);
  assert.deepEqual(h.control.get(), [{ time: 0, text: "Start" }]);
  assert.equal(h.changes(), 0); assert.deepEqual(h.errors, []);
});

test("accessor, exotic and extra-field snapshots are rejected without executing their getters", t => {
  const h = setup(t), before = h.control.snapshot(); let reads = 0;
  const accessor = snapshot(); Object.defineProperty(accessor, "input", { get() { reads++; throw new Error("getter"); } });
  const hostile = new Proxy(snapshot(), { getPrototypeOf() { throw new Error("proxy"); } });
  const inherited = Object.create(snapshot());
  for (const candidate of [accessor, hostile, inherited, { ...snapshot(), unknown: true },
    snapshot({ rows: [{ time: 1, text: "First", unknown: true }] }),
    { ...snapshot(), editing: { ...snapshot().editing, unknown: true } }]) {
    assert.equal(h.control.restore(candidate, true), false);
    assert.deepEqual(h.control.snapshot(), before); assert.equal(h.input.disabled, false);
  }
  assert.equal(reads, 0); assert.equal(h.changes(), 0); assert.deepEqual(h.errors, []);
});

for (const locked of [false, true]) {
  test(`canRestore preflights shape and clip duration without touching a dirty ${locked ? "locked" : "unlocked"} editor`, t => {
    const h = setup(t); h.edit(1); h.type(h.field("time"), "5:");
    h.type(h.field("text"), "  Keep live candidate  "); h.type(h.input, "  Keep new text  ");
    h.control.refresh(locked); h.field("text").focus();
    const before = h.control.snapshot(), children = [...h.list.children], tickChildren = [...h.ticks.children];
    const changes = h.changes(), focuses = h.doc.focuses, active = h.doc.activeElement;
    const candidates = [
      [snapshot(), true],
      [snapshot({ editing: null }), true],
      [snapshot({ rows: [{ time: 999, text: "Out of clip" }], editing: null }), false],
      [snapshot({ rows: [{ time: 10, text: "Exact end" }], editing: null }), true],
      [snapshot({ rows: [{ time: 10.000001, text: "Past end" }], editing: null }), false],
      [snapshot({ rows: null }), false],
      [{ ...snapshot(), editing: { ...snapshot().editing, originalTime: 2 } }, false],
      [snapshot({ input: "x".repeat(241) }), false],
      [null, false],
    ];
    for (const [candidate, expected] of candidates) {
      const copy = structuredClone(candidate);
      assert.equal(h.control.canRestore(candidate), expected);
      assert.equal(h.control.canRestore(candidate), expected, "repeat preflight is read-only");
      assert.deepEqual(candidate, copy, "preflight does not normalize the cached snapshot");
      assert.deepEqual(h.control.snapshot(), before); assert.deepEqual(h.list.children, children);
      assert.deepEqual(h.ticks.children, tickChildren); assert.equal(h.doc.activeElement, active);
      assert.equal(h.doc.focuses, focuses); assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
      for (const node of [h.input, h.add, h.field("time"), h.field("text"), h.action("apply"), h.action("cancel")]) {
        assert.equal(node.disabled, locked);
      }
    }
  });
}

test("canRestore accepts raw empty-marker input with unknown duration and checks exact known boundaries", t => {
  const h = setup(t, { locked: true }), before = h.control.snapshot();
  const empty = { rows: [], input: "  pending 候选  ", editing: null };
  for (const duration of [undefined, null, NaN, Infinity, -1]) {
    h.duration(duration);
    assert.equal(h.control.canRestore(empty), true);
    assert.equal(h.control.canRestore(snapshot()), false);
  }
  for (const duration of [0, 1 / 44100, 1.0006]) {
    h.duration(duration);
    const exact = { rows: [{ time: duration, text: "Exact end" }], input: "", editing: null };
    assert.equal(h.control.canRestore(exact), true);
    exact.rows[0].time += 0.000001;
    assert.equal(h.control.canRestore(exact), false);
  }
  assert.deepEqual(h.control.snapshot(), before); assert.equal(h.changes(), 0);
  assert.equal(h.input.disabled, true); assert.deepEqual(h.errors, []);
});

test("restore revalidates duration and snapshot mutations after a successful canRestore", t => {
  const h = setup(t); h.type(h.input, "Preserve live edits");
  const before = h.control.snapshot(), saved = snapshot(), changes = h.changes();
  assert.equal(h.control.canRestore(saved), true);
  h.duration(4);
  assert.equal(h.control.restore(saved, true), false);
  assert.deepEqual(h.control.snapshot(), before); assert.equal(h.input.disabled, false);
  h.duration(10);
  assert.equal(h.control.canRestore(saved), true);
  saved.rows[1].time = 999;
  assert.equal(h.control.restore(saved, true), false);
  assert.deepEqual(h.control.snapshot(), before); assert.equal(h.input.disabled, false);
  assert.equal(h.changes(), changes); assert.deepEqual(h.errors, []);
});

for (const text of ["\u0085", "\u001c", "\u001d\u001e\u001f", " ", "\t\r\n", " \u0085\u001c "]) test(`raw blank input remains a protected draft: ${JSON.stringify(text)}`, t => {
 const rows=[{time:1,text:"Saved"}],h=setup(t,{rows});h.type(h.input,text);
 assert.equal(h.control.hasChanges(rows),true);const before=h.control.snapshot();
 assert.equal(h.control.flush(),false);assert.equal(h.errors.at(-1),"markerBlankPending");
 assert.deepEqual(h.control.snapshot(),before);assert.equal(h.input.value,text);
 h.type(h.input,"");assert.equal(h.control.hasChanges(rows),false);assert.equal(h.control.flush(),true);
});
for(const kind of ["blank","long","full"])test(`pending ${kind} failure leaves both inline edit and pending text untouched`,t=>{
 const rows=kind==='full'?Array.from({length:100},(_,i)=>({time:i/10,text:'Row '+i})):[{time:1,text:'Saved'}];
 const h=setup(t,{rows});h.edit(0);h.type(h.field('time'),'2');h.type(h.field('text'),'Unapplied edit');
 h.type(h.input,kind==='blank'?'\u0085':kind==='long'?'🎧'.repeat(241):'Pending valid note');
 const before=h.control.snapshot(),changes=h.changes();
 assert.equal(h.control.flush(),false);assert.deepEqual(h.control.snapshot(),before);assert.equal(h.changes(),changes);
 assert.equal(h.errors.at(-1),kind==='blank'?'markerBlankPending':kind==='long'?'markerRequired':'markerLimit');
});
test('FEFF saved row remains unchanged through edit, flush and raw draft restoration',t=>{
 const rows=[{time:1.123456789,text:'\ufeff'}],h=setup(t,{rows});h.edit(0);
 assert.equal(h.control.hasChanges(rows),false);assert.equal(h.control.flush(),true);assert.deepEqual(h.control.get(),rows);
 h.type(h.input,'\ufeff');const raw=h.control.snapshot();assert.equal(h.control.restore(raw,false),true);
 assert.deepEqual(h.control.snapshot(),raw);assert.equal(h.control.hasChanges(rows),true);assert.equal(h.control.flush(),true);
 assert.equal(h.control.get().length,2);assert.equal(h.control.get()[1].text,'\ufeff');
});
for(const action of ['delete','edit'])test(`invalid whitespace inline edit blocks ${action} of another row without losing text`,t=>{
 const h=setup(t);h.edit(0);h.type(h.field('text'),'\u0085');const before=h.control.snapshot();
 h.list.children[1].querySelector(action==='delete'?'.marker-remove':'.marker-note').click();
 assert.deepEqual(h.control.snapshot(),before);assert.equal(h.errors.at(-1),'markerBlankEdit');
});
test('IME marker input is raw and does not normalize or submit composition events',t=>{
 const h=setup(t),raw=' \u0085\ufeff ';h.type(h.input,raw,{isComposing:true});
 h.key(h.input,'Enter',{isComposing:true});h.key(h.input,'Enter',{keyCode:229});
 assert.equal(h.input.value,raw);assert.equal(h.control.hasChanges(h.control.get()),true);assert.equal(h.control.get().length,2);
 assert.equal(h.control.snapshot().input,raw);assert.deepEqual(h.errors,[]);
});

// Execute the real preset, dirty-state and discard handlers with mountMarkers.
// Other review fields are deliberately unchanged; DOM/layout and the recovery
// storage adapter are not browser acceptance tests.
function presetHarness(t, { count = 100, busy = false, decoded = true } = {}) {
  let mark = () => {};
  const rows = Array.from({ length: count }, (_, i) => ({ time: i / 10, text: `Saved ${i}` }));
  const h = setup(t, { rows, onChange: () => mark() });
  const source = readFileSync(root ? resolve(root, "src/audio_review_desk/static/workbench.js")
    : new URL("../src/audio_review_desk/static/workbench.js", import.meta.url), "utf8");
  const between = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return source.slice(a, b);
  };
  let click, captured = null, opens = 0, exports = 0;
  const preset = { dataset: { markerPreset: "noise" }, addEventListener: (_, fn) => click = fn };
  const elements = new Map([["markerText", h.input], ["addMarker", h.add]]);
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { textContent: "", querySelector: () => null,
      focus() { h.doc.activeElement = this; } });
    return elements.get(id);
  };
  const document = { get activeElement() { return h.doc.activeElement; }, querySelectorAll: () => [preset] };
  const env = {
    document, $, busy, selected: { quality: { decoded }, review: { markers: rows, version: 1 } },
    markersView: h.control, t: key => key,
    validateNote() {}, updateIssueCount() {}, renderSelectedDuration() {}, invalidateRefresh() {},
    sameReview: () => true, reviewPayload: () => ({}), draftValues: () => ({}), drawWave() {},
    renderExportScope: () => exports++,
    draftSession: { changed() { captured = h.control.snapshot(); }, discardCurrent() {} },
    openDialog() { opens++; }, renderDetails() {},
  };
  const factory = new Function(...Object.keys(env), `
    let dirty = false, discardResolver = null;
    ${between("function markDirty() {", "function validateNote() {")}
    ${between("async function discardAllowed(", "const importing =")}
    ${between('for (const button of document.querySelectorAll("[data-marker-preset]"))\n  button.addEventListener("click"', '$("nextPending").addEventListener')}
    return { markDirty, discardAllowed, dirty: () => dirty,
      resolve: value => { const fn = discardResolver; discardResolver = null; fn(value); } };
  `);
  const state = factory(...Object.values(env)); mark = state.markDirty;
  return { ...h, ...state, preset: () => click(), captured: () => captured,
    opens: () => opens, exports: () => exports, saveState: () => $("saveState").textContent };
}

test("quick preset at capacity preserves a tracked recoverable draft and requires discard confirmation", async t => {
  const h = presetHarness(t);
  h.preset();
  assert.equal(h.errors.at(-1), "markerLimit");
  assert.equal(h.input.value, "noise");
  assert.equal(h.control.get().length, 100);
  assert.equal(h.dirty(), true);
  assert.equal(h.saveState(), "unsaved");
  assert.ok(h.exports() > 0);
  assert.equal(h.doc.activeElement, h.input);
  assert.equal(h.captured().input, "noise");
  const restored = setup(t, { rows: [] });
  assert.equal(restored.control.restore(h.captured(), false), true);
  assert.equal(restored.input.value, "noise");
  assert.equal(restored.control.hasChanges(restored.control.get()), true);
  const navigation = h.discardAllowed();
  assert.equal(h.opens(), 1);
  h.resolve(false);
  assert.equal(await navigation, false);
  assert.equal(h.input.value, "noise");
  assert.equal(h.dirty(), true);
});

test("quick preset below capacity succeeds and captures only the added row, without a pending duplicate", t => {
  const h = presetHarness(t, { count: 99 });
  h.preset();
  assert.equal(h.control.get().length, 100);
  assert.ok(h.control.get().some(row => row.text === "noise" && row.time === 2.5));
  assert.equal(h.input.value, "");
  assert.equal(h.captured().input, "");
  assert.equal(h.captured().rows.length, 100);
  assert.deepEqual(h.errors, []);
  assert.equal(h.dirty(), true);
  assert.equal(h.doc.activeElement, h.input);
});

test("99 rows plus pending input preserves that note and the rejected preset separately", t => {
  const h = presetHarness(t, { count: 99 });
  h.type(h.input, "Existing pending note");
  h.preset();
  assert.equal(h.control.get().length, 100);
  assert.ok(h.control.get().some(row => row.text === "Existing pending note"));
  assert.equal(h.input.value, "noise");
  assert.equal(h.captured().input, "noise");
  assert.equal(h.errors.at(-1), "markerLimit");
  assert.equal(h.dirty(), true);
});

for (const kind of ["blank", "long", "inline"]) {
  test(`quick preset does not overwrite or commit an invalid ${kind} draft`, t => {
    const h = presetHarness(t, { count: 2 });
    if (kind === "inline") { h.edit(0); h.type(h.field("time"), "1:"); }
    else h.type(h.input, kind === "blank" ? "\u0085" : "x".repeat(241));
    const before = h.control.snapshot();
    h.preset();
    assert.deepEqual(h.control.snapshot(), before);
    assert.equal(h.dirty(), true);
    assert.ok(h.errors.length);
  });
}
for (const options of [{ busy: true }, { decoded: false }]) {
  test(`quick preset rejects ${JSON.stringify(options)} without changing draft or focus`, t => {
    const h = presetHarness(t, options);
    h.input.value = "Keep raw draft";
    h.other.focus();
    const before = h.control.snapshot();
    h.preset();
    assert.deepEqual(h.control.snapshot(), before);
    assert.equal(h.doc.activeElement, h.other);
    assert.equal(h.captured(), null);
    assert.deepEqual(h.errors, []);
  });
}

// Logical row identity must survive equal values, cloning and stable sorting.
const duplicateRows = () => [
  { time: 2.5, text: "Noise" },
  { time: 2.5, text: "Reverb" },
  { time: 2.5, text: "Noise" },
];
const noteAt = (h, index) => h.list.children[index]?.querySelector(".marker-note");
const removeAt = (h, index) => h.list.children[index]?.querySelector(".marker-remove");

for (const index of [0, 2]) {
  test(`editing duplicate row ${index} changes only the clicked occurrence`, t => {
    const rows = duplicateRows(), h = setup(t, { rows });
    h.edit(index);
    assert.equal(h.control.snapshot().editing.index, index);
    h.type(h.field("text"), "Edited occurrence"); h.action("apply").click();
    const expected = duplicateRows(); expected[index].text = "Edited occurrence";
    assert.deepEqual(h.control.get(), expected);
    assert.equal(h.doc.activeElement, noteAt(h, index));
    assert.deepEqual(rows, duplicateRows(), "input rows remain independent");
  });
}

for (const index of [0, 1, 2]) {
  test(`deleting duplicate-list row ${index} retains exact order and adjacent focus`, t => {
    const h = setup(t, { rows: duplicateRows() }), expected = duplicateRows();
    expected.splice(index, 1);
    removeAt(h, index).focus(); removeAt(h, index).click();
    assert.deepEqual(h.control.get(), expected);
    assert.equal(h.doc.activeElement, removeAt(h, Math.min(index, expected.length - 1)));
  });
}

test("normal Add assigns separate identity to repeated same-position notes", t => {
  const h = setup(t, { rows: [] });
  for (const text of ["Noise", "Reverb", "Noise"]) { h.type(h.input, text); h.add.click(); }
  assert.deepEqual(h.control.get(), duplicateRows());
  h.edit(2); assert.equal(h.control.snapshot().editing.index, 2);
  h.type(h.field("text"), "Last only"); h.control.flush();
  assert.deepEqual(h.control.get().map(row => row.text), ["Noise", "Reverb", "Last only"]);
  assert.deepEqual(h.errors, []);
});

test("repeated references in set input become separate private rows", t => {
  const repeated = { time: 2.5, text: "Noise" }, h = setup(t, { rows: [repeated, repeated] });
  h.edit(1); h.type(h.field("text"), "Second only"); h.control.flush();
  assert.deepEqual(h.control.get(), [repeated, { time: 2.5, text: "Second only" }]);
  assert.deepEqual(repeated, { time: 2.5, text: "Noise" });
});

for (const action of ["edit", "delete"]) for (const time of [0, 9]) {
  test(`${action} of the last duplicate survives another editor sorting to ${time}`, t => {
    const rows = [{ time: 1, text: "Earlier" }, ...duplicateRows()], h = setup(t, { rows });
    h.edit(0); h.type(h.field("time"), String(time));
    const targetIndex = time === 0 ? 3 : 2;
    if (action === "edit") {
      h.edit(3);
      assert.equal(h.control.snapshot().editing.index, targetIndex);
      h.type(h.field("text"), "Last only"); h.action("apply").click();
      const expected = duplicateRows(); expected[2].text = "Last only";
      expected.push({ time, text: "Earlier" }); expected.sort((a, b) => a.time - b.time);
      assert.deepEqual(h.control.get(), expected);
      assert.equal(h.doc.activeElement, noteAt(h, targetIndex));
    } else {
      const remove = removeAt(h, 3); remove.focus(); remove.click();
      const expected = duplicateRows().slice(0, 2);
      expected.push({ time, text: "Earlier" }); expected.sort((a, b) => a.time - b.time);
      assert.deepEqual(h.control.get(), expected);
      assert.equal(h.doc.activeElement, removeAt(h, Math.min(targetIndex, 2)));
    }
  });
}

for (const [index, originalTime] of [[0, 1], [2, 5]]) {
  test(`committing row ${index} into an equal-value collision preserves its original stable slot`, t => {
    const rows = duplicateRows(); rows[index] = { time: originalTime, text: "Different" };
    const h = setup(t, { rows }); h.edit(index);
    h.type(h.field("time"), "2.5"); h.type(h.field("text"), "Noise");
    h.action("apply").click();
    assert.deepEqual(h.control.get(), duplicateRows());
    assert.equal(h.doc.activeElement, noteAt(h, index));
    h.edit(index); h.type(h.field("text"), "Still this occurrence"); h.control.flush();
    const expected = duplicateRows(); expected[index].text = "Still this occurrence";
    assert.deepEqual(h.control.get(), expected);
  });
}

for (const [field, raw] of [["time", "1:"], ["text", "\u0085"], ["text", "🎧".repeat(241)]]) {
  for (const action of ["edit", "delete"]) {
    test(`invalid ${field} blocks ${action} without damaging repeated-row identity`, t => {
      const h = setup(t, { rows: duplicateRows() }); h.edit(2); h.type(h.field(field), raw);
      h.type(h.input, "Keep pending text");
      const before = h.control.snapshot(), changes = h.changes(), invalid = h.field(field);
      (action === "edit" ? noteAt(h, 0) : removeAt(h, 0)).click();
      assert.deepEqual(h.control.snapshot(), before); assert.equal(h.changes(), changes);
      assert.equal(h.doc.activeElement, invalid);
      h.action("cancel").click();
      assert.deepEqual(h.control.get(), duplicateRows()); assert.equal(h.input.value, "Keep pending text");
      assert.equal(h.doc.activeElement, noteAt(h, 2));
      h.edit(2); assert.equal(h.control.snapshot().editing.index, 2);
    });
  }
}

for (const action of ["cancel", "Escape"]) {
  test(`${action} returns to the same duplicate without committing raw editor text`, t => {
    const h = setup(t, { rows: duplicateRows() }); h.edit(2);
    h.type(h.field("text"), "Not committed"); h.type(h.field("time"), "9");
    h.type(h.input, "Independent pending note");
    if (action === "cancel") h.action("cancel").click(); else h.key(h.field("text"), "Escape");
    assert.deepEqual(h.control.get(), duplicateRows());
    assert.equal(h.control.snapshot().editing, null); assert.equal(h.input.value, "Independent pending note");
    assert.equal(h.doc.activeElement, noteAt(h, 2));
  });
}

for (const source of ["time", "note", "inline"]) {
  test(`captured ${source} focus retains the last duplicate through flush and busy redraws`, t => {
    const h = setup(t, { rows: duplicateRows() });
    if (source === "inline") { h.edit(2); h.type(h.field("time"), "8"); h.field("text").focus(); }
    else h.list.children[2].querySelector(source === "time" ? ".marker-time" : ".marker-note").focus();
    const restore = h.control.captureFocus(); assert.equal(typeof restore, "function");
    h.type(h.input, "Noise");
    assert.equal(h.control.flush(), true); h.control.refresh(true); h.control.refresh(false); restore();
    const index = source === "inline" ? 3 : 2;
    assert.equal(h.doc.activeElement, h.list.children[index].querySelector(source === "time" ? ".marker-time" : ".marker-note"));
    assert.equal(h.control.get().length, 4);
  });
}

for (const reset of ["set", "restore", "delete"]) {
  test(`${reset} invalidates an old focus capture rather than guessing an equal row or old index`, t => {
    const h = setup(t, { rows: duplicateRows() }); noteAt(h, 2).focus();
    const restore = h.control.captureFocus(), saved = h.control.snapshot();
    if (reset === "set") h.control.set(duplicateRows(), false);
    else if (reset === "restore") assert.equal(h.control.restore(saved, false), true);
    else removeAt(h, 2).click();
    h.other.focus(); const focuses = h.doc.focuses; restore();
    assert.equal(h.doc.activeElement, h.other); assert.equal(h.doc.focuses, focuses);
  });
}

for (const reset of ["set", "restore"]) for (const action of ["edit", "delete"]) {
  test(`old ${action} button after ${reset} cannot target or commit a new equal-valued row`, t => {
    const h = setup(t, { rows: duplicateRows() });
    const old = action === "edit" ? noteAt(h, 2) : removeAt(h, 2), saved = h.control.snapshot();
    if (reset === "set") h.control.set(duplicateRows(), false); else h.control.restore(saved, false);
    h.edit(0); h.type(h.field("text"), "New uncommitted edit");
    const before = h.control.snapshot(), changes = h.changes(); old.click();
    assert.deepEqual(h.control.snapshot(), before); assert.equal(h.changes(), changes);
  });
}

test("restoring an unsorted duplicate editor binds its original index without sorting or rounding", t => {
  const exact = 5.123456789, rows = [{ time: exact, text: "Noise" }, { time: 1, text: "Earlier" }, { time: exact, text: "Noise" }];
  const h = setup(t, { rows }); h.edit(2); h.type(h.field("text"), "  Last only  ");
  h.type(h.input, "  Pending input  ");
  const saved = JSON.parse(JSON.stringify(h.control.snapshot()));
  h.control.set([], false); assert.equal(h.control.restore(saved, false), true);
  assert.deepEqual(h.control.snapshot(), saved); assert.equal(h.control.snapshot().editing.index, 2);
  h.action("apply").click();
  assert.deepEqual(h.control.get(), [{ time: 1, text: "Earlier" }, { time: exact, text: "Noise" }, { time: exact, text: "Last only" }]);
  assert.equal(h.doc.activeElement, noteAt(h, 2)); assert.equal(h.input.value, "  Pending input  ");
});

test("failed restore and read-only inspections preserve the live duplicate focus identity", t => {
  const h = setup(t, { rows: duplicateRows() }); noteAt(h, 2).focus();
  const restore = h.control.captureFocus(), saved = h.control.snapshot(), invalid = structuredClone(saved);
  invalid.rows[2].time = 99;
  assert.equal(h.control.restore(invalid, true), false);
  for (let i = 0; i < 3; i++) {
    assert.equal(h.control.canRestore(saved), true); assert.equal(h.control.hasChanges(duplicateRows()), false);
    h.control.get()[0].text = "Changed copy"; h.control.snapshot().rows.reverse();
  }
  h.control.refresh(false); restore();
  assert.equal(h.doc.activeElement, noteAt(h, 2)); assert.deepEqual(h.control.snapshot(), saved);
  h.edit(2); h.type(h.field("text"), "Changed"); h.control.hasChanges(duplicateRows());
  h.action("apply").click(); assert.equal(h.control.get()[2].text, "Changed");
});

test("separate mounted editors never share the identities of duplicate input objects", t => {
  const rows = duplicateRows(), first = setup(t, { rows }), second = setup(t, { rows });
  first.edit(2); first.type(first.field("text"), "First editor"); first.control.flush();
  second.edit(2); second.type(second.field("text"), "Second editor"); second.control.flush();
  assert.equal(first.control.get()[2].text, "First editor");
  assert.equal(second.control.get()[2].text, "Second editor"); assert.deepEqual(rows, duplicateRows());
});

test("marker identities never enter public rows, payloads or stored reload drafts", async t => {
  const moduleURL = name => root ? pathToFileURL(resolve(root, "src/audio_review_desk/static", name))
    : new URL(`../src/audio_review_desk/static/${name}`, import.meta.url);
  const { createDraftRecovery } = await import(moduleURL("draft-recovery.js"));
  const { reviewPayload } = await import(moduleURL("ui.js"));
  const h = setup(t, { rows: duplicateRows() }); h.edit(2); h.type(h.field("text"), "  Raw edit  ");
  const saved = h.control.snapshot(), rows = h.control.get();
  for (const row of [...saved.rows, ...rows]) {
    assert.deepEqual(Reflect.ownKeys(row), ["time", "text"]);
    assert.deepEqual(Object.getOwnPropertySymbols(row), []);
  }
  assert.deepEqual(Reflect.ownKeys(saved.editing), ["index", "time", "text", "originalTime", "timeDirty"]);
  const baseline = { version: 1, status: "pending", score: null, trim_start: null, trim_end: null,
    issues: [], note: "", markers: duplicateRows() };
  const form = { status: "pending", score: "", trimStart: "", trimEnd: "", issues: [], note: "" };
  const payload = reviewPayload({ key: "b".repeat(64), review: baseline }, { ...form, markers: rows });
  assert.deepEqual(payload.markers, duplicateRows());
  for (const row of payload.markers) assert.deepEqual(Reflect.ownKeys(row), ["time", "text"]);
  const storage = new Map(), recovery = createDraftRecovery({ workspaceId: "a".repeat(64),
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  assert.equal(recovery.write({ key: "b".repeat(64), baseline, form, markers: saved }).status, "saved");
  const result = recovery.read(); assert.equal(result.status, "available");
  assert.deepEqual(result.record.markers, saved);
  h.control.set([], false); assert.equal(h.control.restore(result.record.markers, false), true);
  h.control.flush(); assert.deepEqual(h.control.get().map(row => row.text), ["Noise", "Reverb", "Raw edit"]);
});
