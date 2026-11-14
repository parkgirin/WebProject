import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("world rotation input instructions live in the top help dialog", () => {
  const panel = app.match(/<section class="world-transform-panel"[\s\S]*?<\/section>/)?.[0] ?? "";
  const help = app.match(/<dialog class="preset-dialog controls-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";

  assert.doesNotMatch(panel, /우클릭|두 손가락|드래그:/);
  assert.match(help, /<h3>월드 회전<\/h3>/);
  assert.match(help, /PC · 우클릭 드래그/);
  assert.match(help, /모바일 · 화면 도구 \+ 한 손가락/);
  assert.match(help, /모바일 · 화면 도구 \+ 두 손가락/);
});

test("the help entry remains visible in compact headers", () => {
  assert.match(app, /controls-help-button[^>]*data-open-controls>도움말<\/button>/);
  assert.doesNotMatch(styles, /\.save-buttons \.is-secondary:first-child \{ display: none; \}/);
  assert.doesNotMatch(styles, /\.save-buttons \.is-secondary \{ display: none; \}/);
});
