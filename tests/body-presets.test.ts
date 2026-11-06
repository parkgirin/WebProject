import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyUserBodyPreset, createUserBodyPreset, parseUserBodyPresets } from "../src/storage/body-presets.ts";

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
