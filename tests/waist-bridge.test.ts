import assert from "node:assert/strict";
import test from "node:test";

import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getAxisPoint, getFacePoints, getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

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

test("hidden joint extension makes two adjacent faces meet at their boundary intersections", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("left-wrist", 230);
  state.setJointBodyVisible("left-elbow", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="left-elbow"/);
  const facePoints = (faceId: string) => host.innerHTML
    .match(new RegExp(`data-face-id="${faceId}" points="([^"]+)"`))![1]
    .split(" ").map((entry) => entry.split(",").map(Number));
  const upper = facePoints("left-upper-arm");
  const lower = facePoints("left-lower-arm");
  assert.deepEqual(upper[1], lower[0]);
  assert.deepEqual(upper[2], lower[3]);
});

test("hidden shoulder extends a two-axis compound torso surface into the upper arm", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-elbow", 35);
  state.setJointBodyVisible("right-shoulder", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="right-shoulder"/);
  const facePoints = (faceId: string) => host.innerHTML
    .match(new RegExp(`data-face-id="${faceId}" points="([^"]+)"`))![1]
    .split(" ").map((entry) => entry.split(",").map(Number));
  const incoming = [...facePoints("shoulder-band"), ...facePoints("torso")];
  const upperArm = facePoints("right-upper-arm");
  for (const point of [upperArm[0], upperArm[3]]) {
    assert.ok(incoming.some((candidate) => candidate[0] === point[0] && candidate[1] === point[1]));
  }
});

test("hidden knee pairs the two outlines by silhouette side when the leg bends", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-ankle", 35);
  state.setJointBodyVisible("right-knee", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="right-knee"/);
  const facePoints = (faceId: string) => host.innerHTML
    .match(new RegExp(`data-face-id="${faceId}" points="([^"]+)"`))![1]
    .split(" ").map((entry) => entry.split(",").map(Number));
  const upper = facePoints("right-upper-leg");
  const lower = facePoints("right-lower-leg");
  assert.deepEqual(upper[1], lower[0]);
  assert.deepEqual(upper[2], lower[3]);
});

test("hidden hip joins both outer and inner pelvis-thigh outline pairs", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-knee", 70);
  state.setJointBodyVisible("right-hip", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="right-hip"/);

  const facePoints = (faceId: string) => host.innerHTML
    .match(new RegExp(`data-face-id="${faceId}" points="([^"]+)"`))![1]
    .split(" ").map((entry) => entry.split(",").map(Number));
  const pelvisOuter = facePoints("right-pelvis-triangle")[1];
  const pelvisInner = facePoints("pelvis")[2];
  const thigh = facePoints("right-upper-leg");
  assert.ok(thigh.some((point) => point[0] === pelvisOuter[0] && point[1] === pelvisOuter[1]));
  assert.ok(thigh.some((point) => point[0] === pelvisInner[0] && point[1] === pelvisInner[1]));
});

test("raised thigh swaps the leg outline pairing to use the nearby inner intersection", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-knee", 320);
  state.setJointBodyVisible("right-hip", false);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  assert.doesNotMatch(host.innerHTML, /data-bridge-joint-id="right-hip"/);
  const rightHip = state.rig.joints.find((joint) => joint.id === "right-hip")!;
  const center = getJointWorldTransform(state.rig, rightHip.id);
  const facePoints = (faceId: string) => host.innerHTML
    .match(new RegExp(`data-face-id="${faceId}" points="([^"]+)"`))![1]
    .split(" ").map((entry) => entry.split(",").map(Number));
  const pelvisOuter = facePoints("right-pelvis-triangle")[1];
  const pelvisInner = facePoints("pelvis")[2];
  const thigh = facePoints("right-upper-leg");
  assert.ok(thigh.some((point) => point[0] === pelvisOuter[0] && point[1] === pelvisOuter[1]));
  assert.ok(thigh.some((point) => point[0] === pelvisInner[0] && point[1] === pelvisInner[1]));
  for (const point of [...facePoints("pelvis"), ...thigh]) {
    assert.ok(Math.hypot(point[0] - center.x, point[1] - center.y) < 350);
  }
});

test("inward bent thigh prefers the outline intersection beyond both source endpoints", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("right-knee", 140);
  state.setJointBodyVisible("right-hip", false);
  const outerFace = state.rig.faces.find((face) => face.id === "right-pelvis-triangle")!;
  const upperLegFace = state.rig.faces.find((face) => face.id === "right-upper-leg")!;
  const originalOuter = getFacePoints(state.rig, outerFace);
  const originalLeg = getFacePoints(state.rig, upperLegFace);
  const host = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, {
    ...viewState,
    extendHiddenJointFaces: true,
  });

  const renderedOuter = host.innerHTML
    .match(/data-face-id="right-pelvis-triangle" points="([^"]+)"/)![1]
    .split(" ").map((entry) => entry.split(",").map(Number));
  const intersection = { x: renderedOuter[1][0], y: renderedOuter[1][1] };
  const scale = (start: number[], end: number[]) => {
    const x = end[0] - start[0];
    const y = end[1] - start[1];
    return ((intersection.x - start[0]) * x + (intersection.y - start[1]) * y) / (x * x + y * y);
  };
  assert.ok(scale([originalOuter[0].x, originalOuter[0].y], [originalOuter[1].x, originalOuter[1].y]) >= 1 - 1e-7);
  const matchingLegScales = [
    scale([originalLeg[1].x, originalLeg[1].y], [originalLeg[0].x, originalLeg[0].y]),
    scale([originalLeg[2].x, originalLeg[2].y], [originalLeg[3].x, originalLeg[3].y]),
  ];
  assert.ok(matchingLegScales.some((value) => value >= 1 - 1e-7));
});

