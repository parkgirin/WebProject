import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getAxisPoint, getAxisWorldAngle, getCircleTangentPoints, getJointViewRadius, getJointWorldTransform, getPeerGroupCentroid, getProjectionScale, projectPoint, unprojectPoint } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";

const closeTo = (actual: number, expected: number, message?: string) => {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);
};

test("the default rig satisfies all structural constraints", () => {
  assert.deepEqual(validateRig(createDefaultRig()), []);
});

test("depth projection scales around the canvas centre and remains invertible", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 50;
  assert.equal(getProjectionScale(rig, 40), 1.2);
  const projected = projectPoint(rig, { x: 400, y: 500 }, 40);
  closeTo(projected.x, 420);
  closeTo(projected.y, 522);
  assert.deepEqual(unprojectPoint(rig, projected, 40), { x: 400, y: 500 });
});

test("Y-axis view rotation interpolates X into depth and remains invertible", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 0;
  rig.viewYRotation = 60;
  const projected = projectPoint(rig, { x: 400, y: 500 }, 0);
  closeTo(projected.x, 350);
  closeTo(projected.y, 500);
  const restored = unprojectPoint(rig, projected, 0);
  closeTo(restored.x, 400);
  closeTo(restored.y, 500);
});

test("side view uses pure X/Z rotation without silhouette retention", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 0;
  rig.viewYRotation = 90;
  const left = projectPoint(rig, { x: 200, y: 390 }, 0);
  const right = projectPoint(rig, { x: 400, y: 390 }, 0);
  closeTo(right.x - left.x, 0);
});

test("side radius interpolates from front to side without mutating the base rig", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  waist.sideRadius = 24;
  rig.viewYRotation = 45;
  assert.equal(waist.radius, 48);
  assert.equal(getJointViewRadius(rig, waist), 36);
  rig.viewYRotation = 90;
  assert.equal(getJointViewRadius(rig, waist), 24);
});

test("joint depth and projection strength are bounded and undoable", () => {
  const state = new RigState(createDefaultRig());
  state.setJointDepth("head", 200);
  state.setProjectionStrength(-1);
  state.setViewYRotation(120);
  assert.equal(state.getJoint("head").depth, 100);
  assert.equal(state.rig.projectionStrength, 0);
  assert.equal(state.rig.viewYRotation, 90);
  state.undo();
  assert.equal(state.rig.viewYRotation, 0);
});

test("validation reports broken references, duplicate axes, and parent cycles", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  const chest = rig.joints.find((joint) => joint.id === "chest")!;
  waist.parentJointId = "chest";
  chest.parentJointId = "waist";
  waist.axes.push({ ...waist.axes[0], pointSides: [...waist.axes[0].pointSides] });
  rig.faces[0].vertices[0].axisId = "missing-axis";

  const errors = validateRig(rig);

  assert.ok(errors.some((error) => error.startsWith("Parent cycle:")));
  assert.ok(errors.some((error) => error === "Duplicate axis id: waist.upper-torso"));
  assert.ok(errors.some((error) => error.includes("references unknown axis")));
});

test("rotating a child connection moves its descendant subtree and leaves the opposite limb unchanged", () => {
  const state = new RigState(createDefaultRig());
  const shoulder = getJointWorldTransform(state.rig, "left-shoulder");
  const elbowBefore = getJointWorldTransform(state.rig, "left-elbow");
  const wristBefore = getJointWorldTransform(state.rig, "left-wrist");
  const rightElbowBefore = getJointWorldTransform(state.rig, "right-elbow");
  const upperArmLength = Math.hypot(elbowBefore.x - shoulder.x, elbowBefore.y - shoulder.y);
  const lowerArmLength = Math.hypot(wristBefore.x - elbowBefore.x, wristBefore.y - elbowBefore.y);

  state.rotateChildAroundParent("left-elbow", 0);

  const elbowAfter = getJointWorldTransform(state.rig, "left-elbow");
  const wristAfter = getJointWorldTransform(state.rig, "left-wrist");
  const rightElbowAfter = getJointWorldTransform(state.rig, "right-elbow");
  closeTo(elbowAfter.x, shoulder.x + upperArmLength);
  closeTo(elbowAfter.y, shoulder.y);
  closeTo(Math.hypot(wristAfter.x - elbowAfter.x, wristAfter.y - elbowAfter.y), lowerArmLength);
  closeTo(wristAfter.x, elbowAfter.x + lowerArmLength);
  closeTo(wristAfter.y, elbowAfter.y);
  assert.deepEqual(rightElbowAfter, rightElbowBefore);
});

