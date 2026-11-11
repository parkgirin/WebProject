import assert from "node:assert/strict";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";

const viewState: EditorViewState = {
  outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso",
  selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
  activeTool: "select", paintColor: "#dca27b", paintPaletteId: null,
};

test("joint visibility control batch-applies to every selected joint and supports undo", () => {
  const state = new RigState(createDefaultRig());
  let change: (() => void) | undefined;
  const input = {
    checked: false,
    indeterminate: false,
    addEventListener: (event: string, handler: () => void) => { if (event === "change") change = handler; },
  };
  const element = {
    innerHTML: "",
    querySelector: (selector: string) => selector === "[data-selected-joint-body]" ? input : null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
  renderInspector(element, state, { jointId: "left-shoulder", axisId: "torso", jointIds: ["left-shoulder", "right-shoulder"] }, () => {}, viewState, () => {});
  assert.match(element.innerHTML, /data-selected-joint-body checked/);
  assert.match(element.innerHTML, /2개 관절에 함께 적용합니다/);
  assert.ok(change);
  change();
  assert.equal(state.getJoint("left-shoulder").bodyVisible, false);
  assert.equal(state.getJoint("right-shoulder").bodyVisible, false);
  state.undo();
  assert.equal(state.getJoint("left-shoulder").bodyVisible, true);
  assert.equal(state.getJoint("right-shoulder").bodyVisible, true);
});

test("outline and face-extension options batch-apply to every selected joint", () => {
  const rig = createDefaultRig();
  rig.joints.find((joint) => joint.id === "left-shoulder")!.outlineVisible = false;
  const state = new RigState(rig);
  let outlineChange: (() => void) | undefined;
  let extensionChange: (() => void) | undefined;
  const outlineInput = { checked: true, indeterminate: false,
    addEventListener: (event: string, handler: () => void) => { if (event === "change") outlineChange = handler; } };
  const extensionInput = { checked: false, indeterminate: false,
    addEventListener: (event: string, handler: () => void) => { if (event === "change") extensionChange = handler; } };
  const element = {
    innerHTML: "",
    querySelector: (selector: string) => selector === "[data-selected-joint-outlines]" ? outlineInput
      : selector === "[data-selected-joint-extension]" ? extensionInput : null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
  const selected = { jointId: "left-shoulder", axisId: "torso", jointIds: ["left-shoulder", "right-shoulder"] };
  renderInspector(element, state, selected, () => {}, viewState, () => {});

  assert.equal(outlineInput.indeterminate, true);
  assert.match(element.innerHTML, /2개 관절에 함께 적용합니다/);
  outlineChange!();
  assert.equal(state.getJoint("left-shoulder").outlineVisible, true);
  assert.equal(state.getJoint("right-shoulder").outlineVisible, true);
  extensionChange!();
  assert.equal(state.getJoint("left-shoulder").faceExtensionEnabled, false);
  assert.equal(state.getJoint("right-shoulder").faceExtensionEnabled, false);
  state.undo();
  assert.equal(state.getJoint("left-shoulder").faceExtensionEnabled, undefined);
});
