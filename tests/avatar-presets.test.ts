import assert from "node:assert/strict";
import test from "node:test";

import { applyAvatarProportionPreset, AVATAR_PROPORTION_PRESETS, DEFAULT_AVATAR_PRESET_ID, getAvatarProportionPreset } from "../src/presets/avatar-presets.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointParentWorldTransform, getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const distance = (state: RigState, firstId: string, secondId: string) => {
  const first = getJointWorldTransform(state.rig, firstId);
  const second = getJointWorldTransform(state.rig, secondId);
  return Math.hypot(second.x - first.x, second.y - first.y);
};
const connectionAngle = (state: RigState, childId: string) => {
  const parent = getJointParentWorldTransform(state.rig, childId)!;
  const child = getJointWorldTransform(state.rig, childId);
  return Math.atan2(child.y - parent.y, child.x - parent.x);
};

test("all seven avatar presets apply their app dimensions to a valid rig", () => {
  assert.equal(AVATAR_PROPORTION_PRESETS.length, 7);
  assert.equal(new Set(AVATAR_PROPORTION_PRESETS.map((preset) => preset.id)).size, 7);
  for (const preset of AVATAR_PROPORTION_PRESETS) {
    const state = new RigState(createDefaultRig());
    applyAvatarProportionPreset(state, preset.id);
    close(state.getPeerGroupDistance("shoulder-band")!, preset.shoulderDistance);
    close(state.getPeerGroupDistance("hip-band")!, preset.hipDistance);
    const waist = state.getJoint("waist");
    close(waist.radius, preset.armRadius);
    close(waist.radius + (waist.capsuleFlatLengths?.x ?? 0) / 2, preset.waistRadius);
    const leftShoulderJoint = state.getJoint("left-shoulder");
    close(leftShoulderJoint.radius, preset.armRadius);
    close(leftShoulderJoint.capsuleFlatLengths?.x ?? 0, preset.shoulderFlatLength);
    assert.equal(leftShoulderJoint.capsuleFlatAlignment, "peer-outward");
    close(state.getJoint("left-hip").radius, preset.hipRadius);
    close(state.getJoint("left-knee").radius, preset.kneeRadius);
    close(state.getJoint("left-wrist").radius, preset.wristRadius);
    close(state.getJoint("left-ankle").radius, preset.ankleRadius);
    close(state.getJoint("chest").z, preset.depthProfile.chest);
    close(state.getJoint("waist").z, preset.depthProfile.waist);
    close(state.getJoint("pelvis-pivot").z, preset.depthProfile.pelvis);
    close(state.getJoint("left-hip").z, preset.depthProfile.hip);
    close(state.getJoint("left-knee").z, preset.depthProfile.knee);
    close(state.getJoint("left-ankle").z, preset.depthProfile.ankle);
    close(getJointWorldTransform(state.rig, "scene-root").y, preset.rootY);
    close(distance(state, "waist", "chest"), preset.chestDistance);
    close(distance(state, "chest", "head"), preset.headDistance);
    close(Math.hypot(state.getJoint("left-elbow").x, state.getJoint("left-elbow").y), preset.armSegmentLength);
    close(distance(state, "left-hip", "left-knee"), preset.upperLegLength);
    close(distance(state, "left-knee", "left-ankle"), preset.lowerLegLength);
    const headShape = state.rig.artShapes?.find((shape) => shape.id === "head-base");
    assert.equal(headShape?.kind, "sphere");
    close(headShape?.radius ?? 0, 60);
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

test("avatar preset preserves pose and colors and undoes as one operation", () => {
  const state = new RigState(createDefaultRig());
  state.rotateChildAroundParent("left-elbow", 35);
  state.setFaceColor("torso", "#123456");
  const before = structuredClone(state.rig);
  const beforeAngle = connectionAngle(state, "left-elbow");

  applyAvatarProportionPreset(state, "child-neutral");

  close(connectionAngle(state, "left-elbow"), beforeAngle);
  close(Math.hypot(state.getJoint("left-elbow").x, state.getJoint("left-elbow").y), 69);
  assert.equal(state.getFace("torso").color, "#123456");

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
  assert.equal(preset.armRadius, preset.hipRadius);
  assert.equal(preset.hipRadius, preset.kneeRadius);
  assert.equal(preset.wristRadius, preset.armRadius);
  assert.equal(preset.ankleRadius, preset.kneeRadius);
  assert.equal(preset.shoulderFlatLength, preset.armRadius);
  assert.deepEqual(preset.depthProfile, { chest: 0, waist: 0, pelvis: 0, hip: 0, knee: 0, ankle: 0 });
});

test("non-straight presets taper the leg and place its knee ahead of the hip", () => {
  for (const preset of AVATAR_PROPORTION_PRESETS) {
    if (preset.id === "neutral-straight") continue;
    assert.ok(preset.kneeRadius < preset.hipRadius, `${preset.id} should taper below the hip`);
    assert.ok(preset.depthProfile.knee > preset.depthProfile.hip, `${preset.id} knee should move forward from the hip`);
    assert.ok(preset.depthProfile.ankle >= preset.depthProfile.hip, `${preset.id} ankle should not remain behind the hip`);
    assert.ok(preset.depthProfile.ankle > preset.depthProfile.knee, `${preset.id} ankle should return behind the knee`);
    assert.ok(preset.wristRadius > preset.armRadius, `${preset.id} wrist should represent a hand`);
    assert.ok(preset.ankleRadius > preset.kneeRadius, `${preset.id} ankle should represent a foot`);
  }
});

test("non-straight presets use compact rounded shoulder capsules", () => {
  for (const preset of AVATAR_PROPORTION_PRESETS) {
    if (preset.id === "neutral-straight") continue;
    close(preset.shoulderFlatLength, preset.armRadius * 0.5);
  }
});

test("new rigs are constructed directly with the straight neutral preset", () => {
  assert.equal(DEFAULT_AVATAR_PRESET_ID, "neutral-straight");
  const preset = getAvatarProportionPreset(DEFAULT_AVATAR_PRESET_ID)!;
  const state = new RigState(createDefaultRig());
  close(state.getPeerGroupDistance("shoulder-band")!, preset.shoulderDistance);
  close(state.getPeerGroupDistance("hip-band")!, preset.hipDistance);
  const waist = state.getJoint("waist");
  close(waist.radius, preset.armRadius);
  close(waist.radius + (waist.capsuleFlatLengths?.x ?? 0) / 2, preset.waistRadius);
  const shoulder = state.getJoint("left-shoulder");
  close(shoulder.radius, preset.armRadius);
  close(shoulder.capsuleFlatLengths?.x ?? 0, preset.armRadius);
  assert.equal(shoulder.capsuleFlatAlignment, "peer-outward");
  close(state.getJoint("left-hip").radius, preset.hipRadius);
  close(getJointWorldTransform(state.rig, "scene-root").y, preset.rootY);
  close(distance(state, "waist", "chest"), preset.chestDistance);
  close(distance(state, "chest", "head"), preset.headDistance);
  assert.equal(state.canUndo, false);
});
