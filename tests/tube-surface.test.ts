import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
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
});
