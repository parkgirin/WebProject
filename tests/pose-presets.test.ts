import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyTPose, applyUserPosePreset, createUserPosePreset, parseUserPosePresets } from "../src/storage/pose-presets.ts";

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
  applyUserPosePreset(target, entry);

  assert.deepEqual(getJointWorldTransform(target.rig, "right-wrist"), getJointWorldTransform(source.rig, "right-wrist"));
  assert.equal(target.getGlobalRotation(), source.getGlobalRotation());
  assert.equal(target.getJoint("right-wrist").radius, 27);
  assert.equal(target.getJoint("right-wrist").paletteId, colorPaletteId);
  assert.equal(target.rig.palette.find((entry) => entry.id === colorPaletteId)?.color, "#123456");
  assert.deepEqual(target.rig.artShapes!.map((shape) => shape.id), shapeIds);
  target.undo();
  assert.notDeepEqual(getJointWorldTransform(target.rig, "right-wrist"), getJointWorldTransform(source.rig, "right-wrist"));
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
  assert.equal(elbow.depth, 0);
  state.undo();
  assert.equal(state.rig.viewYRotation, 35);
});
