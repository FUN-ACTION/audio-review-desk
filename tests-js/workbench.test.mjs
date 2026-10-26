import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { words } from "../src/audio_review_desk/static/copy.js";
import {
  errorMessages,
  errorText,
} from "../src/audio_review_desk/static/errors.js";
import { findCommands } from "../src/audio_review_desk/static/commands.js";
import { copyMarkers } from "../src/audio_review_desk/static/markers.js";
import { sortItems } from "../src/audio_review_desk/static/ui.js";
const root = new URL("../", import.meta.url);
test("recent review ordering puts saved reviews before untouched clips", () => {
  const rows = [
    { id: "a", review: { updated_utc: null } },
    { id: "b", review: { updated_utc: "2026-10-26T13:00:00Z" } },
    { id: "c", review: { updated_utc: "2026-10-26T14:00:00Z" } },
  ];
  assert.deepEqual(
    sortItems(rows, "recent").map((row) => row.id),
    ["c", "b", "a"],
  );
  assert.equal(rows[0].id, "a");
});
test("every visible static label and accessibility label exists in both languages", () => {
  assert.deepEqual(Object.keys(words.zh).sort(), Object.keys(words.en).sort());
  const html = readFileSync(
    new URL("src/audio_review_desk/static/workbench.html", root),
    "utf8",
  );
  for (const [, key] of html.matchAll(
    /data-(?:t|title|placeholder)="([^"]+)"/g,
  )) {
    assert.ok(words.zh[key], `Missing Chinese: ${key}`);
    assert.ok(words.en[key], `Missing English: ${key}`);
  }
});
test("all server error codes have paired translations and safe fallback text", () => {
  const python = readFileSync(
    new URL("src/audio_review_desk/errors.py", root),
    "utf8",
  );
  for (const [, code] of python.matchAll(/"([a-z]+(?:_[a-z]+)+)"/g))
    assert.ok(errorMessages[code], code);
  for (const [code, pair] of Object.entries(errorMessages))
    assert.ok(
      pair.length === 2 &&
        pair.every((x) => typeof x === "string" && x.length > 0),
      code,
    );
  assert.match(
    errorText({ code: "source_contains_workspace" }, "zh"),
    /工作区/,
  );
  assert.equal(
    errorText({ error: "private raw error" }, "zh"),
    errorMessages.operation_failed[0],
  );
});
test("commands match every query token without reordering the catalog", () => {
  const rows = [
    { label: "原音频 clip 12", search: "first" },
    { label: "导入音频", search: "import" },
  ];
  assert.equal(findCommands(rows, "CLIP １２")[0], rows[0]);
  assert.deepEqual(findCommands(rows, "first missing"), []);
  assert.equal(findCommands(rows, "import")[0], rows[1]);
  assert.equal(rows[0].search, "first");
});
test("time-note drafts are independent copies and retain a zero timestamp", () => {
  const saved = [{ time: 0, text: "Start" }],
    draft = copyMarkers(saved);
  draft[0].text = "changed";
  assert.equal(saved[0].text, "Start");
  assert.equal(draft[0].time, 0);
  assert.deepEqual(copyMarkers(), []);
});
test("the shipped Motion bundle matches its pinned build record", () => {
  const bytes = readFileSync(
    new URL("src/audio_review_desk/static/motion-vendor.js", root),
  );
  const record = JSON.parse(
    readFileSync(new URL("scripts/motion-build/bundle.json", root)),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256);
  assert.match(
    readFileSync(
      new URL("src/audio_review_desk/static/motion-LICENSE.txt", root),
      "utf8",
    ),
    /MIT/,
  );
  assert.doesNotMatch(bytes.toString(), /from[\s]*["'](?:https?:|react)/);
});
