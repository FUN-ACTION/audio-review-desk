import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shouldPlay,
  activeClip,
  mediaPath,
  clampFilmTime,
  installCommands,
} from "../src/audio_review_desk/static/tour/playback-policy.js";
import { copy } from "../src/audio_review_desk/static/tour/tour-copy.js";
import { filmDurations } from "../src/audio_review_desk/static/tour/media-info.js";

test("poster-only playback controls show the verified duration before loading video", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../docs/showcase-media.json", import.meta.url),
      "utf8",
    ),
  );
  for (const clip of manifest.clips) {
    const [kind, language] = clip.file.replace(".mp4", "").split("-");
    assert.equal(filmDurations[kind][language], clip.seconds);
  }
});

const visible = { visible: true, pageVisible: true, reducedMotion: false };
test("completed films stay stopped and cinema playback suspends inline footage", () => {
  assert.equal(shouldPlay({ ...visible, completed: true }), false);
  assert.equal(
    shouldPlay({ ...visible, modalOpen: true, choice: "play" }),
    false,
  );
  assert.equal(clampFilmTime(100, 12), 12);
  assert.equal(clampFilmTime(-1, 12), 0);
  assert.equal(clampFilmTime(NaN, NaN), 0);
});
test("source installation creates a workspace before serving it", () => {
  const commands = installCommands("linux");
  assert.ok(
    commands.indexOf(" init --workspace") <
      commands.indexOf(" serve --workspace"),
  );
  assert.match(commands, /python -m pip install \./);
  assert.equal(installCommands("windows"), "");
  assert.throws(() => installCommands("unrecognized"));
});
test("automatic footage stays still for reduced motion or data saving", () => {
  assert.equal(shouldPlay({ ...visible, reducedMotion: true }), false);
  assert.equal(shouldPlay({ ...visible, saveData: true }), false);
  assert.equal(
    shouldPlay({ ...visible, reducedMotion: true, choice: "play" }),
    true,
  );
});
test("hidden footage pauses and an explicit pause survives re-entry", () => {
  for (const choice of ["auto", "play", "pause"]) {
    assert.equal(shouldPlay({ ...visible, visible: false, choice }), false);
    assert.equal(shouldPlay({ ...visible, pageVisible: false, choice }), false);
  }
  assert.equal(shouldPlay({ ...visible, choice: "pause" }), false);
});
test("only one visible recording is selected, with explicit play taking priority", () => {
  const entries = [
    { id: "workflow", ratio: 0.9 },
    { id: "notes", ratio: 0.6, choice: "play" },
    { id: "range", ratio: 0 },
  ];
  assert.equal(activeClip(entries), "notes");
  assert.equal(entries[0].id, "workflow");
  assert.equal(activeClip(entries.map((row) => ({ ...row, ratio: 0 }))), null);
});
test("translated video sources are bounded to the six recorded clips", () => {
  assert.equal(mediaPath("notes", "en"), "./media/notes-en.mp4");
  assert.equal(mediaPath("workflow", "zh", "webp"), "./media/workflow-zh.webp");
  assert.throws(() => mediaPath("../private", "zh"));
  assert.throws(() => mediaPath("range", "xx"));
});
test("walkthrough copy and accessible labels exist in both languages", () => {
  assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort());
  const html = readFileSync(
    new URL("../src/audio_review_desk/static/tour/index.html", import.meta.url),
    "utf8",
  );
  for (const [, key] of html.matchAll(/data-(?:copy|label)="([^"]+)"/g)) {
    assert.ok(copy.zh[key], key);
    assert.ok(copy.en[key], key);
  }
});
