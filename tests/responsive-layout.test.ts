import assert from "node:assert/strict";
import test from "node:test";

import { getPanelAvoidanceLift, type LayoutRect } from "../src/editor/responsive-layout.ts";

const rect = (left: number, top: number, width: number, height: number): LayoutRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

test("history controls move just above an overlapping bottom panel", () => {
  const history = rect(12, 700, 96, 44);
  const panel = rect(0, 620, 400, 160);

  assert.equal(getPanelAvoidanceLift(history, [panel]), 134);
});

test("side panels and panels already below the controls do not move history controls", () => {
  const history = rect(12, 700, 96, 44);
  const sidePanel = rect(300, 400, 180, 380);
  const lowerPanel = rect(0, 750, 400, 30);

  assert.equal(getPanelAvoidanceLift(history, [sidePanel, lowerPanel]), 0);
});

test("the highest overlapping panel edge wins when sheets are stacked", () => {
  const history = rect(12, 700, 96, 44);
  const panel = rect(0, 640, 400, 140);
  const tabs = rect(0, 620, 400, 42);

  assert.equal(getPanelAvoidanceLift(history, [panel, tabs], 8), 132);
});
