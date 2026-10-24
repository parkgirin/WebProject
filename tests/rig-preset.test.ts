import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyRigPreset, createRigPreset, parseRigPreset } from "../src/storage/rig-preset.ts";

test("a v1 preset round-trips pose, proportions, and colors", () => {
  const source = new RigState(createDefaultRig());
  source.moveJoint("head", 312, 132);
  source.setJointRadius("head", 31);
  source.setJointDepth("head", 45);
  source.setJointSideRadius("head", 22);
  source.setProjectionStrength(70);
  source.setViewYRotation(35);
  source.setSilhouetteRetention(24);
  source.setPeerGroupDistance("shoulder-band", 180);
  source.setPeerCenterOffset("hip-band", 12, -8);
  source.setDefaultColor("#123456");
  source.setFaceColor("torso", "#abcdef");
  const serialized = JSON.stringify(createRigPreset(source.rig, {
    pose: true,
    proportions: true,
    colors: true,
  }));

  const target = new RigState(createDefaultRig());
  const applied = applyRigPreset(target, parseRigPreset(serialized), {
    pose: true,
    proportions: true,
    colors: true,
  });

  assert.deepEqual(applied, ["비율", "포즈", "색상"]);
  assert.equal(target.getJoint("head").radius, 31);
  assert.equal(target.getJoint("head").depth, 45);
  assert.equal(target.getJoint("head").sideRadius, 22);
  assert.equal(target.rig.projectionStrength, 70);
  assert.equal(target.rig.viewYRotation, 35);
  assert.equal(target.rig.silhouetteRetention, 24);
  assert.equal(target.rig.defaultColor, "#123456");
  assert.equal(target.getFace("torso").color, "#abcdef");
  assert.equal(target.getJoint("head").x, source.getJoint("head").x);
  assert.equal(target.getJoint("head").y, source.getJoint("head").y);
  assert.equal(target.getPeerGroupDistance("shoulder-band"), 180);
  assert.deepEqual(target.getPeerCenterOffset("hip-band"), source.getPeerCenterOffset("hip-band"));
});

test("preset parts can be applied selectively", () => {
  const source = new RigState(createDefaultRig());
  source.setJointRadius("head", 42);
  source.setDefaultColor("#112233");
  const preset = createRigPreset(source.rig, { pose: true, proportions: true, colors: true });
  const target = new RigState(createDefaultRig());
  const originalRadius = target.getJoint("head").radius;
  const originalColor = target.rig.defaultColor;

  const applied = applyRigPreset(target, preset, { pose: true, proportions: false, colors: false });

  assert.deepEqual(applied, ["포즈"]);
  assert.equal(target.getJoint("head").radius, originalRadius);
  assert.equal(target.rig.defaultColor, originalColor);
});

test("unsupported or malformed preset files are rejected", () => {
  assert.throws(() => parseRigPreset("not json"), /JSON/);
  assert.throws(
    () => parseRigPreset(JSON.stringify({ format: "pose-mesh-editor", version: 2, createdAt: "now" })),
    /지원하지 않는/,
  );
});
