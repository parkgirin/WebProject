import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { getCameraFacingLimbSurface, getJointTubeSurface, projectPoint } from "../src/rig/geometry.ts";
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
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-peer-capsule/g)?.length, 2);
  assert.match(host.innerHTML, /data-peer-group-id="shoulder-band" data-face-id="shoulder-band"/);
  assert.match(host.innerHTML, /data-peer-group-id="hip-band"/);
  assert.equal(host.innerHTML.match(/data-face-id="shoulder-band"/g)?.length, 1);
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
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
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
  waist.localRotation = 12;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "waist-hip", selectedTarget: "face",
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-face-id="waist-hip" data-waist-hip-surface/g)?.length, 1);
  assert.equal(host.innerHTML.match(/class="body-face is-selected" data-face-id="waist-hip"/g)?.length, 1);
});

test("straight body connects equal waist and hip capsules without tapering", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /data-face-id="waist-hip" data-waist-hip-surface points="360,320 240,320 240,380 360,380"/);
});

test("shoulder capsules use inner spheres for a straight torso and outer spheres for arm pivots", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
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
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
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
    inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /class="hierarchy-line" x1="390" y1="224" x2="486" y2="224"\s+data-child-rotation data-joint-id="right-elbow"/);
});
