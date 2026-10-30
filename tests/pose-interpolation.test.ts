import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import {
  addPoseKey,
  advancePosePlayback,
  createPoseKey,
  getPosePlaybackFrames,
  interpolateAngle,
  interpolateColor,
  interpolatePoseRig,
  reorderPoseKey,
  samplePosePlayback,
  samplePoseClip,
  type PoseClip,
} from "../src/rig/pose-interpolation.ts";

test("pose interpolation uses the shortest rotation path without mutating either key", () => {
  const start = createDefaultRig();
  const end = structuredClone(start);
  const startArm = start.joints.find((joint) => joint.id === "left-shoulder")!;
  const endArm = end.joints.find((joint) => joint.id === "left-shoulder")!;
  startArm.x = 20;
  startArm.localRotation = 350;
  endArm.x = 80;
  endArm.localRotation = 10;

  const middle = interpolatePoseRig(start, end, .5);
  const middleArm = middle.joints.find((joint) => joint.id === "left-shoulder")!;
  assert.equal(middleArm.x, 50);
  assert.equal(middleArm.localRotation, 0);
  assert.equal(startArm.x, 20);
  assert.equal(endArm.x, 80);
  assert.equal(interpolateAngle(10, 350, .5), 0);
});

test("rotation-only interpolation preserves the distance between connected joints", () => {
  const start = createDefaultRig();
  const end = structuredClone(start);
  const startElbow = start.joints.find((joint) => joint.id === "left-elbow")!;
  const endElbow = end.joints.find((joint) => joint.id === "left-elbow")!;
  const connectionLength = Math.hypot(startElbow.x, startElbow.y);

  endElbow.x = 0;
  endElbow.y = -connectionLength;
  endElbow.localRotation = 90;

  const middle = interpolatePoseRig(start, end, .5);
  const middleElbow = middle.joints.find((joint) => joint.id === "left-elbow")!;
  assert.ok(Math.abs(Math.hypot(middleElbow.x, middleElbow.y) - connectionLength) < 1e-9);
  assert.ok(Math.abs(middleElbow.x + connectionLength / Math.sqrt(2)) < 1e-9);
  assert.ok(Math.abs(middleElbow.y + connectionLength / Math.sqrt(2)) < 1e-9);
});

test("root joint movement remains a straight position interpolation", () => {
  const start = createDefaultRig();
  const end = structuredClone(start);
  const startRoot = start.joints.find((joint) => joint.id === "scene-root")!;
  const endRoot = end.joints.find((joint) => joint.id === "scene-root")!;
  startRoot.x = 100;
  startRoot.y = 0;
  endRoot.x = 0;
  endRoot.y = 100;

  const middle = interpolatePoseRig(start, end, .5);
  const middleRoot = middle.joints.find((joint) => joint.id === "scene-root")!;
  assert.deepEqual({ x: middleRoot.x, y: middleRoot.y }, { x: 50, y: 50 });
});

test("a pose clip samples the correct segment across three or more keys", () => {
  const first = createDefaultRig();
  const second = structuredClone(first);
  const third = structuredClone(first);
  first.joints.find((joint) => joint.id === "left-shoulder")!.x = 0;
  second.joints.find((joint) => joint.id === "left-shoulder")!.x = 60;
  third.joints.find((joint) => joint.id === "left-shoulder")!.x = 180;

  let clip: PoseClip = { id: "clip-1", name: "테스트", fps: 12, keys: [] };
  clip = addPoseKey(clip, createPoseKey("a", "포즈 A", 0, first));
  clip = addPoseKey(clip, createPoseKey("c", "포즈 C", 12, third));
  clip = addPoseKey(clip, createPoseKey("b", "포즈 B", 6, second));

  const early = samplePoseClip(clip, 3);
  const late = samplePoseClip(clip, 9);
  assert.equal(early.leftKey.id, "a");
  assert.equal(early.rightKey.id, "b");
  assert.equal(early.rig.joints.find((joint) => joint.id === "left-shoulder")!.x, 30);
  assert.equal(late.leftKey.id, "b");
  assert.equal(late.rightKey.id, "c");
  assert.equal(late.rig.joints.find((joint) => joint.id === "left-shoulder")!.x, 120);
});

test("reordering keys changes pose order while preserving existing frame slots", () => {
  const rig = createDefaultRig();
  const clip: PoseClip = {
    id: "clip",
    name: "정렬",
    fps: 12,
    keys: [
      createPoseKey("a", "A", 0, rig),
      createPoseKey("b", "B", 4, rig),
      createPoseKey("c", "C", 10, rig),
    ],
  };

  const reordered = reorderPoseKey(clip, "c", "b", false);
  assert.deepEqual(reordered.keys.map((key) => [key.id, key.frame]), [["a", 0], ["c", 4], ["b", 10]]);
  assert.deepEqual(clip.keys.map((key) => [key.id, key.frame]), [["a", 0], ["b", 4], ["c", 10]]);
});

