import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { getCameraFacingLimbSurface, getJointTubeSurface, getProjectedCircleConnectionSurface, projectPoint } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

test("limb tube creates circular eight-sided surfaces from joint x/y/z coordinates", () => {
  const rig = createDefaultRig();
  const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
  elbow.z = 48;
  const surface = getJointTubeSurface(rig, shoulder.id, elbow.id);

  assert.equal(surface.length, 8);
  for (const quad of surface) {
    for (const point of [quad.points[0], quad.points[1]]) {
      const distance = Math.hypot(point.x - 240, point.y - 224, point.z - shoulder.z);
      assert.ok(Math.abs(distance - shoulder.radius) < 1e-8);
    }
  }
  assert.ok(surface.some((quad) => quad.points.some((point) => point.z !== 0)));
});

test("projected circle connections follow the two common external tangents", () => {
  const start = { x: 80, y: 120 };
  const end = { x: 230, y: 210 };
  const startRadius = 24;
  const endRadius = 38;
  const points = getProjectedCircleConnectionSurface(start, end, startRadius, endRadius)!;

  for (const [startPoint, endPoint] of [[points[0], points[1]], [points[3], points[2]]] as const) {
    const edge = { x: endPoint.x - startPoint.x, y: endPoint.y - startPoint.y };
    const startNormal = { x: startPoint.x - start.x, y: startPoint.y - start.y };
    const endNormal = { x: endPoint.x - end.x, y: endPoint.y - end.y };
    assert.ok(Math.abs(Math.hypot(startNormal.x, startNormal.y) - startRadius) < 1e-8);
    assert.ok(Math.abs(Math.hypot(endNormal.x, endNormal.y) - endRadius) < 1e-8);
    assert.ok(Math.abs(startNormal.x * edge.x + startNormal.y * edge.y) < 1e-8);
    assert.ok(Math.abs(endNormal.x * edge.x + endNormal.y * edge.y) < 1e-8);
  }
});

test("equal projected radii retain the perpendicular capsule rule", () => {
  assert.deepEqual(
    getProjectedCircleConnectionSurface({ x: 0, y: 0 }, { x: 0, y: 40 }, 10, 10),
    [{ x: -10, y: 0 }, { x: -10, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 0 }],
  );
});

test("bent legs retain camera-exposed inner outlines on every limb segment", () => {
  const rig = createDefaultRig();
  const leftKnee = rig.joints.find((joint) => joint.id === "left-knee")!;
  const rightKnee = rig.joints.find((joint) => joint.id === "right-knee")!;
  const leftAnkle = rig.joints.find((joint) => joint.id === "left-ankle")!;
  const rightAnkle = rig.joints.find((joint) => joint.id === "right-ankle")!;
  leftKnee.x -= 34;
  rightKnee.x += 26;
  leftAnkle.x += 18;
  rightAnkle.x -= 12;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  for (const faceId of ["left-upper-leg", "left-lower-leg", "right-upper-leg", "right-lower-leg"]) {
    assert.match(host.innerHTML, new RegExp(`data-leg-gap-outline data-face-id="${faceId}"`));
  }
});

test("leg gap outlines obey camera depth instead of always drawing on top", () => {
  const rig = createDefaultRig();
  for (const jointId of ["left-hip", "left-knee", "left-ankle"]) {
    rig.joints.find((joint) => joint.id === jointId)!.z = -30;
  }
  for (const jointId of ["right-hip", "right-knee", "right-ankle"]) {
    rig.joints.find((joint) => joint.id === jointId)!.z = 30;
  }
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  const farGap = host.innerHTML.indexOf('data-leg-gap-outline data-face-id="left-upper-leg"');
  const nearFace = host.innerHTML.indexOf('data-face-id="right-upper-leg" points=');
  const nearGap = host.innerHTML.indexOf('data-leg-gap-outline data-face-id="right-upper-leg"');
  assert.ok(farGap >= 0 && nearFace > farGap);
  assert.ok(nearGap > nearFace);
});

test("camera-facing limb uses the apparent sphere circles instead of authored axis endpoints", () => {
  const rig = createDefaultRig();
  const surface = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!;
  const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const first = surface.points[0];
  const last = surface.points[3];

  assert.equal(first.x, last.x);
  assert.equal(first.z, last.z);
  assert.equal(Math.abs(first.y - last.y), shoulder.radius * 2);

  rig.viewYRotation = 90;
  const sideSurface = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!;
  const sideFirst = projectPoint(rig, sideSurface.points[0], sideSurface.points[0].z);
  const sideLast = projectPoint(rig, sideSurface.points[3], sideSurface.points[3].z);
  assert.ok(Math.abs(sideFirst.x - sideLast.x) > 1);
  assert.ok(Math.abs(sideFirst.y - sideLast.y) < 1e-8);
});

