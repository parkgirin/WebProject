import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getAxisWorldAngle, getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";

const closeTo = (actual: number, expected: number, message?: string) => {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);
};

test("the default rig satisfies all structural constraints", () => {
  assert.deepEqual(validateRig(createDefaultRig()), []);
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

