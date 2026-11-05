import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copy } from "../src/audio_review_desk/static/tour/tour-copy.js";

const read = (name) => readFileSync(new URL(`../src/audio_review_desk/static/${name}`, import.meta.url), "utf8");
const workspace = read("workbench-studio.css");
const website = read("tour/tour.css");
const declarations = (rule) => Object.fromEntries(
  [...rule.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);
const light = declarations(workspace.match(/^:root \{([^}]+)\}/m)[1]);
const dark = { ...light, ...declarations(workspace.match(/^:root\[data-theme="dark"\] \{([^}]+)\}/m)[1]) };
function luminance(hex) {
  assert.match(hex, /^#[a-f0-9]{6}$/i, "Contrast tokens must be opaque six-digit colors");
  const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test("workspace action text passes 4.5:1 in both themes, at rest and on hover", () => {
  assert.match(workspace, /button\.primary, \.button-link\.primary\s*\{[^}]*color:\s*var\(--primary-ink\);[^}]*background:\s*var\(--primary-fill\);/);
  assert.match(workspace, /button\.primary:hover:not\(:disabled\), \.button-link\.primary:hover\s*\{[^}]*background:\s*var\(--primary-hover\);/);
  for (const [name, tokens] of [["light", light], ["dark", dark]]) {
    for (const background of ["--primary-fill", "--primary-hover"])
      assert.ok(contrast(tokens["--primary-ink"], tokens[background]) >= 4.5, `${name} ${background}`);
  }
});

test("workspace secondary text and link colors remain readable across surfaces", () => {
  for (const [name, tokens] of [["light", light], ["dark", dark]]) {
    for (const foreground of ["--ink", "--muted", "--blue"]) {
      for (const background of ["--page", "--sidebar", "--surface", "--subtle", "--blue-soft"])
        assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${name} ${foreground} on ${background}`);
    }
  }
  assert.match(workspace, /:focus-visible\s*\{\s*outline:\s*3px solid var\(--blue\)/);
});

test("website action hover and secondary copy pass normal text contrast", () => {
  const tokens = declarations(website.match(/^:root \{([^}]+)\}/m)[1]);
  for (const background of [tokens["--blue"], tokens["--primary-hover"]])
    assert.ok(contrast("#ffffff", background) >= 4.5);
  for (const foreground of [tokens["--blue"], tokens["--secondary"]])
    for (const background of ["#ffffff", "#f0f0f2", "#f5f5f7"])
      assert.ok(contrast(foreground, background) >= 4.5);
  assert.match(website, /\.button:hover\s*\{\s*background:\s*var\(--primary-hover\)/);
});

test("reduced motion removes press scaling while retaining timeline marker positioning", () => {
  const workspaceReduced = workspace.slice(workspace.indexOf("@media (prefers-reduced-motion: reduce)"));
  const websiteReduced = website.slice(website.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(workspaceReduced, /button:active:not\(:disabled\), \.button-link:active,[\s\S]*?transform: none;/);
  assert.match(workspaceReduced, /\.marker-tick:active\s*\{\s*transform: translateX\(-50%\) !important;/);
  assert.match(websiteReduced, /button:active, \.button:active\s*\{\s*transform: none;/);
});

test("the public site's download actions work without script and disclose setup nearby", () => {
  const html = read("tour/index.html");
  const actions = [...html.matchAll(/<a\b[^>]*\bdata-open\b[^>]*>/g)];
  assert.equal(actions.length, 3);
  for (const [action] of actions) {
    assert.match(action, /href="https:\/\/github.com\/FUN-ACTION\/audio-review-desk\/releases\/latest"/);
    assert.match(action, /data-copy="get"/);
  }
  assert.match(html, /aria-describedby="heroInstallHint"/);
  assert.match(html, /id="heroInstallHint" data-copy="installBody"/);
  assert.equal(copy.en.get, "Download source");
  assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort());
  for (const [, key] of html.matchAll(/data-(?:copy|placeholder)="([^"]+)"/g))
    for (const language of ["zh", "en"]) assert.ok(copy[language][key], `${language}: ${key}`);
});
