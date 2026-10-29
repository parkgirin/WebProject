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

test("pose animation files reject keyframes with a different joint hierarchy", () => {
  const first = createDefaultRig();
  const second = structuredClone(first);
  second.joints.find((joint) => joint.id === "left-elbow")!.parentJointId = "chest";
  const file = createPoseAnimationFile({
    id: "clip",
    name: "클립",
    fps: 12,
    keys: [createPoseKey("a", "A", 0, first), createPoseKey("b", "B", 6, second)],
  });

  assert.throws(() => parsePoseAnimationFile(JSON.stringify(file)), /구조/);
});
