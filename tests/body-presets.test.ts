import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyUserBodyPreset, createUserBodyPreset, parseUserBodyPresets } from "../src/presets/body-presets.ts";
import { getJointWorldTransform } from "../src/rig/geometry.ts";
import { parseBodyPresetModules } from "../src/presets/preset-catalog-core.ts";

test("a user body preset applies lengths and radii while preserving the current pose direction", () => {
  const source = new RigState(createDefaultRig());
  source.setJointDistance("right-elbow", "right-shoulder", 132);
  source.setJointRadius("right-elbow", 24);
  const entry = createUserBodyPreset("user-body-1", "긴 팔", source.rig);

  const target = new RigState(createDefaultRig());
  target.rotateChildAroundParent("right-elbow", 55);
  target.paintJointWithColor("right-elbow", "#123456");
  const before = target.getJoint("right-elbow");
  const beforeLength = Math.hypot(before.x, before.y);
  const direction = { x: before.x / beforeLength, y: before.y / beforeLength };
  const paletteId = before.paletteId;
  applyUserBodyPreset(target, entry);

  const applied = target.getJoint("right-elbow");
  assert.ok(Math.abs(Math.hypot(applied.x, applied.y) - 132) < 1e-6);
  assert.ok(Math.abs(applied.x / 132 - direction.x) < 1e-6);
  assert.ok(Math.abs(applied.y / 132 - direction.y) < 1e-6);
  assert.equal(applied.radius, 24);
  assert.equal(applied.paletteId, paletteId);
  target.undo();
  assert.ok(Math.abs(Math.hypot(target.getJoint("right-elbow").x, target.getJoint("right-elbow").y) - beforeLength) < 1e-6);
});

test("user body preset lists validate embedded proportion data", () => {
  const entry = createUserBodyPreset("user-body-1", "  기본 체형  ", createDefaultRig());
  assert.equal(parseUserBodyPresets([entry])[0].name, "기본 체형");
  assert.throws(() => parseUserBodyPresets([{ ...entry, preset: { ...entry.preset, proportions: undefined } }]), /체형 정보/);
});

test("rebasing a bent body makes its current shape the zero-angle rest pose", () => {
  const state = new RigState(createDefaultRig());
  state.setJointAxisRotation("waist", "z", 90);
  const before = new Map(state.rig.joints.map((joint) => {
    const world = getJointWorldTransform(state.rig, joint.id);
    return [joint.id, { x: world.x, y: world.y, z: joint.z }];
  }));

  state.rebaseCurrentPoseAsBodyRest();

  for (const joint of state.rig.joints) {
    assert.equal(joint.localRotation, 0);
    assert.equal(joint.localRotationX, 0);
    assert.equal(joint.localRotationY, 0);
    const world = getJointWorldTransform(state.rig, joint.id);
    const expected = before.get(joint.id)!;
    assert.ok(Math.abs(world.x - expected.x) < 1e-7, joint.id);
    assert.ok(Math.abs(world.y - expected.y) < 1e-7, joint.id);
    assert.equal(joint.z, expected.z);
  }
});

test("a structural quadruped preset replaces the human hierarchy and supports undo", () => {
  const path = new URL("../src/presets/data/body/사족동물-기본체.json", import.meta.url);
  const [preset] = parseBodyPresetModules({
    "./data/body/사족동물-기본체.json": JSON.parse(readFileSync(path, "utf8")),
  });
  const state = new RigState(createDefaultRig());

  applyUserBodyPreset(state, preset);

  assert.equal(state.rig.viewYRotation, 90);
  assert.equal(state.rig.joints.some((joint) => joint.id === "waist"), false);
  assert.ok(state.rig.joints.some((joint) => joint.id === "tail-tip"));
  assert.ok(state.rig.joints.some((joint) => joint.id === "front-left-paw"));
  assert.ok(state.rig.joints.some((joint) => joint.id === "hind-right-paw"));
  assert.equal(state.rig.faces.filter((face) => face.cameraFacingLimb).length, 14);
  assert.ok(createUserBodyPreset("quadruped-copy", "사족 복사", state.rig).rig);

  state.undo();
  assert.ok(state.rig.joints.some((joint) => joint.id === "waist"));
  assert.equal(state.rig.joints.some((joint) => joint.id === "tail-tip"), false);
});