test("independent joint movement keeps direct children at their current world positions", () => {
  const state = new RigState(createDefaultRig());
  const waist = getJointWorldTransform(state.rig, "waist");
  const chest = getJointWorldTransform(state.rig, "chest");
  const head = getJointWorldTransform(state.rig, "head");

  state.moveJointIndependently("waist", waist.x + 30, waist.y + 20);

  const movedWaist = getJointWorldTransform(state.rig, "waist");
  const chestAfter = getJointWorldTransform(state.rig, "chest");
  const headAfter = getJointWorldTransform(state.rig, "head");
  closeTo(movedWaist.x, waist.x + 30);
  closeTo(movedWaist.y, waist.y + 20);
  closeTo(chestAfter.x, chest.x);
  closeTo(chestAfter.y, chest.y);
  closeTo(headAfter.x, head.x);
  closeTo(headAfter.y, head.y);
});

test("changing a parent preserves world pose and rejects cyclic parenting", () => {
  const state = new RigState(createDefaultRig());
  const before = getJointWorldTransform(state.rig, "left-wrist");

  state.setParentJoint("left-wrist", "waist");

  const after = getJointWorldTransform(state.rig, "left-wrist");
  closeTo(after.x, before.x);
  closeTo(after.y, before.y);
  closeTo(after.rotation, before.rotation);
  assert.throws(() => state.setParentJoint("waist", "left-wrist"), /descendant/i);
});

test("history restores an edited radius", () => {
  const state = new RigState(createDefaultRig());
  const original = state.getJoint("head").radius;

  state.setJointRadius("head", original + 10);
  assert.equal(state.getJoint("head").radius, original + 10);
  state.undo();
  assert.equal(state.getJoint("head").radius, original);
  state.redo();
  assert.equal(state.getJoint("head").radius, original + 10);
});

test("constrained multi-selection applies the same angle to each connection, including descendants", () => {
  const state = new RigState(createDefaultRig());
  const ids = ["left-wrist", "right-elbow", "left-elbow"];
  const before = new Map(ids.map((id) => {
    const joint = state.getJoint(id);
    const parent = getJointWorldTransform(state.rig, joint.parentJointId!);
    const world = getJointWorldTransform(state.rig, id);
    return [id, { dx: world.x - parent.x, dy: world.y - parent.y }];
  }));
  const original = structuredClone(state.rig);
  state.beginHistoryTransaction();
  state.moveJointsConstrainedBy(ids, 90, 0, 0);
  state.endHistoryTransaction();
  for (const id of ids) {
    const parent = getJointWorldTransform(state.rig, state.getJoint(id).parentJointId!);
    const world = getJointWorldTransform(state.rig, id);
    const vector = before.get(id)!;
    closeTo(world.x - parent.x, -vector.dy, id);
    closeTo(world.y - parent.y, vector.dx, id);
  }
  state.undo();
  assert.deepEqual(state.rig, original);
  state.redo();
  const elbow = getJointWorldTransform(state.rig, "left-elbow");
  const shoulder = getJointWorldTransform(state.rig, "left-shoulder");
  closeTo(elbow.x - shoulder.x, -before.get("left-elbow")!.dy);
});

test("constrained multi-selection moves a selected root once and preserves child distance", () => {
  const state = new RigState(createDefaultRig());
  const root = state.rig.joints.find((joint) => !joint.parentJointId)!;
  const child = state.rig.joints.find((joint) => joint.parentJointId === root.id)!;
  const rootBefore = getJointWorldTransform(state.rig, root.id);
  const childBefore = getJointWorldTransform(state.rig, child.id);
  state.moveJointsConstrainedBy([child.id, root.id, root.id], 45, 12, -8);
  const rootAfter = getJointWorldTransform(state.rig, root.id);
  const childAfter = getJointWorldTransform(state.rig, child.id);
  closeTo(rootAfter.x, rootBefore.x + 12);
  closeTo(rootAfter.y, rootBefore.y - 8);
  closeTo(Math.hypot(childAfter.x - rootAfter.x, childAfter.y - rootAfter.y),
    Math.hypot(childBefore.x - rootBefore.x, childBefore.y - rootBefore.y));
});

function assertShoulderBandPerpendicular(state: RigState) {
  const left = getJointWorldTransform(state.rig, "left-shoulder");
  const right = getJointWorldTransform(state.rig, "right-shoulder");
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  for (const id of ["left-shoulder", "right-shoulder"]) {
    const joint = state.getJoint(id);
    const axis = joint.axes.find((candidate) => candidate.id === "torso")!;
    const radians = getAxisWorldAngle(state.rig, joint, axis) * Math.PI / 180;
    closeTo(dx * Math.cos(radians) + dy * Math.sin(radians), 0, id);
  }
}

test("shoulder-band axes remain perpendicular after joint and multi-selection movement", () => {
  const state = new RigState(createDefaultRig());
  state.moveJoint("left-shoulder", 200, 170);
  assertShoulderBandPerpendicular(state);
  state.beginHistoryTransaction();
  state.moveJointsConstrainedBy(["left-shoulder", "right-shoulder", "left-elbow"], 35, 0, 0);
  state.endHistoryTransaction();
  assertShoulderBandPerpendicular(state);
  state.undo();
  assertShoulderBandPerpendicular(state);
  state.redo();
  assertShoulderBandPerpendicular(state);
  state.rotateJointsAround(["chest"], 300, 320, 25);
  assertShoulderBandPerpendicular(state);
});

