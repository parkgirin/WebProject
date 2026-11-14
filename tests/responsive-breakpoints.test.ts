import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPACT_PORTRAIT_MEDIA, COMPACT_WORKSPACE_MEDIA } from "../src/editor/responsive-layout.ts";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../src/editor/inspector.ts", import.meta.url), "utf8");

test("compact mode distinguishes phones from tall PC multi-window layouts", () => {
  assert.equal(
    COMPACT_WORKSPACE_MEDIA,
    "(max-width: 820px), (min-width: 821px) and (max-width: 1180px) and (max-height: 760px)",
  );
  assert.match(styles, /@media \(max-width: 820px\), \(min-width: 821px\) and \(max-width: 1180px\) and \(max-height: 760px\)/);
  assert.match(app, /mobilePanelQuery = window\.matchMedia\?\.\(COMPACT_WORKSPACE_MEDIA\)/);
  assert.match(inspector, /matchMedia\?\.\(COMPACT_WORKSPACE_MEDIA\)/);
});

test("compact panel placement follows aspect ratio without a top control bar", () => {
  assert.match(COMPACT_PORTRAIT_MEDIA, /max-aspect-ratio: 4\/3/);
  assert.match(styles, /min-aspect-ratio: 4\/3/);
  assert.match(styles, /\.mobile-workspace-actions \{ display: none; \}/);
  assert.match(styles, /\.mobile-panel-index \{ right: 0; display: grid;/);
});

test("the compact toolbox uses two internal rails without reserving a workspace column", () => {
  assert.match(styles, /\.toolbox-section-content \{[\s\S]*?left: 60px;/);
  assert.match(styles, /\.toolbox-section\[open\] \.toolbox-section-content \{ display: grid; \}/);
  assert.doesNotMatch(styles, /--compact-toolbox-column-width/);
  assert.match(styles, /grid-template-areas: "editor"/);
});
