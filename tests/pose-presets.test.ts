import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyArmsDownPose, applyBodyRestPose, applyLimbSpreadPose, applyUserPosePreset, createUserPosePreset, parseUserPosePresets } from "../src/presets/pose-presets.ts";
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

test("the arms-down pose starts from the active body's rest pose instead of the current pose", () => {
  const state = new RigState(createDefaultRig());
  for (const side of ["left", "right"] as const) {
    const sign = side === "left" ? -1 : 1;
    Object.assign(state.getJoint(`${side}-elbow`), { x: sign * 72, y: 36, z: 8 });
    Object.assign(state.getJoint(`${side}-wrist`), { x: sign * 54, y: 42, z: 13 });
  }
  state.rebaseCurrentPoseAsBodyRest();
  const restChest = { ...state.getJoint("chest").baseOffset! };
  const restArms = Object.fromEntries(["left-elbow", "right-elbow", "left-wrist", "right-wrist"].map((id) => [id,
    { ...state.getJoint(id).baseOffset! }]));
  state.setViewYRotation(35);
  state.setJointAxisRotation("chest", "z", 20);
  state.setJointAxisRotation("left-elbow", "y", 55);
  state.setJointDistancePercent("right-wrist", 140);

  applyArmsDownPose(state);

  assert.deepEqual(state.getJoint("chest").baseOffset, restChest);
  assert.equal(state.getJoint("chest").localRotation, 0);
  for (const id of ["left-elbow", "right-elbow", "left-wrist", "right-wrist"]) {
    const joint = state.getJoint(id);
    const rest = restArms[id];
    const parent = state.getJoint(joint.parentJointId!);
    assert.ok(Math.abs(joint.x) < 1e-7, `${id}.x`);
    assert.ok(Math.abs(joint.y - Math.hypot(rest.x, rest.y)) < 1e-7, `${id}.y`);
    assert.ok(Math.abs(joint.z - parent.z - rest.z) < 1e-7, `${id}.z`);
    assert.equal(joint.distancePercent, 100);
  }
  assert.equal(state.rig.viewYRotation, 35);
  state.undo();
  assert.equal(state.getJoint("chest").localRotation, 20);
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

test("the body rest pose restores the active body's XYZ offsets without changing presentation", () => {
  const state = new RigState(createDefaultRig());
  applyAvatarProportionPreset(state, "child-neutral");
  const rootBefore = { ...state.getJoint("scene-root") };
  const radiusBefore = state.getJoint("left-knee").radius;
  state.setViewYRotation(35);
  state.setGlobalAxisRotation("y", 70);
  state.setJointAxisRotation("left-knee", "x", 42);
  const posedKnee = { ...state.getJoint("left-knee") };

  applyBodyRestPose(state);

  for (const joint of state.rig.joints) {
    assert.equal(joint.localRotation, 0, `${joint.id}.rz`);
    assert.equal(joint.localRotationX ?? 0, 0, `${joint.id}.rx`);
    assert.equal(joint.localRotationY ?? 0, 0, `${joint.id}.ry`);
    if (!joint.parentJointId) continue;
    const parent = state.getJoint(joint.parentJointId);
    assert.ok(Math.abs(joint.x - joint.baseOffset!.x) < 1e-7, `${joint.id}.x`);
    assert.ok(Math.abs(joint.y - joint.baseOffset!.y) < 1e-7, `${joint.id}.y`);
    assert.ok(Math.abs(joint.z - parent.z - joint.baseOffset!.z) < 1e-7, `${joint.id}.z`);
  }
  assert.equal(state.getJoint("scene-root").x, rootBefore.x);
  assert.equal(state.getJoint("scene-root").y, rootBefore.y);
  assert.equal(state.getJoint("left-knee").radius, radiusBefore);
  assert.equal(state.rig.viewYRotation, 35);
  assert.equal(state.rig.worldRotation?.y, 70);
  state.undo();
  assert.equal(state.getJoint("left-knee").z, posedKnee.z);
});

test("avatar depth profiles update the body's parent-relative rest depth", () => {
  const state = new RigState(createDefaultRig());
  applyAvatarProportionPreset(state, "child-neutral");
  for (const joint of state.rig.joints) {
    if (!joint.parentJointId) continue;
    const parent = state.getJoint(joint.parentJointId);
    assert.ok(Math.abs(joint.baseOffset!.z - ((joint.baseZ ?? joint.z) - (parent.baseZ ?? parent.z))) < 1e-7,
      `${joint.id}.baseOffset.z`);
  }
});
