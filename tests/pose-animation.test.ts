import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { addPoseKey, createPoseKey, samplePoseClip, type PoseClip } from "../src/rig/pose-interpolation.ts";
import { createPoseAnimationFile, parsePoseAnimationFile } from "../src/storage/pose-animation.ts";

test("a pose animation file round-trips all keys and sampled frames", () => {
  const start = createDefaultRig();
  const end = structuredClone(start);
  end.joints.find((joint) => joint.id === "left-elbow")!.localRotation = 90;
  let clip: PoseClip = {
    id: "walk",
    name: "걷기",
    fps: 24,
    keys: [],
    playback: { mode: "loop", closingFrames: 8 },
  };
  clip = addPoseKey(clip, createPoseKey("start", "시작", 0, start));
  clip = addPoseKey(clip, createPoseKey("end", "끝", 12, end));

  const saved = createPoseAnimationFile(clip);
  const restored = parsePoseAnimationFile(JSON.stringify(saved)).clip;

  assert.deepEqual(restored, clip);
  assert.deepEqual(samplePoseClip(restored, 6).rig, samplePoseClip(clip, 6).rig);
});

test("pose animation files reject duplicate frames and invalid rigs", () => {
  const rig = createDefaultRig();
  const duplicate = createPoseAnimationFile({
    id: "clip",
    name: "클립",
    fps: 12,
    keys: [createPoseKey("a", "A", 0, rig), createPoseKey("b", "B", 0, rig)],
  });
  assert.throws(() => parsePoseAnimationFile(JSON.stringify(duplicate)), /같은 프레임/);

  const malformed = createPoseAnimationFile({
    id: "clip",
    name: "클립",
    fps: 12,
    keys: [createPoseKey("a", "A", 0, rig)],
  }) as unknown as { clip: { keys: Array<{ rig: { joints: unknown } }> } };
  malformed.clip.keys[0].rig.joints = null;
  assert.throws(() => parsePoseAnimationFile(JSON.stringify(malformed)), /형식/);
});

test("legacy animation keys gain shoulder capsules without changing their poses", () => {
  const rig = createDefaultRig();
  const left = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
  const original = { x: left.x, y: left.y, localRotation: left.localRotation };
  delete elbow.parentAnchor;
  const originalElbow = structuredClone(elbow);
  delete rig.joints.find((joint) => joint.id === "right-elbow")!.parentAnchor;
  for (const id of ["left-shoulder", "right-shoulder"]) {
    const shoulder = rig.joints.find((joint) => joint.id === id)!;
    delete shoulder.surfaceProfileId;
    delete shoulder.surfaceScale;
    delete shoulder.capsuleFlatAxes;
    delete shoulder.capsuleFlatLengths;
    delete shoulder.capsuleFlatAlignment;
  }
  const file = createPoseAnimationFile({
    id: "legacy",
    name: "이전 애니메이션",
    fps: 12,
    keys: [createPoseKey("a", "A", 0, rig)],
  });

  const restored = parsePoseAnimationFile(JSON.stringify(file)).clip.keys[0].rig;
  const restoredLeft = restored.joints.find((joint) => joint.id === "left-shoulder")!;

  assert.equal(restoredLeft.capsuleFlatAlignment, "peer-outward");
  assert.equal(restoredLeft.capsuleFlatLengths?.x, restoredLeft.radius);
  assert.deepEqual({ x: restoredLeft.x, y: restoredLeft.y, localRotation: restoredLeft.localRotation }, original);
  const restoredElbow = restored.joints.find((joint) => joint.id === "left-elbow")!;
  assert.deepEqual(restoredElbow.parentAnchor, { type: "capsule-end", role: "outer" });
  assert.equal(restoredElbow.x - restoredLeft.radius, originalElbow.x);
  assert.equal(restoredElbow.y, originalElbow.y);
});

test("pose animation files reject keyframes with a different joint hierarchy", () => {
  const first = createDefaultRig();
  const second = structuredClone(first);
  const reparentedElbow = second.joints.find((joint) => joint.id === "left-elbow")!;
  reparentedElbow.parentJointId = "chest";
  delete reparentedElbow.parentAnchor;
  const file = createPoseAnimationFile({
    id: "clip",
    name: "클립",
    fps: 12,
    keys: [createPoseKey("a", "A", 0, first), createPoseKey("b", "B", 6, second)],
  });

  assert.throws(() => parsePoseAnimationFile(JSON.stringify(file)), /구조/);
});
