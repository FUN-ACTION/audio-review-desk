import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Production renderJob with DOM doubles. Native progress rendering and screen
// reader announcements still require browser/assistive-technology assessment.
const root = process.env.ARD_PROGRESS_SOURCE_ROOT;
const source = name => root ? pathToFileURL(resolve(root, "src/audio_review_desk/static", name))
  : new URL(`../src/audio_review_desk/static/${name}`, import.meta.url);
const workbench = readFileSync(source("workbench.js"), "utf8");
const html = readFileSync(source("workbench.html"), "utf8");
const { words } = await import(source("copy.js"));
const code = workbench.slice(workbench.indexOf("function renderJob()"), workbench.indexOf("const jobPoller ="));
const running = (patch = {}) => ({ state: "running", phase: "decoding", label: "take.wav", done: 0, total: 0, ...patch });
function setup() {
  const nodes = new Map(); let summaries = 0;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {
      attributes: {}, writes: 0, _text: "", hidden: false,
      get textContent() { return this._text; },
      set textContent(value) { this._text = value; this.writes++; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      get value() { return Number(this.attributes.value || 0); },
      set value(value) { this.attributes.value = String(value); },
    });
    return nodes.get(id);
  };
  const run = Function("$", "words", "renderSummary", "document", `
    let job = null, language = "en", state = {};
    const t = key => words[language][key];
    const importing = () => job && ["running", "cancelling"].includes(job.state);
    ${code}
    return (next, lang = "en") => { job = next; language = lang; renderJob(); };
  `)($, words, () => summaries++, { activeElement: null, body: {} });
  return { $, run, summaries: () => summaries };
}

test("import progress is named, described and initially indeterminate", () => {
  const progress = html.match(/<progress\b[^>]*id="jobProgress"[^>]*>/)?.[0];
  assert.ok(progress);
  assert.match(progress, /data-title="jobProgress"/);
  assert.match(progress, /aria-label="导入进度"/);
  assert.match(progress, /aria-describedby="jobText jobCounter"/);
  assert.doesNotMatch(progress, /\bvalue=/);
  assert.equal(words.zh.jobProgress, "导入进度");
  assert.equal(words.en.jobProgress, "Import progress");
  assert.match(workbench, /element\.setAttribute\("aria-label", t\(element\.dataset\.title\)\)/);
});

test("only the stable phase is live, not filenames, counters or the Cancel button", () => {
  const phase = html.match(/<span\b[^>]*id="jobPhase"[^>]*>/)?.[0];
  assert.ok(phase);
  assert.match(phase, /class="sr-only"/);
  assert.match(phase, /role="status"/);
  assert.match(phase, /aria-live="polite"/);
  assert.match(phase, /aria-atomic="true"/);
  assert.ok(html.indexOf('id="jobPhase"') < html.indexOf('id="jobStrip"'), "live phase remains mounted when the strip hides");
  assert.doesNotMatch(html.match(/<section\b[^>]*id="jobStrip"[^>]*>/)[0], /aria-live|role="status"/);
  assert.match(html, /class="job-orbit" aria-hidden="true"/);
});

test("unknown totals remain indeterminate across known and restarted snapshots", () => {
  const h = setup();
  h.run(running());
  assert.equal(Object.hasOwn(h.$("jobProgress").attributes, "value"), false);
  assert.equal(h.$("jobCounter").textContent, "…");
  h.run(running({ total: 5 }));
  assert.equal(Object.hasOwn(h.$("jobProgress").attributes, "value"), true);
  assert.equal(h.$("jobProgress").value, 0, "known zero differs from unknown total");
  h.run(running({ done: 2, total: 5 }));
  assert.equal(h.$("jobProgress").value, 40);
  assert.equal(h.$("jobCounter").textContent, "2 / 5");
  h.run(running());
  assert.equal(Object.hasOwn(h.$("jobProgress").attributes, "value"), false);
});

test("file and count changes never repeatedly announce the unchanged reading phase", () => {
  const h = setup();
  h.run(running({ total: 5 }));
  assert.equal(h.$("jobPhase").textContent, words.en.jobReading);
  for (let done = 0; done < 5; done++) h.run(running({ done, total: 5, label: `take-${done}.wav` }));
  assert.equal(h.$("jobPhase").writes, 1);
  assert.equal(h.$("jobText").textContent, "take-4.wav");
  assert.equal(h.$("cancelImport").disabled, false);
});

for (const [name, patch, key] of [
  ["cancellation", { state: "cancelling" }, "jobCancel"],
  ["saving", { phase: "saving", done: 5 }, "jobSaving"],
]) {
  test(`${name} announces its phase once and disables cancellation`, () => {
    const h = setup(); h.run(running({ total: 5 }));
    h.run(running({ total: 5, ...patch }));
    h.run(running({ total: 5, ...patch }));
    assert.equal(h.$("jobPhase").textContent, words.en[key]);
    assert.equal(h.$("jobPhase").writes, 2);
    assert.equal(h.$("jobText").textContent, words.en[key]);
    assert.equal(h.$("cancelImport").disabled, true);
  });
}

test("changing language updates the phase while repeated same-language snapshots stay quiet", () => {
  const h = setup(); h.run(running()); h.run(running(), "zh"); h.run(running(), "zh");
  assert.equal(h.$("jobPhase").textContent, words.zh.jobReading);
  assert.equal(h.$("jobPhase").writes, 2);
  assert.equal(words.en.jobCancel, "Stopping import…");
  assert.equal(words.zh.jobCancel, "正在停止导入…");
});

test("terminal and empty snapshots hide progress and clear the old live phase once", () => {
  const h = setup(); h.run(running());
  for (const state of ["succeeded", "failed", "cancelled", "idle"]) {
    h.run({ state }); assert.equal(h.$("jobStrip").hidden, true);
    assert.equal(h.$("jobPhase").textContent, "");
  }
  h.run(null);
  assert.equal(h.$("jobPhase").writes, 2);
  assert.equal(h.summaries(), 6);
});

test("a new import after cancellation announces reading again and enables Stop", () => {
  const h = setup(); h.run(running({ state: "cancelling" }));
  h.run({ state: "cancelled" }); h.run(running());
  assert.equal(h.$("jobPhase").textContent, words.en.jobReading);
  assert.equal(h.$("jobPhase").writes, 3);
  assert.equal(h.$("cancelImport").disabled, false);
  assert.equal(h.$("jobStrip").hidden, false);
});

test("cancellation copy retains precedence over a saving phase", () => {
  const h = setup(); h.run(running({ state: "cancelling", phase: "saving" }));
  assert.equal(h.$("jobPhase").textContent, words.en.jobCancel);
  assert.equal(h.$("jobText").textContent, words.en.jobCancel);
  assert.equal(h.$("cancelImport").disabled, true);
});

test("the actual localization loop updates the progress name in both languages", () => {
  const loop = workbench.match(/document\.querySelectorAll\("\[data-title\]"\)\.forEach\(\(element\) => \{[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(loop);
  const h = setup(), progress = h.$("jobProgress");
  progress.dataset = { title: "jobProgress" };
  const localize = Function("document", "t", loop);
  for (const [language, expected] of [["zh", "导入进度"], ["en", "Import progress"]]) {
    localize({ querySelectorAll: () => [progress] }, key => words[language][key]);
    assert.equal(progress.attributes["aria-label"], expected);
    assert.equal(progress.title, expected);
  }
});
