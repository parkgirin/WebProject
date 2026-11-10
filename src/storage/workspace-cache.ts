import { parsePoseAnimationFile, type PoseAnimationFile } from "./pose-animation.ts";
import { normalizeRigZCoordinates, normalizeSurfaceProfiles, validateRig } from "../rig/rig-state.ts";
import type { PoseClip } from "../rig/pose-interpolation.ts";
import type { Rig } from "../rig/types.ts";
import { normalizeBodyViewProfiles } from "../rig/types.ts";
import { parseUserBodyPresets, parseUserPosePresets, type UserBodyPreset, type UserPosePreset } from "../presets/index.ts";

export const WORKSPACE_CACHE_KEY = "pose-mesh-editor.workspace.v1";
export const WORKSPACE_CACHE_BACKUP_KEY = "pose-mesh-editor.workspace.backup";
const LEGACY_SOURCE_REVISION = "legacy";
const LEGACY_DATA_REVISION = 1;
/** Bump only when cached project data cannot be migrated safely. */
export const WORKSPACE_DATA_REVISION = 1;

export interface WorkspaceCache {
  format: "pose-mesh-workspace";
  version: 1;
  dataRevision: number;
  /** Records the project source that last saved the cache; it does not control compatibility. */
  sourceRevision: string;
  savedAt: string;
  rig: Rig;
  poseClip: PoseClip;
  poseFrame: number;
  selectedPoseKeyId: string | null;
  interpolationPreviewActive: boolean;
  posePresets: UserPosePreset[];
  bodyPresets: UserBodyPreset[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorkspaceCacheLoadResult {
  cache: WorkspaceCache | null;
  dataRevisionChanged: boolean;
  previousSavedAt: string | null;
  backupSaved: boolean;
}

export function createWorkspaceCache(
  rig: Rig,
  poseClip: PoseClip,
  poseFrame: number,
  selectedPoseKeyId: string | null,
  interpolationPreviewActive: boolean,
  posePresets: UserPosePreset[] = [],
  bodyPresets: UserBodyPreset[] = [],
  sourceRevision = LEGACY_SOURCE_REVISION,
  dataRevision = WORKSPACE_DATA_REVISION,
): WorkspaceCache {
  return {
    format: "pose-mesh-workspace",
    version: 1,
    dataRevision,
    sourceRevision,
    savedAt: new Date().toISOString(),
    rig: structuredClone(rig),
    poseClip: structuredClone(poseClip),
    poseFrame,
    selectedPoseKeyId,
    interpolationPreviewActive,
    posePresets: structuredClone(posePresets),
    bodyPresets: structuredClone(bodyPresets),
  };
}

export function parseWorkspaceCache(text: string): WorkspaceCache {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("자동 저장 작업을 읽을 수 없습니다.");
  }
  if (!isRecord(value) || value.format !== "pose-mesh-workspace" || value.version !== 1
    || typeof value.savedAt !== "string" || !isRecord(value.rig) || !isRecord(value.poseClip)
    || !Number.isInteger(value.poseFrame) || value.selectedPoseKeyId !== null && typeof value.selectedPoseKeyId !== "string"
    || typeof value.interpolationPreviewActive !== "boolean"
    || value.dataRevision !== undefined && (!Number.isInteger(value.dataRevision) || (value.dataRevision as number) < 1)) {
    throw new Error("지원하지 않는 자동 저장 작업입니다.");
  }
  const rig = structuredClone(value.rig) as unknown as Rig;
  normalizeRigZCoordinates(rig);
  normalizeBodyViewProfiles(rig);
  normalizeSurfaceProfiles(rig);
  rig.artShapes ??= [];
  if (validateRig(rig).length) throw new Error("자동 저장 리그 데이터가 올바르지 않습니다.");
  const animation: PoseAnimationFile = parsePoseAnimationFile(JSON.stringify({
    format: "pose-mesh-animation",
    version: 1,
    createdAt: value.savedAt,
    clip: value.poseClip,
  }));
  const posePresets = parseUserPosePresets(value.posePresets ?? []);
  const bodyPresets = parseUserBodyPresets(value.bodyPresets ?? []);
  const selectedPoseKeyId = value.selectedPoseKeyId as string | null;
  return {
    format: "pose-mesh-workspace",
    version: 1,
    dataRevision: Number.isInteger(value.dataRevision) && (value.dataRevision as number) > 0
      ? value.dataRevision as number : LEGACY_DATA_REVISION,
    sourceRevision: typeof value.sourceRevision === "string" ? value.sourceRevision : LEGACY_SOURCE_REVISION,
    savedAt: value.savedAt,
    rig,
    poseClip: animation.clip,
    poseFrame: value.poseFrame as number,
    selectedPoseKeyId: selectedPoseKeyId && animation.clip.keys.some((key) => key.id === selectedPoseKeyId)
      ? selectedPoseKeyId : null,
    interpolationPreviewActive: value.interpolationPreviewActive,
    posePresets,
    bodyPresets,
  };
}

export function createWorkspaceSourceRevision(sourceData: unknown): string {
  const text = stableSerialize(sourceData);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `source-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function loadWorkspaceCacheForSource(
  sourceRevision: string,
  storage: StorageLike | null = getLocalStorage(),
  dataRevision = WORKSPACE_DATA_REVISION,
): WorkspaceCacheLoadResult {
  const empty: WorkspaceCacheLoadResult = {
    cache: null,
    dataRevisionChanged: false,
    previousSavedAt: null,
    backupSaved: false,
  };
  if (!storage) return empty;
  const text = storage.getItem(WORKSPACE_CACHE_KEY);
  if (!text) return empty;
  try {
    const cache = parseWorkspaceCache(text);
    if (cache.dataRevision === dataRevision) {
      // A normal code/default-data change is compatible. Record the current
      // source without discarding the user's live workspace.
      cache.sourceRevision = sourceRevision;
      return { ...empty, cache };
    }
    let backupSaved = false;
    try {
      storage.setItem(WORKSPACE_CACHE_BACKUP_KEY, text);
      backupSaved = true;
    } catch {
      // A failed backup must not let incompatible data override the current format.
    }
    return {
      cache: null,
      dataRevisionChanged: true,
      previousSavedAt: cache.savedAt,
      backupSaved,
    };
  } catch {
    return empty;
  }
}

export function loadWorkspaceCache(storage: StorageLike | null = getLocalStorage()): WorkspaceCache | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(WORKSPACE_CACHE_KEY);
    return text ? parseWorkspaceCache(text) : null;
  } catch {
    return null;
  }
}

export function saveWorkspaceCache(cache: WorkspaceCache, storage: StorageLike | null = getLocalStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

function getLocalStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
