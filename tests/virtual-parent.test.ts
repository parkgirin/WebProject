import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform, getPeerGroupPivot } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";
import { applyRigPreset, createRigPreset } from "../src/storage/rig-preset.ts";

const point = (state: RigState, id: string) => getJointWorldTransform(state.rig, id);
const close = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test("waist movement leaves hips and legs fixed while the upper body follows", () => {
  const state = new RigState(createDefaultRig());
  const ids = ["left-hip", "right-hip", "left-ankle", "right-ankle"];
  const positions = ids.map((id) => point(state, id));
  const chest = point(state, "chest");
  state.moveJointsBy(["waist"], 24, 15);
  ids.forEach((id, index) => close(point(state, id), positions[index]));
  close(point(state, "chest"), { x: chest.x + 24, y: chest.y + 15 });
  state.undo();
  close(point(state, "chest"), chest);
});

test("hip peer rotation rotates its virtual parent and upper body together", () => {
  const state = new RigState(createDefaultRig());
  const pivot = getPeerGroupPivot(state.rig, "hip-band");
  const waist = point(state, "waist");
  const angle = state.getFaceRotationAngle("pelvis")!;
  state.rotatePeerGroup("hip-band", angle + 90);
  close(point(state, "waist"), { x: pivot.x - (waist.y - pivot.y), y: pivot.y + (waist.x - pivot.x) });
  state.undo();
  close(point(state, "waist"), waist);
});

test("a virtual parent can be added to two peer joints without changing their pose", () => {
  const state = new RigState(createDefaultRig());
  const ids = ["left-shoulder", "right-shoulder", "left-wrist", "right-wrist", "head"];
  const before = ids.map((id) => point(state, id));
  const id = state.addPeerCenter("shoulder-band");
  assert.ok(id);
  assert.equal(state.getJoint("left-shoulder").parentJointId, id);
  assert.equal(state.getJoint("right-shoulder").parentJointId, id);
  ids.forEach((jointId, index) => close(point(state, jointId), before[index]));
  assert.deepEqual(validateRig(state.rig), []);
  assert.equal(state.addPeerCenter("shoulder-band"), null);
  state.undo();
  assert.equal(state.rig.joints.some((joint) => joint.id === id), false);
  ids.forEach((jointId, index) => close(point(state, jointId), before[index]));
  state.redo();
  assert.equal(state.getJoint("left-shoulder").parentJointId, id);
});

test("pre-pivot presets migrate old waist-relative hip positions without changing the pose", () => {
  const rig = createDefaultRig();
  rig.joints = rig.joints.filter((joint) => joint.id !== "pelvis-pivot");
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  waist.parentJointId = "scene-root"; waist.x = 20; waist.y = -13; waist.localRotation = 35;
  for (const joint of rig.joints.filter((candidate) => candidate.id === "left-hip" || candidate.id === "right-hip")) {
    joint.parentJointId = "waist"; joint.y += 60; delete joint.axisReferenceJointId;
  }
  delete rig.peerGroups.find((group) => group.id === "hip-band")!.centerJointId;
  const source = new RigState(rig);
  const preset = createRigPreset(source.rig, { pose: true, proportions: true, colors: false });
  delete preset.hierarchy;
  const target = new RigState(createDefaultRig());
  applyRigPreset(target, preset, { pose: true, proportions: true, colors: false });
  for (const id of ["waist", "chest", "left-hip", "right-hip", "left-knee", "right-ankle"]) close(point(target, id), point(source, id));
});

test("older pelvis-pivot presets under the waist are converted with their rotation", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  const pivot = rig.joints.find((joint) => joint.id === "pelvis-pivot")!;
  waist.parentJointId = "scene-root"; waist.x = 25; waist.y = -10; waist.localRotation = 27;
  pivot.parentJointId = "waist"; pivot.x = 5; pivot.y = 65; pivot.localRotation = 30;
  const source = new RigState(rig);
  const preset = createRigPreset(source.rig, { pose: true, proportions: true, colors: false });
  delete preset.hierarchy;
  const target = new RigState(createDefaultRig());
  applyRigPreset(target, preset, { pose: true, proportions: true, colors: false });
  for (const id of ["waist", "chest", "left-hip", "right-hip", "left-knee", "right-ankle"]) close(point(target, id), point(source, id));
});

test("incompatible saved hierarchies are rejected rather than silently applied", () => {
  const source = new RigState(createDefaultRig());
  source.addPeerCenter("shoulder-band");
  const preset = createRigPreset(source.rig, { pose: true, proportions: true, colors: true });
  const target = new RigState(createDefaultRig());
  assert.throws(() => applyRigPreset(target, preset, { pose: true, proportions: false, colors: false }), /계층/);
  assert.doesNotThrow(() => applyRigPreset(target, preset, { pose: false, proportions: false, colors: true }));
});