test("an interpolated pose key is inserted between its surrounding keys without changing the motion", () => {
  const first = createDefaultRig();
  const last = structuredClone(first);
  last.joints.find((joint) => joint.id === "scene-root")!.x += 120;
  let clip: PoseClip = {
    id: "clip",
    name: "중간 키",
    fps: 12,
    keys: [createPoseKey("a", "A", 0, first), createPoseKey("c", "C", 12, last)],
  };
  const beforeInsertion = samplePoseClip(clip, 3).rig;
  const middle = samplePoseClip(clip, 6).rig;

  clip = addPoseKey(clip, createPoseKey("b", "B", 6, middle));

  assert.deepEqual(clip.keys.map((key) => [key.id, key.frame]), [["a", 0], ["b", 6], ["c", 12]]);
  assert.deepEqual(samplePoseClip(clip, 3).rig, beforeInsertion);
});

test("ping-pong playback reverses at both ends without skipping endpoint poses", () => {
  const rig = createDefaultRig();
  const clip: PoseClip = {
    id: "clip",
    name: "왕복",
    fps: 12,
    playback: { mode: "ping-pong", closingFrames: 4 },
    keys: [createPoseKey("a", "A", 0, rig), createPoseKey("b", "B", 6, rig)],
  };

  assert.deepEqual(advancePosePlayback(clip, 5, 1, 1), { frame: 6, direction: -1 });
  assert.deepEqual(advancePosePlayback(clip, 6, -1, 1), { frame: 5, direction: -1 });
  assert.deepEqual(advancePosePlayback(clip, 1, -1, 1), { frame: 0, direction: 1 });
  assert.deepEqual(advancePosePlayback(clip, 0, 1, 14), { frame: 2, direction: 1 });
});

test("loop playback interpolates from the last key back to the first", () => {
  const first = createDefaultRig();
  const last = structuredClone(first);
  first.joints.find((joint) => joint.id === "scene-root")!.x = 100;
  last.joints.find((joint) => joint.id === "scene-root")!.x = 200;
  const clip: PoseClip = {
    id: "clip",
    name: "반복",
    fps: 12,
    playback: { mode: "loop", closingFrames: 4 },
    keys: [createPoseKey("a", "A", 0, first), createPoseKey("b", "B", 6, last)],
  };

  const closingMiddle = samplePosePlayback(clip, 8);
  assert.equal(closingMiddle.leftKey.id, "b");
  assert.equal(closingMiddle.rightKey.id, "a");
  assert.equal(closingMiddle.rig.joints.find((joint) => joint.id === "scene-root")!.x, 150);
  assert.deepEqual(advancePosePlayback(clip, 9, 1, 1), { frame: 0, direction: 1 });
});

test("baked playback frame lists include a full cycle without duplicating the first frame", () => {
  const rig = createDefaultRig();
  const keys = [createPoseKey("a", "A", 0, rig), createPoseKey("b", "B", 3, rig)];
  const pingPong: PoseClip = {
    id: "ping-pong", name: "왕복", fps: 12, keys, playback: { mode: "ping-pong", closingFrames: 2 },
  };
  const loop: PoseClip = {
    id: "loop", name: "반복", fps: 12, keys, playback: { mode: "loop", closingFrames: 2 },
  };

  assert.deepEqual(getPosePlaybackFrames(pingPong), [0, 1, 2, 3, 2, 1]);
  assert.deepEqual(getPosePlaybackFrames(loop), [0, 1, 2, 3, 4]);
});

test("pose keys reject duplicate frames and incompatible structures", () => {
  const rig = createDefaultRig();
  let clip: PoseClip = { id: "clip-1", name: "테스트", fps: 12, keys: [] };
  clip = addPoseKey(clip, createPoseKey("a", "포즈 A", 0, rig));
  assert.throws(() => addPoseKey(clip, createPoseKey("b", "포즈 B", 0, rig)), /같은 프레임/);

  const incompatible = structuredClone(rig);
  incompatible.joints.pop();
  assert.throws(() => addPoseKey(clip, createPoseKey("b", "포즈 B", 6, incompatible)), /구조/);
});

test("colors interpolate in linear RGB without mutating palette data", () => {
  assert.equal(interpolateColor("#000000", "#ffffff", .5), "#bcbcbc");
  const start = createDefaultRig();
  const end = structuredClone(start);
  start.defaultColor = "#000000";
  end.defaultColor = "#ffffff";
  const middle = interpolatePoseRig(start, end, .5);
  assert.equal(middle.defaultColor, "#bcbcbc");
  assert.deepEqual(start.palette, end.palette);
});
