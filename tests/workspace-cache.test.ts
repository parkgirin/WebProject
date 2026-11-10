import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { createPoseKey, type PoseClip } from "../src/rig/pose-interpolation.ts";
import { createUserBodyPreset, createUserPosePreset } from "../src/presets/index.ts";
import {
  createWorkspaceCache,
  createWorkspaceSourceRevision,
  loadWorkspaceCache,
  loadWorkspaceCacheForSource,
  parseWorkspaceCache,
  saveWorkspaceCache,
  WORKSPACE_CACHE_BACKUP_KEY,
  WORKSPACE_CACHE_KEY,
  WORKSPACE_DATA_REVISION,
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

test("ordinary project source changes keep the previous autosave", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const cache = createWorkspaceCache(createDefaultRig(), createClip(), 0, null, false, [], [], "source-old");
  saveWorkspaceCache(cache, storage);
  const result = loadWorkspaceCacheForSource("source-new", storage);

  assert.ok(result.cache);
  assert.equal(result.cache.sourceRevision, "source-new");
  assert.equal(result.dataRevisionChanged, false);
  assert.equal(result.backupSaved, false);
  assert.equal(values.has(WORKSPACE_CACHE_BACKUP_KEY), false);
});

test("an incompatible data revision archives and rejects the previous autosave", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const cache = createWorkspaceCache(createDefaultRig(), createClip(), 0, null, false, [], [],
    "source-old", WORKSPACE_DATA_REVISION);
  saveWorkspaceCache(cache, storage);
  const original = values.get(WORKSPACE_CACHE_KEY);

  const result = loadWorkspaceCacheForSource("source-new", storage, WORKSPACE_DATA_REVISION + 1);

  assert.equal(result.cache, null);
  assert.equal(result.dataRevisionChanged, true);
  assert.equal(result.backupSaved, true);
  assert.equal(result.previousSavedAt, cache.savedAt);
  assert.equal(values.get(WORKSPACE_CACHE_BACKUP_KEY), original);
});

test("matching project sources restore autosaves and source revisions are deterministic", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const revision = createWorkspaceSourceRevision({ rig: createDefaultRig(), files: ["a", "b"] });
  assert.equal(revision, createWorkspaceSourceRevision({ files: ["a", "b"], rig: createDefaultRig() }));
  assert.notEqual(revision, createWorkspaceSourceRevision({ rig: createDefaultRig(), files: ["a", "changed"] }));
  saveWorkspaceCache(createWorkspaceCache(createDefaultRig(), createClip(), 0, null, false, [], [], revision), storage);

  const result = loadWorkspaceCacheForSource(revision, storage);
  assert.ok(result.cache);
  assert.equal(result.dataRevisionChanged, false);
  assert.equal(result.backupSaved, false);
});

test("caches written before data revisions remain compatible with revision one", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const legacy = createWorkspaceCache(createDefaultRig(), createClip(), 0, null, false);
  const serialized = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
  delete serialized.dataRevision;
  values.set(WORKSPACE_CACHE_KEY, JSON.stringify(serialized));

  const result = loadWorkspaceCacheForSource("source-current", storage);
  assert.equal(result.cache?.dataRevision, 1);
  assert.equal(result.dataRevisionChanged, false);
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