test("rotating a shoulder-band axis rotates its peer group and keeps both axes perpendicular", () => {
  const state = new RigState(createDefaultRig());
  const initialAngle = state.getFaceRotationAngle("shoulder-band")!;
  const joint = state.getJoint("left-shoulder");
  const axis = joint.axes.find((candidate) => candidate.id === "torso")!;
  state.setAxisAngle(joint.id, axis.id, getAxisWorldAngle(state.rig, joint, axis) + 30);
  closeTo(state.getFaceRotationAngle("shoulder-band")!, (initialAngle + 30) % 360);
  assertShoulderBandPerpendicular(state);
});

test("hip pelvis vertical axes are editable while outer axes track exact tangents", () => {
  const state = new RigState(createDefaultRig());
  const pelvis = state.getFace("pelvis");
  assert.equal(pelvis.vertices.length, 4);
  assert.equal(state.getFace("left-pelvis-triangle").vertices.length, 3);
  assert.equal(state.getFace("right-pelvis-triangle").vertices.length, 3);

  const assertHipAxes = () => {
    const peerCenter = getPeerGroupCentroid(state.rig, "hip-band");
    const waistJoint = state.getJoint("waist");
    const waistAxis = waistJoint.axes.find((axis) => axis.id === "pelvis")!;
    const hips = [
      { id: "left-hip", referenceSide: -1 as const, outerSide: -1 as const },
      { id: "right-hip", referenceSide: 1 as const, outerSide: 1 as const },
    ];
    for (const { id, referenceSide, outerSide } of hips) {
      const joint = state.getJoint(id);
      const center = getJointWorldTransform(state.rig, id);
      const outerAxis = joint.axes.find((axis) => axis.id === "pelvis-horizontal")!;
      const reference = getAxisPoint(state.rig, waistJoint, waistAxis, referenceSide);
      const outer = getAxisPoint(state.rig, joint, outerAxis, outerSide);
      const tangentPoints = getCircleTangentPoints(reference, center, joint.radius)!;
      closeTo(
        (outer.x - center.x) * (outer.x - reference.x) + (outer.y - center.y) * (outer.y - reference.y),
        0,
        `${id} outer boundary is not tangent`,
      );
      const distanceToPeer = (point: { x: number; y: number }) => Math.hypot(point.x - peerCenter.x, point.y - peerCenter.y);
      closeTo(distanceToPeer(outer), Math.max(...tangentPoints.map(distanceToPeer)), `${id} did not select the outer tangent`);
    }
  };

  assertHipAxes();
  const fixedAxis = state.getJoint("left-hip").axes.find((axis) => axis.id === "pelvis-vertical")!;
  const fixedAngle = fixedAxis.angle;
  assert.equal(fixedAxis.alignment, undefined);
  state.setAxisAngle("left-hip", "pelvis-vertical", fixedAngle + 20);
  closeTo(fixedAxis.angle, fixedAngle + 20, "ordinary hip axis should be directly editable");
  const outerAxis = state.getJoint("left-hip").axes.find((axis) => axis.id === "pelvis-horizontal")!;
  const outerAngle = outerAxis.angle;
  state.setAxisAngle("left-hip", "pelvis-horizontal", outerAngle + 20);
  closeTo(outerAxis.angle, outerAngle, "derived tangent axis should not be directly editable");
  state.setPeerGroupDistance("hip-band", 110);
  state.setJointRadius("left-hip", 35);
  state.setJointRadius("right-hip", 35);
  assertHipAxes();

  const beforeOffsetAngles = ["left-hip", "right-hip"].flatMap((id) => {
    const joint = state.getJoint(id);
    return ["pelvis-vertical", "pelvis-horizontal"].map((axisId) => (
      getAxisWorldAngle(state.rig, joint, joint.axes.find((axis) => axis.id === axisId)!)
    ));
  });
  state.setPeerCenterOffset("hip-band", 18, -12);
  assertHipAxes();
  ["left-hip", "right-hip"].flatMap((id) => {
    const joint = state.getJoint(id);
    return ["pelvis-vertical", "pelvis-horizontal"].map((axisId) => (
      getAxisWorldAngle(state.rig, joint, joint.axes.find((axis) => axis.id === axisId)!)
    ));
  }).forEach((angle, index) => {
    closeTo(angle, beforeOffsetAngles[index], "virtual pivot offset changed a structural axis");
  });
  state.rotatePeerGroup("hip-band", state.getFaceRotationAngle("pelvis")! + 35);
  assertHipAxes();
});