test("saved standard rigs migrate their limb faces to camera-facing rendering", () => {
  const rig = createDefaultRig();
  for (const face of rig.faces) delete face.cameraFacingLimb;
  new RigState(rig);
  assert.deepEqual(rig.faces.find((face) => face.id === "left-upper-arm")?.cameraFacingLimb, {
    startJointId: "left-shoulder", endJointId: "left-elbow",
  });
  assert.deepEqual(rig.faces.find((face) => face.id === "neck")?.cameraFacingLimb, {
    startJointId: "chest", endJointId: "head",
  });
});

test("neck uses the same camera-facing cylinder boundary as limbs", () => {
  const rig = createDefaultRig();
  const chest = rig.joints.find((joint) => joint.id === "chest")!;
  const head = rig.joints.find((joint) => joint.id === "head")!;
  chest.radius = 20;
  head.radius = 12;
  head.z = 36;

  const surface = getCameraFacingLimbSurface(rig, "chest", "head")!;

  assert.ok(surface);
  assert.ok(Math.abs(Math.hypot(
    surface.points[0].x - surface.points[3].x,
    surface.points[0].y - surface.points[3].y,
    surface.points[0].z - surface.points[3].z,
  ) - chest.radius * 2) < 1e-8);
  assert.ok(Math.abs(Math.hypot(
    surface.points[1].x - surface.points[2].x,
    surface.points[1].y - surface.points[2].y,
    surface.points[1].z - surface.points[2].z,
  ) - head.radius * 2) < 1e-8);
});

test("virtual peer capsule replaces the authored shoulder band with a camera-facing bridge", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "shoulder-band", selectedTarget: "face",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-peer-capsule/g)?.length, 2);
  assert.match(host.innerHTML, /data-peer-group-id="shoulder-band" data-face-id="shoulder-band"/);
  assert.match(host.innerHTML, /data-peer-group-id="hip-band"/);
  assert.equal(host.innerHTML.match(/data-face-id="shoulder-band"/g)?.length, 1);
});

test("capsule guides show actual joints and faint virtual peer capsules together", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  for (const jointId of ["waist", "left-shoulder", "right-shoulder"]) {
    assert.match(host.innerHTML, new RegExp(`data-joint-capsule-guide\\s+data-joint-id="${jointId}"`));
  }
  for (const groupId of ["shoulder-band", "hip-band"]) {
    assert.match(host.innerHTML,
      new RegExp(`data-virtual-capsule-guide[^>]*data-peer-group-id="${groupId}"`));
  }
  assert.match(host.innerHTML, /data-guide-joint-id="left-hip"/);
  assert.match(host.innerHTML, /data-guide-joint-id="right-hip"/);
});

test("capsule internals appear only for the selected actual or virtual capsule", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.doesNotMatch(host.innerHTML, /data-capsule-internal-joint/);
  assert.doesNotMatch(host.innerHTML, /class="peer-center"/);
  assert.doesNotMatch(host.innerHTML, /virtual-joint-(?:hit|outline)/);
  assert.doesNotMatch(host.innerHTML, /data-guide-joint-id="pelvis-pivot"/);

  renderSvgEditor(host, rig, { jointId: "waist", axisId: null, jointIds: ["waist"] }, viewState);
  assert.equal(host.innerHTML.match(/data-capsule-id="waist"/g)?.length, 2);

  renderSvgEditor(host, rig, {
    jointId: "left-shoulder", axisId: null, jointIds: ["left-shoulder", "right-shoulder"],
  }, viewState);
  assert.equal(host.innerHTML.match(/data-capsule-id="shoulder-band"/g)?.length, 2);
  assert.doesNotMatch(host.innerHTML, /data-capsule-id="left-shoulder"/);

  renderSvgEditor(host, rig, {
    jointId: "left-hip", axisId: null, jointIds: ["left-hip", "right-hip"],
  }, viewState);
  assert.equal(host.innerHTML.match(/data-capsule-id="hip-band"/g)?.length, 2);
});

test("torso surface connects the actual shoulder band to the rotated waist section", () => {
  const rig = createDefaultRig();
  const left = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const right = rig.joints.find((joint) => joint.id === "right-shoulder")!;
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  left.y -= 12;
  left.z = -18;
  right.y += 12;
  right.z = 18;
  waist.localRotation = 20;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso", selectedTarget: "face",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-face-id="torso" data-torso-surface/g)?.length, 1);
  assert.equal(host.innerHTML.match(/class="body-face is-selected"/g)?.length, 1);
  assert.doesNotMatch(host.innerHTML, /data-face-id="torso-strip"/);
});

test("waist-to-hip surface lofts the waist capsule into the virtual hip capsule", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  const leftHip = rig.joints.find((joint) => joint.id === "left-hip")!;
  const rightHip = rig.joints.find((joint) => joint.id === "right-hip")!;
  waist.localRotation = 12;
  waist.localRotationY = 28;
  leftHip.z = -18;
  rightHip.z = 18;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "waist-hip", selectedTarget: "face",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-face-id="waist-hip" data-waist-hip-surface/g)?.length, 1);
  assert.equal(host.innerHTML.match(/class="body-face is-selected" data-face-id="waist-hip"/g)?.length, 3);
  assert.equal(host.innerHTML.match(/data-waist-hip-tube=/g)?.length, 2);
  const waistHipOutline = host.innerHTML.match(/<path class="body-face-outline"[^>]*data-waist-hip-outline[^>]*>/)?.[0] ?? "";
  assert.equal((waistHipOutline.match(/M /g) ?? []).length, 2);
  assert.doesNotMatch(host.innerHTML, /data-face-outline data-peer-group-id="hip-band"/);
  assert.doesNotMatch(host.innerHTML, /(?:NaN|Infinity)/);
});

