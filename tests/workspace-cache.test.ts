import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { createPoseKey, type PoseClip } from "../src/rig/pose-interpolation.ts";
import { createUserPosePreset } from "../src/storage/pose-presets.ts";
import { createUserBodyPreset } from "../src/storage/body-presets.ts";
import {
  createWorkspaceCache,
  loadWorkspaceCache,
  parseWorkspaceCache,
  saveWorkspaceCache,
  WORKSPACE_CACHE_KEY,
} from "../src/storage/workspace-cache.ts";

function createClip(): PoseClip {
  const rig = createDefaultRig();
  return {
    id: "main-clip",
    name: "테스트",
    fps: 12,
    keys: [createPoseKey("pose-1", "포즈 A", 0, rig)],
    playback: { mode: "ping-pong", closingFrames: 6 },
  };
}

test("workspace cache round-trips the current rig and animation editing position", () => {
  const rig = createDefaultRig();
  rig.defaultColor = "#123456";
  const clip = createClip();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  const posePreset = createUserPosePreset("user-pose-1", "대기", rig);
  const bodyPreset = createUserBodyPreset("user-body-1", "영웅 체형", rig);
  const cache = createWorkspaceCache(rig, clip, 0, "pose-1", false, [posePreset], [bodyPreset]);
  assert.equal(saveWorkspaceCache(cache, storage), true);
  assert.ok(values.has(WORKSPACE_CACHE_KEY));
  const restored = loadWorkspaceCache(storage)!;
  assert.equal(restored.rig.defaultColor, "#123456");
  assert.equal(restored.poseClip.keys[0].id, "pose-1");
  assert.equal(restored.selectedPoseKeyId, "pose-1");
  assert.equal(restored.posePresets[0].name, "대기");
  assert.equal(restored.bodyPresets[0].name, "영웅 체형");
});

test("workspace cache rejects malformed data and drops a missing selected key", () => {
  assert.throws(() => parseWorkspaceCache("not json"), /읽을 수 없습니다/);
  const cache = createWorkspaceCache(createDefaultRig(), createClip(), 0, "missing", false);
  const restored = parseWorkspaceCache(JSON.stringify(cache));
  assert.equal(restored.selectedPoseKeyId, null);

  const storage = { getItem: () => "not json", setItem: () => {} };
  assert.equal(loadWorkspaceCache(storage), null);
});

test("workspace cache reports storage quota failures without interrupting editing", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(saveWorkspaceCache(createWorkspaceCache(createDefaultRig(), createClip(), 0, null, false), storage), false);
});
