import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

test("compact settings hide the redundant world panel button", () => {
  const compact = styles.match(
    /@media \(max-width: 820px\), \(min-width: 821px\)[\s\S]*?(?=@media \(max-width: 820px\) and \(max-aspect-ratio)/,
  )?.[0] ?? "";

  assert.match(compact, /\.world-panel-toggle \{ display: none; \}/);
  assert.match(compact, /\.world-axis-guide svg \{ width: 72px; height: 56px; \}/);
});

test("portrait world panels put perspective controls in the second column beside a square guide", () => {
  const portrait = styles.match(
    /@media \(max-width: 820px\) and \(max-aspect-ratio: 4\/3\),[\s\S]*?(?=@media \(max-width: 420px\))/,
  )?.[0] ?? "";

  assert.match(portrait, /\.workspace\.mobile-panel-world \.world-transform-panel \{[\s\S]*?grid-template-columns: minmax\(124px, \.8fr\) minmax\(0, 1\.2fr\);/);
  assert.match(portrait, /\.world-axis-guide \{ width: min\(100%, 108px\); min-height: 0; aspect-ratio: 1;/);
  assert.match(portrait, /\.world-axis-guide svg \{ width: 82px; height: 82px; \}/);
  assert.match(app, /<div class="world-transform-controls">[\s\S]*?<div class="global-rotation-control">[\s\S]*?<div class="world-perspective-controls">/);
});
