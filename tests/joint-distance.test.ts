import assert from "node:assert/strict";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const position = (state: RigState, id: string) => getJointWorldTransform(state.rig, id);
const distance = (state: RigState, a: string, b: string) => {
  const first = position(state, a);
  const second = position(state, b);
  return Math.hypot(first.x - second.x, first.y - second.y);
};

test("setting parent-child distance moves the child subtree along its existing direction and supports undo", () => {
  const state = new RigState(createDefaultRig());
  const original = structuredClone(state.rig);
  const anchor = position(state, "left-shoulder");
  const elbow = position(state, "left-elbow");
  const wrist = position(state, "left-wrist");
  const before = distance(state, "left-shoulder", "left-elbow");
  state.setJointDistance("left-elbow", "left-shoulder", before * 1.5);
  const nextElbow = position(state, "left-elbow");
  const nextWrist = position(state, "left-wrist");
  close(distance(state, "left-shoulder", "left-elbow"), before * 1.5);
  close(nextElbow.x - anchor.x, (elbow.x - anchor.x) * 1.5);
  close(nextElbow.y - anchor.y, (elbow.y - anchor.y) * 1.5);
  close(nextWrist.x - wrist.x, nextElbow.x - elbow.x);
  close(nextWrist.y - wrist.y, nextElbow.y - elbow.y);
  state.undo();
  assert.deepEqual(state.rig, original);
  state.redo();
  close(distance(state, "left-shoulder", "left-elbow"), before * 1.5);
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
  close(distance(state, "left-shoulder", "right-shoulder"), 156);
  state.redo();
  close(distance(state, "left-shoulder", "right-shoulder"), 200);
});

test("distance fields appear only for actual parent, child or peer relationships", () => {
  const rig = createDefaultRig();
  const isolated = structuredClone(rig.joints.find((joint) => joint.id === "head")!);
  isolated.id = "isolated";
  isolated.parentJointId = undefined;
  rig.joints.push(isolated);
  const state = new RigState(rig);
  const viewState: EditorViewState = { outlinesVisible: true, hideSameJointEdges: true,
    selectedFaceId: "torso", selectedTarget: "joint", inspectorTab: "selection", preserveProportions: false,
    activeTool: "select", paintColor: "#dca27b", paintPaletteId: null };
  const element = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] } as unknown as HTMLElement;
  const render = (id: string) => renderInspector(element, state, { jointId: id, jointIds: [id], axisId: null }, () => {}, viewState, () => {});
  render("left-shoulder");
  assert.match(element.innerHTML, /부모 chest/);
  assert.match(element.innerHTML, /자식 left-elbow/);
  assert.match(element.innerHTML, /shoulder-band 동등 관계/);
  assert.match(element.innerHTML, /data-peer-distance="shoulder-band"/);
  assert.match(element.innerHTML, /data-distance-moving="left-elbow" data-distance-anchor="left-shoulder"/);
  render("left-hip");
  assert.match(element.innerHTML, /data-peer-center-offset-x="hip-band"/);
  assert.match(element.innerHTML, /data-peer-center-offset-y="hip-band"/);
  render("isolated");
  assert.doesNotMatch(element.innerHTML, /관절 간 거리/);
});