test("profile capsules and torso exteriors render outlines", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML, /data-joint-outline data-joint-id="waist"/);
  assert.match(host.innerHTML, /data-joint-outline data-joint-id="left-shoulder"/);
  assert.match(host.innerHTML, /data-face-outline data-face-id="torso"[^>]*mask="url\(#torso-connection-outline-mask-torso\)"/);
  assert.match(host.innerHTML, /data-face-outline data-face-id="waist-hip"[^>]*mask="url\(#torso-connection-outline-mask-waist-hip\)"/);
  assert.match(host.innerHTML, /data-face-outline data-peer-group-id="shoulder-band"[^>]*mask="url\(#torso-connection-outline-mask-shoulder-band\)"/);
});

test("torso outlines mask only sibling group surfaces", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(host.innerHTML, /data-face-id="torso" data-torso-surface/);
  assert.match(host.innerHTML, /id="torso-connection-outline-mask-torso"/);
  assert.match(host.innerHTML, /id="torso-connection-outline-mask-waist-hip"/);
});

test("group order resolves per-item layer order at equal camera distance", () => {
  const rig = createDefaultRig();
  rig.groups.find((group) => group.id === "torso")!.order = -100;
  rig.groups.find((group) => group.id === "left-arm")!.order = 100;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(host.innerHTML.indexOf('data-face-id="torso"') < host.innerHTML.indexOf('data-face-id="left-upper-arm"'));
});

test("camera distance orders overlapping items inside one group before layer order", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.joints.find((joint) => joint.id === "left-shoulder")!.z = -90;
  rig.joints.find((joint) => joint.id === "left-elbow")!.z = -60;
  rig.joints.find((joint) => joint.id === "left-wrist")!.z = 120;
  rig.faces.find((face) => face.id === "left-upper-arm")!.layerOrder = 100;
  rig.faces.find((face) => face.id === "left-lower-arm")!.layerOrder = 0;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(host.innerHTML.indexOf('data-face-id="left-upper-arm"') < host.innerHTML.indexOf('data-face-id="left-lower-arm"'));
});

test("camera distance takes precedence over group order", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.groups.find((group) => group.id === "left-arm")!.order = -100;
  rig.groups.find((group) => group.id === "right-arm")!.order = 100;
  rig.joints.find((joint) => joint.id === "left-shoulder")!.z = 120;
  rig.joints.find((joint) => joint.id === "left-elbow")!.z = 120;
  rig.joints.find((joint) => joint.id === "right-shoulder")!.z = -120;
  rig.joints.find((joint) => joint.id === "right-elbow")!.z = -120;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(host.innerHTML.indexOf('data-face-id="right-upper-arm"') < host.innerHTML.indexOf('data-face-id="left-upper-arm"'));
});

test("straight body connects equal waist and hip capsules without tapering", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /data-waist-hip-center points="270,320 330,320 330,380 270,380"/);
  assert.match(host.innerHTML,
    /data-waist-hip-tube="0" points="240,320 240,380 300,380 300,320"/);
  assert.match(host.innerHTML,
    /data-waist-hip-tube="1" points="300,320 300,380 360,380 360,320"/);
});

test("straight torso keeps equal section widths through a Y-axis turn", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.worldRotation = { x: 0, y: 45, z: 0 };
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const torsoPoints = host.innerHTML.match(/data-face-id="torso" data-torso-surface points="([^"]+)/)?.[1]
    .split(" ").map((point) => Number(point.split(",")[0]));
  assert.ok(torsoPoints);
  assert.ok(Math.abs((torsoPoints[0] - torsoPoints[1]) - (torsoPoints[3] - torsoPoints[2])) < 1e-8);
});

test("shoulder capsules use inner spheres for a straight torso and outer spheres for arm pivots", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML, /data-joint-capsule data-joint-id="left-shoulder"/);
  assert.match(host.innerHTML, /data-joint-capsule data-joint-id="right-shoulder"/);
  assert.match(host.innerHTML, /data-body-joint data-joint-capsule data-joint-id="waist"/);
  assert.match(host.innerHTML,
    /data-face-id="torso" data-torso-surface points="360,224 240,224 240,320 360,320"/);
});

test("side-view torso exposes shoulder depth instead of collapsing its top edge", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.viewYRotation = 90;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /data-face-id="torso" data-torso-surface points="330,224 270,224 270,320 330,320"/);
});

test("shoulder hierarchy guides start at the rendered outer arm pivot", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /class="hierarchy-line" x1="390" y1="224" x2="486" y2="224"\s+data-child-rotation data-joint-id="right-elbow"/);
});
