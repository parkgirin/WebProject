import assert from "node:assert/strict";
import test from "node:test";

import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";

const viewState: EditorViewState = {
  outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso",
  selectedTarget: "joint", inspectorTab: "selection", preserveProportions: false,
  activeTool: "select", paintColor: "#dca27b", paintPaletteId: null,
};

test("procedural torso surface does not require a waist endpoint bridge", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  assert.deepEqual(waist.axes.map((axis) => axis.id), ["upper-torso"]);
  const host = { innerHTML: "" } as SVGSVGElement;
  const render = () => renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  render();
  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="waist"/);

  waist.bodyVisible = false;
  render();
  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="waist"/);
  assert.match(host.innerHTML, /data-face-id="torso"/);
  assert.match(host.innerHTML, /data-joint-id="waist"/);

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });
  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="waist"/);

  rig.groups.find((group) => group.id === "torso")!.visible = false;
  render();
  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="waist"/);
});

test("hidden elbow joins distinct visible axis endpoints and hidden wrist gets a straight end line", () => {
  const rig = createDefaultRig();
  const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
  elbow.bodyVisible = false;
  elbow.axes.find((axis) => axis.id === "lower-arm")!.angle = 50;
  rig.joints.find((joint) => joint.id === "left-wrist")!.bodyVisible = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const elbowBridge = host.innerHTML.match(/<g class="joint-bridge" data-bridge-joint-id="left-elbow">[\s\S]*?<\/g>/)?.[0];
  const wristBridge = host.innerHTML.match(/<g class="joint-bridge" data-bridge-joint-id="left-wrist">[\s\S]*?<\/g>/)?.[0];
  assert.ok(elbowBridge && wristBridge);
  assert.match(elbowBridge, /class="body-face-outline"/);
  assert.match(wristBridge, /class="body-face-outline"/);
  assert.ok(host.innerHTML.indexOf('data-bridge-joint-id="left-elbow"') < host.innerHTML.indexOf('data-face-id="left-upper-arm"'));
});

test("a hidden joint group does not create a bridge", () => {
  const rig = createDefaultRig();
  const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
  elbow.bodyVisible = false;
  elbow.axes.find((axis) => axis.id === "lower-arm")!.angle = 50;
  rig.groups.find((group) => group.id === "left-arm")!.visible = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="left-elbow"/);
});

test("hidden joints use a procedural silhouette bridge without authored face axes", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("left-wrist", 230);
  state.setJointBodyVisible("left-elbow", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.match(host.innerHTML, /data-bridge-joint-id="left-elbow"/);
});

test("a joint can opt out of face extension and use its endpoint bridge", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("left-wrist", 230);
  state.setJointBodyVisible("left-elbow", false);
  state.setJointsFaceExtensionEnabled(["left-elbow"], false);
  const host = { innerHTML: "" } as SVGSVGElement;

  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.match(host.innerHTML, /data-bridge-joint-id="left-elbow"/);
});

test("a joint can hide only its own output outline", () => {
  const state = new RigState(createDefaultRig());
  const host = { innerHTML: "" } as SVGSVGElement;
  const render = () => renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  render();
  const before = host.innerHTML.match(/class="body-joint-outline"/g)?.length ?? 0;
  state.setJointsOutlineVisible(["left-shoulder"], false);
  render();
  assert.equal(host.innerHTML.match(/class="body-joint-outline"/g)?.length ?? 0, before - 1);
});

test("hidden shoulder keeps the capsule and uses a simple arm endpoint bridge", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-elbow", 35);
  state.setJointBodyVisible("right-shoulder", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.match(host.innerHTML, /data-peer-group-id="shoulder-band"/);
  assert.match(host.innerHTML, /data-bridge-joint-id="right-shoulder"/);
});

test("hidden knee uses a procedural silhouette bridge when the leg bends", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-ankle", 35);
  state.setJointBodyVisible("right-knee", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.match(host.innerHTML, /data-bridge-joint-id="right-knee"/);
});

test("hidden hip uses a simple upper-leg endpoint bridge without pelvis faces", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-knee", 70);
  state.setJointBodyVisible("right-hip", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.match(host.innerHTML, /data-bridge-joint-id="right-hip"/);
  assert.doesNotMatch(host.innerHTML, /data-face-id="pelvis"|data-face-id="right-pelvis-triangle"/);
  assert.deepEqual(state.getJoint("right-hip").axes.map((axis) => axis.id), ["upper-leg"]);
});

