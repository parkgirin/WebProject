import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyLimbSpreadPose, applyTPose, applyUserPosePreset, createUserPosePreset, parseUserPosePresets } from "../src/presets/pose-presets.ts";
import { applyAvatarProportionPreset } from "../src/presets/avatar-presets.ts";
import { getJointParentWorldTransform } from "../src/rig/geometry.ts";

test("a user pose preset restores pose without replacing radii, colors, or shapes", () => {
  const source = new RigState(createDefaultRig());
  source.moveJoint("right-wrist", 520, 260);
  source.setGlobalRotation(18);
  const entry = createUserPosePreset("user-pose-1", "공격 자세", source.rig);

  const target = new RigState(createDefaultRig());
  target.setJointRadius("right-wrist", 27);
  target.paintJointWithColor("right-wrist", "#123456");
  const colorPaletteId = target.getJoint("right-wrist").paletteId;
  const shapeIds = target.rig.artShapes!.map((shape) => shape.id);
  const beforePose = { ...target.getJoint("right-wrist") };
  const savedWrist = source.getJoint("right-wrist");
  const savedLength = Math.hypot(savedWrist.x, savedWrist.y);
  applyUserPosePreset(target, entry);

  const appliedWrist = target.getJoint("right-wrist");
  assert.ok(Math.abs(Math.hypot(appliedWrist.x, appliedWrist.y) - savedLength) < 1e-6);
  assert.ok(Math.abs(appliedWrist.x / savedLength - savedWrist.x / savedLength) < 1e-6);
  assert.ok(Math.abs(appliedWrist.y / savedLength - savedWrist.y / savedLength) < 1e-6);
  assert.equal(target.getGlobalRotation(), source.getGlobalRotation());
  assert.equal(target.getJoint("right-wrist").radius, 27);
  assert.equal(target.getJoint("right-wrist").paletteId, colorPaletteId);
  assert.equal(target.rig.palette.find((entry) => entry.id === colorPaletteId)?.color, "#123456");
  assert.deepEqual(target.rig.artShapes!.map((shape) => shape.id), shapeIds);
  target.undo();
  assert.equal(target.getJoint("right-wrist").x, beforePose.x);
  assert.equal(target.getJoint("right-wrist").y, beforePose.y);
});

test("a pose preset changes limb directions without replacing body-specific joint distances", () => {
  const source = new RigState(createDefaultRig());
  const leftPivot = getJointParentWorldTransform(source.rig, "left-elbow")!;
  const rightPivot = getJointParentWorldTransform(source.rig, "right-elbow")!;
  source.moveJoint("left-elbow", leftPivot.x, leftPivot.y + 96);
  source.moveJoint("right-elbow", rightPivot.x, rightPivot.y + 96);
  source.moveJoint("left-wrist", leftPivot.x, leftPivot.y + 192);
  source.moveJoint("right-wrist", rightPivot.x, rightPivot.y + 192);
  const entry = createUserPosePreset("arms-down", "팔 수직 내리기", source.rig);

  const child = new RigState(createDefaultRig());
  child.setJointDistance("left-elbow", "left-shoulder", 69);
  child.setJointDistance("right-elbow", "right-shoulder", 69);
  child.setJointDistance("left-wrist", "left-elbow", 69);
  child.setJointDistance("right-wrist", "right-elbow", 69);
  const rootBefore = { x: child.getJoint("scene-root").x, y: child.getJoint("scene-root").y };

  applyUserPosePreset(child, entry);

  for (const side of ["left", "right"] as const) {
    const elbow = child.getJoint(`${side}-elbow`);
    const wrist = child.getJoint(`${side}-wrist`);
    assert.ok(Math.abs(elbow.x) < 1e-6);
    assert.ok(Math.abs(elbow.y - 69) < 1e-6);
    assert.ok(Math.abs(wrist.x) < 1e-6);
    assert.ok(Math.abs(wrist.y - 69) < 1e-6);
  }
  assert.deepEqual({ x: child.getJoint("scene-root").x, y: child.getJoint("scene-root").y }, rootBefore);
});

test("user pose preset lists validate names, ids, and embedded pose data", () => {
  const entry = createUserPosePreset("user-pose-1", "  대기  ", createDefaultRig());
  const parsed = parseUserPosePresets(JSON.parse(JSON.stringify([entry])));
  assert.equal(parsed[0].name, "대기");
  assert.throws(() => parseUserPosePresets([{ ...entry, id: "" }]), /올바르지 않습니다/);
  assert.throws(() => parseUserPosePresets([{ ...entry, preset: { ...entry.preset, pose: undefined } }]), /포즈 정보/);
});

test("the built-in T pose keeps current limb lengths and aligns the body to the front", () => {
  const state = new RigState(createDefaultRig());
  state.setJointDistance("right-elbow", "right-shoulder", 128);
  state.rotateChildAroundParent("right-elbow", 55);
  state.setViewYRotation(35);
  const length = Math.hypot(state.getJoint("right-elbow").x, state.getJoint("right-elbow").y);

  applyTPose(state);
  const elbow = state.getJoint("right-elbow");
  assert.ok(Math.abs(Math.hypot(elbow.x, elbow.y) - length) < 1e-6);
  assert.ok(elbow.x > 0);
  assert.ok(Math.abs(elbow.y) < 1e-6);
  assert.equal(state.rig.viewYRotation, 0);
  assert.equal(elbow.z, 0);
  state.undo();
  assert.equal(state.rig.viewYRotation, 35);
});

test("the limb spread pose rotates only shoulder and hip roots by 30 degrees", () => {
  const state = new RigState(createDefaultRig());
  state.setJointDistance("right-elbow", "right-shoulder", 128);

  applyLimbSpreadPose(state);

  const elbow = state.getJoint("right-elbow");
  const knee = state.getJoint("right-knee");
  assert.ok(Math.abs(Math.hypot(elbow.x, elbow.y) - 128) < 1e-6);
  assert.equal(elbow.x, 128);
  assert.equal(elbow.y, 0);
  assert.equal(knee.x, 0);
  assert.ok(knee.y > 0);
  assert.equal(state.getJoint("left-shoulder").localRotation, 330);
  assert.equal(state.getJoint("right-shoulder").localRotation, 30);
  assert.equal(state.getJoint("left-hip").localRotation, 30);
  assert.equal(state.getJoint("right-hip").localRotation, 330);
  for (const jointId of ["left-elbow", "right-elbow", "left-wrist", "right-wrist", "left-knee", "right-knee", "left-ankle", "right-ankle"]) {
    assert.equal(state.getJoint(jointId).localRotation, 0);
  }
  assert.equal(state.rig.viewYRotation, 0);
});

test("the built-in T pose preserves the active body type's shoulder and hip widths", () => {
  const state = new RigState(createDefaultRig());
  applyAvatarProportionPreset(state, "child-neutral");
  const shoulderWidth = state.getPeerGroupDistance("shoulder-band");
  const hipWidth = state.getPeerGroupDistance("hip-band");

  applyTPose(state);

  assert.equal(state.getPeerGroupDistance("shoulder-band"), shoulderWidth);
  assert.equal(state.getPeerGroupDistance("hip-band"), hipWidth);
});
