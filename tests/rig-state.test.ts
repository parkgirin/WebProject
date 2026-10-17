import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform } from "../src/rig/geometry.ts";
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
