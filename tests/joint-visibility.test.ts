import assert from "node:assert/strict";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";

const viewState: EditorViewState = {
  outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso",
  selectedTarget: "joint", inspectorTab: "selection", preserveProportions: false,
  activeTool: "select", paintColor: "#dca27b", paintPaletteId: null,
};

test("individual joint visibility control updates only the selected joint and supports undo", () => {
  const state = new RigState(createDefaultRig());
  let change: (() => void) | undefined;
  const input = {
    checked: false,
    dataset: { bodyVisible: "left-shoulder" },
    addEventListener: (event: string, handler: () => void) => { if (event === "change") change = handler; },
  };
  const element = {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-body-visible]" ? [input] : [],
  } as unknown as HTMLElement;
  renderInspector(element, state, { jointId: "left-shoulder", axisId: "torso", jointIds: ["left-shoulder", "right-shoulder"] }, () => {}, viewState, () => {});
  assert.match(element.innerHTML, /data-body-visible="left-shoulder" checked/);
  assert.match(element.innerHTML, /현재 선택된 관절 하나에 적용됩니다/);
  assert.ok(change);
  change();
  assert.equal(state.getJoint("left-shoulder").bodyVisible, false);
  assert.equal(state.getJoint("right-shoulder").bodyVisible, true);
  state.undo();
  assert.equal(state.getJoint("left-shoulder").bodyVisible, true);
});
