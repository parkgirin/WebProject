import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { applyAvatarProportionPreset } from "../src/presets/avatar-presets.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { rotateVector } from "../src/storage/project-document.ts";
import { applyRigPreset, createRigPreset, parseRigPreset } from "../src/storage/rig-preset.ts";

test("a human-v1 preset round-trips pose, proportions, and colors", () => {
  const source = new RigState(createDefaultRig());
  source.moveJoint("head", 312, 132);
  source.setJointRadius("head", 31);
  source.setJointAxisRotation("head", "x", 25);
  source.setJointAxisRotation("head", "y", -35);
  source.setJointZ("head", 45);
  source.setJointSideRadius("head", 22);
  source.setProjectionStrength(70);
  source.setPerspectiveEnabled(false);
  source.setViewYRotation(35);
  source.setPeerGroupDistance("shoulder-band", 180);
  source.setAxisExpansionRule({ kind: "peer-axis", peerGroupId: "shoulder-band" }, "directional");
  source.setAxisExpansionRule({ kind: "joint-capsule-axis", jointId: "waist", axis: "x" }, "directional");
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
  assert.equal(target.getJoint("head").z, 45);
  assert.equal(target.getJoint("head").localRotationX, 25);
  assert.equal(target.getJoint("head").localRotationY, 325);
  assert.equal(target.getJoint("head").sideRadius, 22);
  assert.equal(target.rig.projectionStrength, 70);
  assert.equal(target.rig.perspectiveEnabled, false);
  assert.equal(target.rig.viewYRotation, 35);
  assert.equal(target.rig.defaultColor, "#123456");
  assert.equal(target.getFace("torso").color, "#abcdef");
  assert.ok(Math.abs(target.getJoint("head").x - source.getJoint("head").x) < 1e-9);
  assert.ok(Math.abs(target.getJoint("head").y - source.getJoint("head").y) < 1e-9);
  assert.equal(target.getPeerGroupDistance("shoulder-band"), 180);
  assert.deepEqual(target.rig.peerGroups.find((group) => group.id === "shoulder-band")?.axisExpansionRule,
    { mode: "directional", fixedSide: -1 });
  assert.deepEqual(target.getJoint("waist").capsuleAxisExpansionRules?.x,
    { mode: "directional", fixedSide: -1 });
});

test("a body-relative JSON pose preserves the target body's rest depth", () => {
  const source = new RigState(createDefaultRig());
  applyAvatarProportionPreset(source, "female");
  source.rebaseCurrentPoseAsBodyRest();
  source.setJointAxisRotation("waist", "z", 18);
  const preset = parseRigPreset(JSON.stringify(createRigPreset(source.rig, {
    pose: true, proportions: false, colors: false,
  })));
  assert.equal(preset.pose?.space, "body-relative-v3");

  const target = new RigState(createDefaultRig());
  applyAvatarProportionPreset(target, "child-neutral");
  target.rebaseCurrentPoseAsBodyRest();
  const waistRest = { ...target.getJoint("waist").baseOffset! };
  const waistPose = preset.pose!.joints.find((entry) => entry[0] === 2)!;

  applyRigPreset(target, preset, { pose: true, proportions: false, colors: false });

  const [expectedX, expectedY, expectedZ] = rotateVector([waistRest.x, waistRest.y, waistRest.z], waistPose[1])
    .map((value) => value * waistPose[2]);
  const waist = target.getJoint("waist");
  const pelvis = target.getJoint("pelvis-pivot");
  assert.ok(Math.abs(waist.x - expectedX) < 1e-7);
  assert.ok(Math.abs(waist.y - expectedY) < 1e-7);
  assert.ok(Math.abs(waist.z - (pelvis.z + expectedZ)) < 1e-7);
  assert.notEqual(waist.z, source.getJoint("waist").z, "source body depth must not overwrite the target body");
});

test("a proportions JSON applies body depth and capsule flat lengths", () => {
  const source = new RigState(createDefaultRig());
  applyAvatarProportionPreset(source, "female");
  const preset = parseRigPreset(JSON.stringify(createRigPreset(source.rig, {
    pose: false, proportions: true, colors: false,
  })));
  const sourceWaist = source.getJoint("waist");

  const target = new RigState(createDefaultRig());
  applyAvatarProportionPreset(target, "neutral-straight");
  applyRigPreset(target, preset, { pose: false, proportions: true, colors: false });

  const waist = target.getJoint("waist");
  const pelvis = target.getJoint("pelvis-pivot");
  assert.equal(waist.baseOffset!.z, sourceWaist.baseOffset!.z);
  assert.equal(waist.z - pelvis.z, sourceWaist.baseOffset!.z);
  assert.equal(waist.capsuleFlatLengths?.x, sourceWaist.capsuleFlatLengths?.x);
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
    () => parseRigPreset(JSON.stringify({ format: "pose-mesh-editor", version: 1, createdAt: "now" })),
    /지원하지 않는/,
  );
});
