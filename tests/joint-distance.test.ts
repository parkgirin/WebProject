import assert from "node:assert/strict";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { DEFAULT_AVATAR_PRESET_ID, getAvatarProportionPreset } from "../src/presets/avatar-presets.ts";
import { getAxisPoint, getJointCapsuleEndWorldPoint, getJointParentWorldTransform, getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const position = (state: RigState, id: string) => getJointWorldTransform(state.rig, id);
const distance = (state: RigState, a: string, b: string) => {
  const first = position(state, a);
  const second = position(state, b);
  return Math.hypot(first.x - second.x, first.y - second.y,
    state.getJoint(a).z - state.getJoint(b).z);
};

test("joint distance percentage stays constant when a connection rotates into depth", () => {
  const state = new RigState(createDefaultRig());
  const before = state.getJointDistancePercent("left-elbow");

  state.setJointAxisRotation("left-elbow", "y", 60);

  close(state.getJointDistancePercent("left-elbow"), before);
  assert.ok(Math.abs(state.getJoint("left-elbow").z - state.getJoint("left-shoulder").z) > 1);
});

test("peer distance stays constant when the peer axis rotates into depth", () => {
  const state = new RigState(createDefaultRig());
  state.setPerspectiveEnabled(false);
  state.setGlobalAxisRotation("x", 90);
  const before = state.getPeerGroupDistance("shoulder-band")!;

  state.rotatePeerGroupInCameraPlane("shoulder-band", 45);

  close(state.getPeerGroupDistance("shoulder-band")!, before);
  assert.ok(Math.abs(state.getJoint("left-shoulder").z - state.getJoint("right-shoulder").z) > 1);
});

test("setting parent-child distance moves the child subtree along its existing direction and supports undo", () => {
  const state = new RigState(createDefaultRig());
  const original = structuredClone(state.rig);
  const anchor = getJointParentWorldTransform(state.rig, "left-elbow")!;
  const elbow = position(state, "left-elbow");
  const wrist = position(state, "left-wrist");
  const before = Math.hypot(state.getJoint("left-elbow").x, state.getJoint("left-elbow").y);
  state.setJointDistance("left-elbow", "left-shoulder", before * 1.5);
  const nextElbow = position(state, "left-elbow");
  const nextWrist = position(state, "left-wrist");
  close(Math.hypot(state.getJoint("left-elbow").x, state.getJoint("left-elbow").y), before * 1.5);
  close(nextElbow.x - anchor.x, (elbow.x - anchor.x) * 1.5);
  close(nextElbow.y - anchor.y, (elbow.y - anchor.y) * 1.5);
  close(nextWrist.x - wrist.x, nextElbow.x - elbow.x);
  close(nextWrist.y - wrist.y, nextElbow.y - elbow.y);
  state.undo();
  assert.deepEqual(state.rig, original);
  state.redo();
  close(Math.hypot(state.getJoint("left-elbow").x, state.getJoint("left-elbow").y), before * 1.5);
});

test("peer distance holds the other joint fixed; invalid and unrelated distances are ignored", () => {
  const state = new RigState(createDefaultRig());
  const fixed = position(state, "right-shoulder");
  state.setJointDistance("left-shoulder", "right-shoulder", 200);
  close(distance(state, "left-shoulder", "right-shoulder"), 200);
  assert.deepEqual(position(state, "right-shoulder"), fixed);
  const snapshot = structuredClone(state.rig);
  state.setJointDistance("left-shoulder", "right-shoulder", -1);
  state.setJointDistance("left-shoulder", "right-shoulder", Number.NaN);
  state.setJointDistance("left-wrist", "right-wrist", 20);
  state.setJointDistance("left-shoulder", "left-elbow", 20);
  assert.deepEqual(state.rig, snapshot);
  state.setJointDistance("left-shoulder", "right-shoulder", 0);
  close(distance(state, "left-shoulder", "right-shoulder"), 0);
  state.setJointDistance("left-shoulder", "right-shoulder", 10);
  close(position(state, "left-shoulder").x, fixed.x + 10);
  close(position(state, "left-shoulder").y, fixed.y);
});

test("peer group distance moves both joints symmetrically and preserves their midpoint", () => {
  const state = new RigState(createDefaultRig());
  const left = position(state, "left-shoulder");
  const right = position(state, "right-shoulder");
  const leftWrist = position(state, "left-wrist");
  const rightWrist = position(state, "right-wrist");
  const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  state.setPeerGroupDistance("shoulder-band", 200);
  const nextLeft = position(state, "left-shoulder");
  const nextRight = position(state, "right-shoulder");
  close(distance(state, "left-shoulder", "right-shoulder"), 200);
  close((nextLeft.x + nextRight.x) / 2, midpoint.x);
  close((nextLeft.y + nextRight.y) / 2, midpoint.y);
  close(position(state, "left-wrist").x - leftWrist.x, nextLeft.x - left.x);
  close(position(state, "right-wrist").x - rightWrist.x, nextRight.x - right.x);
  state.undo();
  close(distance(state, "left-shoulder", "right-shoulder"), getAvatarProportionPreset(DEFAULT_AVATAR_PRESET_ID)!.shoulderDistance);
  state.redo();
  close(distance(state, "left-shoulder", "right-shoulder"), 200);
});

test("peer capsule axes use the same centered or directional expansion rule", () => {
  const state = new RigState(createDefaultRig());
  const leftBefore = position(state, "left-shoulder");
  const rightBefore = position(state, "right-shoulder");
  assert.deepEqual(state.rig.peerGroups.find((group) => group.id === "shoulder-band")!.axisExpansionRule,
    { mode: "centered" });

  state.setAxisExpansionRule({ kind: "peer-axis", peerGroupId: "shoulder-band" }, "directional");
  state.setPeerGroupDistance("shoulder-band", 180);

  assert.deepEqual(position(state, "left-shoulder"), leftBefore);
  close(position(state, "right-shoulder").x, leftBefore.x + 180);
  close(position(state, "right-shoulder").y, rightBefore.y);
  assert.deepEqual(state.rig.peerGroups.find((group) => group.id === "shoulder-band")!.axisExpansionRule,
    { mode: "directional", fixedSide: -1 });
});

test("joint capsule axes store the common expansion rule per local axis", () => {
  const state = new RigState(createDefaultRig());
  assert.deepEqual(state.getJoint("waist").capsuleAxisExpansionRules?.x, { mode: "centered" });
  state.setAxisExpansionRule({ kind: "joint-capsule-axis", jointId: "waist", axis: "x" }, "directional");
  assert.deepEqual(state.getJoint("waist").capsuleAxisExpansionRules?.x,
    { mode: "directional", fixedSide: -1 });
  assert.deepEqual(state.getJoint("waist").capsuleAxisExpansionRules?.y, undefined);
});

test("peer-aligned shoulder capsules obey the same axis expansion origin", () => {
  const state = new RigState(createDefaultRig());
  const shoulder = state.getJoint("left-shoulder");
  const center = position(state, shoulder.id);
  const directionalOuter = getJointCapsuleEndWorldPoint(state.rig, shoulder.id, "outer");
  close(Math.hypot(directionalOuter.x - center.x, directionalOuter.y - center.y),
    shoulder.capsuleFlatLengths!.x!);

  state.setAxisExpansionRule(
    { kind: "joint-capsule-axis", jointId: shoulder.id, axis: "x" }, "centered",
  );
  const centeredOuter = getJointCapsuleEndWorldPoint(state.rig, shoulder.id, "outer");
  close(Math.hypot(centeredOuter.x - center.x, centeredOuter.y - center.y),
    shoulder.capsuleFlatLengths!.x! / 2);
});

test("authored joint axes use the shared expansion rule directly", () => {
  const state = new RigState(createDefaultRig());
  const waist = state.getJoint("waist");
  const axis = waist.axes.find((candidate) => candidate.id === "upper-torso")!;
  const center = position(state, waist.id);
  assert.notDeepEqual(getAxisPoint(state.rig, waist, axis, -1), { x: center.x, y: center.y });

  state.setAxisExpansionRule(
    { kind: "joint-axis", jointId: waist.id, axisId: axis.id }, "directional",
  );

  assert.deepEqual(getAxisPoint(state.rig, waist, axis, -1), { x: center.x, y: center.y });
  assert.notDeepEqual(getAxisPoint(state.rig, waist, axis, 1), { x: center.x, y: center.y });
});

test("peer groups toggle their virtual capsule without changing joint transforms", () => {
  const state = new RigState(createDefaultRig());
  const before = state.rig.peerGroups.find((group) => group.id === "shoulder-band")!;
  assert.equal(before.virtualCapsule, true);
  const left = position(state, "left-shoulder");
  const right = position(state, "right-shoulder");

  state.setPeerGroupVirtualCapsule("shoulder-band", false);
  assert.equal(before.virtualCapsule, false);
  assert.deepEqual(position(state, "left-shoulder"), left);
  assert.deepEqual(position(state, "right-shoulder"), right);
  state.undo();
  assert.equal(state.rig.peerGroups.find((group) => group.id === "shoulder-band")!.virtualCapsule, true);
});

test("distance fields appear only for actual parent, child or peer relationships", () => {
  const rig = createDefaultRig();
  const isolated = structuredClone(rig.joints.find((joint) => joint.id === "head")!);
  isolated.id = "isolated";
  isolated.parentJointId = undefined;
  rig.joints.push(isolated);
  const state = new RigState(rig);
  const viewState: EditorViewState = { outlinesVisible: true, hideSameJointEdges: true,
    selectedFaceId: "torso", selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    activeTool: "select", paintColor: "#dca27b", paintPaletteId: null };
  const element = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] } as unknown as HTMLElement;
  const render = (id: string) => renderInspector(element, state, { jointId: id, jointIds: [id], axisId: null }, () => {}, viewState, () => {});
  render("left-shoulder");
  assert.match(element.innerHTML, /부모 chest/);
  assert.match(element.innerHTML, /자식 left-elbow/);
  assert.match(element.innerHTML, /shoulder-band 가상 캡슐/);
  assert.match(element.innerHTML, /data-peer-distance="shoulder-band"/);
  assert.match(element.innerHTML, /data-peer-capsule="shoulder-band" checked/);
  assert.match(element.innerHTML, /data-peer-axis-expansion="shoulder-band"/);
  assert.match(element.innerHTML, /data-capsule-axis-expansion="x"/);
  assert.match(element.innerHTML, /data-peer-distance-range="shoulder-band"/);
  assert.match(element.innerHTML, /캡슐 길이/);
  assert.match(element.innerHTML, /data-peer-distance-step="10" data-peer-group="shoulder-band"/);
  assert.match(element.innerHTML, /data-distance-moving="left-elbow" data-distance-anchor="left-shoulder"/);
  assert.doesNotMatch(element.innerHTML, /data-add-peer-center/);
  assert.doesNotMatch(element.innerHTML, /가상 부모/);
  render("left-hip");
  assert.doesNotMatch(element.innerHTML, /data-peer-center-offset-x="hip-band"/);
  assert.doesNotMatch(element.innerHTML, /data-peer-center-offset-y="hip-band"/);
  assert.doesNotMatch(element.innerHTML, /data-add-peer-center="hip-band"/);
  render("isolated");
  assert.doesNotMatch(element.innerHTML, /관절 간 거리/);
});
