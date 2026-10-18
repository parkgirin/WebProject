import assert from "node:assert/strict";
import test from "node:test";

import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getAxisPoint } from "../src/rig/geometry.ts";

const viewState: EditorViewState = {
  outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso",
  selectedTarget: "joint", inspectorTab: "selection", preserveProportions: false,
  activeTool: "select", paintColor: "#dca27b", paintPaletteId: null,
};

test("hidden waist is filled by the four torso and pelvis axis endpoints", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  waist.axes.find((axis) => axis.id === "pelvis")!.angle = 40;
  const host = { innerHTML: "" } as SVGSVGElement;
  const render = () => renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  render();
  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="waist"/);

  waist.bodyVisible = false;
  render();
  const bridge = host.innerHTML.match(/<g class="joint-bridge" data-bridge-joint-id="waist">[\s\S]*?<\/g>/)?.[0];
  assert.ok(bridge);
  const pointList = bridge.match(/<polygon points="([^"]+)"/)![1];
  const points = pointList.split(" ");
  assert.equal(points.length, 4);
  for (const axis of waist.axes) {
    for (const side of [-1, 1] as const) {
      const point = getAxisPoint(rig, waist, axis, side);
      assert.ok(points.includes(`${point.x},${point.y}`));
    }
  }
  assert.match(bridge, /class="body-face-outline"/);
  assert.ok(host.innerHTML.indexOf('data-bridge-joint-id="waist"') < host.innerHTML.indexOf('data-face-id="torso"'));
  assert.match(host.innerHTML, /data-joint-id="waist"/);

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
  assert.equal(elbowBridge.match(/<polygon points="([^"]+)"/)![1].split(" ").length, 4);
  assert.match(wristBridge, /<polyline class="body-face-outline"/);
  assert.doesNotMatch(wristBridge, /<polygon/);
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
