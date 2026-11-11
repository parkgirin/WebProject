import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform, getPeerGroupPivot } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";

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
  const first = point(state, "left-hip");
  const angle = Math.atan2(first.y - pivot.y, first.x - pivot.x) * 180 / Math.PI;
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
});
