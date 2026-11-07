import { parsePoseAnimationFile, type PoseAnimationFile } from "./pose-animation.ts";
import { validateRig } from "../rig/rig-state.ts";
import type { PoseClip } from "../rig/pose-interpolation.ts";
import type { Rig } from "../rig/types.ts";
import { parseUserBodyPresets, parseUserPosePresets, type UserBodyPreset, type UserPosePreset } from "../presets/index.ts";

export const WORKSPACE_CACHE_KEY = "pose-mesh-editor.workspace.v1";

export interface WorkspaceCache {
  format: "pose-mesh-workspace";
  version: 1;
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

export function createWorkspaceCache(
  rig: Rig,
  poseClip: PoseClip,
  poseFrame: number,
  selectedPoseKeyId: string | null,
  interpolationPreviewActive: boolean,
  posePresets: UserPosePreset[] = [],
  bodyPresets: UserBodyPreset[] = [],
): WorkspaceCache {
  return {
    format: "pose-mesh-workspace",
    version: 1,
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
    || typeof value.interpolationPreviewActive !== "boolean") {
    throw new Error("지원하지 않는 자동 저장 작업입니다.");
  }
  const rig = structuredClone(value.rig) as unknown as Rig;
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
