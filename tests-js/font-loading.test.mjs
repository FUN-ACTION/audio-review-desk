import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const staticRoot = new URL("../src/audio_review_desk/static/", import.meta.url);
const read = (name) => readFileSync(new URL(name, staticRoot), "utf8");
const bytes = (name) => readFileSync(new URL(name, staticRoot));
const manifest = (name) => JSON.parse(readFileSync(new URL(`../scripts/fonts/${name}.json`, import.meta.url), "utf8"));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const attributes = (tag) => Object.fromEntries(
  [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key, value]),
);
const fontPreloads = (html) => [...html.matchAll(/<link\b[^>]*>/gi)]
  .map(([tag]) => ({ tag, ...attributes(tag) }))
  .filter(({ rel, as }) => rel?.split(/\s+/).includes("preload") && as === "font");

test("tour declares at most 100 KiB of font preloads, selecting its actual Inter face", () => {
  const preloads = fontPreloads(read("tour/index.html"));
  const total = preloads.reduce((sum, { href }) => sum + readFileSync(new URL(href, new URL("tour/", staticRoot))).length, 0);
  assert.ok(total <= 100 * 1024, `Declared unconditional font-preload payload is ${total} bytes; budget is 102400`);
  assert.deepEqual(preloads.map(({ href }) => href), ["../studio-latin.woff2"]);
  assert.equal(preloads[0].type, "font/woff2");
  assert.match(preloads[0].tag, /\bcrossorigin\b/);
  const inter = manifest("bundle").fonts.find(({ file }) => file === "studio-latin.woff2");
  assert.equal(inter.family, "inter");
  assert.equal(bytes(inter.file).length, 48072);
  assert.equal(sha256(bytes(inter.file)), inter.sha256);
  const css = read("tour/tour.css");
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Review Studio";[^}]*src:\s*url\("\.\.\/studio-latin\.woff2"\)/);
  assert.match(css, /:root\s*\{[^}]*font-family:\s*"Review Studio",/);
});

test("tour retains unchanged full MiSans and its license through demand-loaded CSS", () => {
  assert.match(read("tour/index.html"), /<link\b[^>]*rel="stylesheet"[^>]*href="\.\.\/fonts\.css(?:\?[^\"]*)?"/);
  const css = read("fonts.css");
  for (const family of ["Desk UI CJK", "Desk CJK"]) {
    const face = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, body]) => body)
      .find((body) => body.includes(`font-family: "${family}"`));
    assert.ok(face, `${family} remains available`);
    assert.match(face, /src:\s*url\("\.\/MiSans-Regular\.woff2"\)/);
    assert.match(face, /unicode-range:\s*U\+2E80-9FFF, U\+F900-FAFF, U\+FF00-FFEF;/);
    assert.match(face, /font-display:\s*swap;/);
  }
  assert.match(read("tour/tour.css"), /:root\s*\{[^}]*font-family:[^;]*"Desk UI CJK"/);
  const original = manifest("studio").fonts.find(({ file }) => file === "MiSans-Regular.woff2");
  assert.equal(original.unchanged, true);
  assert.equal(original.sha256, original.source_sha256);
  assert.equal(bytes(original.file).length, original.bytes);
  assert.equal(sha256(bytes(original.file)), original.source_sha256);
  assert.equal(sha256(bytes("MiSans-License.pdf")), "4a93a27cd2bd81b3b5ecfd0a853144a876fa26938a93a68443c67d74172fcb86");
});

test("workbench keeps its existing Geist and full MiSans preloads", () => {
  assert.deepEqual(fontPreloads(read("workbench.html")).map(({ href }) => href), ["/geist-latin.woff2", "/MiSans-Regular.woff2"]);
});
