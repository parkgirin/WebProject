import assert from "node:assert/strict";
import test from "node:test";

import { applyAvatarProportionPreset, AVATAR_PROPORTION_PRESETS } from "../src/rig/avatar-presets.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const distance = (state: RigState, firstId: string, secondId: string) => {
  const first = getJointWorldTransform(state.rig, firstId);
  const second = getJointWorldTransform(state.rig, secondId);
  return Math.hypot(second.x - first.x, second.y - first.y);
};

test("all seven avatar presets apply their app dimensions to a valid rig", () => {
  assert.equal(AVATAR_PROPORTION_PRESETS.length, 7);
  assert.equal(new Set(AVATAR_PROPORTION_PRESETS.map((preset) => preset.id)).size, 7);
  for (const preset of AVATAR_PROPORTION_PRESETS) {
    const state = new RigState(createDefaultRig());
    applyAvatarProportionPreset(state, preset.id);
    close(state.getPeerGroupDistance("shoulder-band")!, preset.shoulderDistance);
    close(state.getPeerGroupDistance("hip-band")!, preset.hipDistance);
    close(state.getJoint("waist").radius, preset.waistRadius);
    close(state.getJoint("left-shoulder").radius, preset.armRadius);
    close(state.getJoint("left-hip").radius, preset.hipRadius);
    close(state.getJoint("left-knee").radius, preset.kneeRadius);
    close(getJointWorldTransform(state.rig, "scene-root").y, preset.rootY);
    close(distance(state, "waist", "chest"), preset.chestDistance);
    close(distance(state, "chest", "head"), preset.headDistance);
    close(distance(state, "left-shoulder", "left-elbow"), preset.armSegmentLength);
    close(distance(state, "left-hip", "left-knee"), preset.upperLegLength);
    close(distance(state, "left-knee", "left-ankle"), preset.lowerLegLength);
    close(state.getJoint("head").bodyRadius!, 60);
    const leftShoulder = getJointWorldTransform(state.rig, "left-shoulder");
    const leftElbow = getJointWorldTransform(state.rig, "left-elbow");
    const leftWrist = getJointWorldTransform(state.rig, "left-wrist");
    const rightShoulder = getJointWorldTransform(state.rig, "right-shoulder");
    const rightElbow = getJointWorldTransform(state.rig, "right-elbow");
    const rightWrist = getJointWorldTransform(state.rig, "right-wrist");
    close(leftShoulder.y, leftElbow.y); close(leftElbow.y, leftWrist.y);
    close(rightShoulder.y, rightElbow.y); close(rightElbow.y, rightWrist.y);
    assert.ok(leftWrist.x < leftElbow.x && leftElbow.x < leftShoulder.x);
    assert.ok(rightShoulder.x < rightElbow.x && rightElbow.x < rightWrist.x);
    assert.deepEqual(validateRig(state.rig), []);
  }
});

test("avatar preset preserves pose, colors, and peer pivot offset and undoes as one operation", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("left-elbow", 35);
  state.setFaceColor("torso", "#123456");
  state.setPeerCenterOffset("hip-band", 9, -6);
  const before = structuredClone(state.rig);
  const shoulder = getJointWorldTransform(state.rig, "left-shoulder");
  const elbow = getJointWorldTransform(state.rig, "left-elbow");
  const beforeAngle = Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x);

  applyAvatarProportionPreset(state, "child-neutral");

  const nextShoulder = getJointWorldTransform(state.rig, "left-shoulder");
  const nextElbow = getJointWorldTransform(state.rig, "left-elbow");
  close(Math.atan2(nextElbow.y - nextShoulder.y, nextElbow.x - nextShoulder.x), beforeAngle);
  close(Math.hypot(nextElbow.x - nextShoulder.x, nextElbow.y - nextShoulder.y), 69);
  assert.equal(state.getFace("torso").color, "#123456");
  close(state.getPeerCenterOffset("hip-band")!.x, 9);
  close(state.getPeerCenterOffset("hip-band")!.y, -6);

  state.undo();
  assert.deepEqual(state.rig, before);
});

test("trapezoid female keeps a larger hip joint than its knee", () => {
  const state = new RigState(createDefaultRig());
  applyAvatarProportionPreset(state, "female-trapezoid");
  close(state.getJoint("left-hip").radius, 38.4);
  close(state.getJoint("left-knee").radius, 27);
  close(state.getPeerGroupDistance("hip-band")!, 79.2);
});

test("standard and slim male share shoulder width while the slim waist remains narrower", () => {
  const standard = AVATAR_PROPORTION_PRESETS.find((preset) => preset.id === "male-standard")!;
  const slim = AVATAR_PROPORTION_PRESETS.find((preset) => preset.id === "male-slim")!;
  assert.equal(slim.shoulderDistance, standard.shoulderDistance);
  assert.ok(slim.waistRadius < standard.waistRadius);
  assert.equal(slim.waistRadius, 39);
});

test("straight neutral aligns shoulder centers with both waist edges", () => {
  const preset = AVATAR_PROPORTION_PRESETS.find((candidate) => candidate.id === "neutral-straight")!;
  assert.equal(preset.shoulderDistance, preset.waistRadius * 2);
  assert.equal(preset.shoulderDistance, 120);
  assert.equal(preset.waistRadius, 60);
});
