import { addPoseKey, createPoseKey, type PoseClip } from "../rig/pose-interpolation.ts";
import { validateRig } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";

export interface PoseAnimationFile {
  format: "pose-mesh-animation";
  version: 1;
  createdAt: string;
  clip: PoseClip;
}

export function createPoseAnimationFile(clip: PoseClip): PoseAnimationFile {
  return {
    format: "pose-mesh-animation",
    version: 1,
    createdAt: new Date().toISOString(),
    clip: structuredClone(clip),
  };
}

export function parsePoseAnimationFile(text: string): PoseAnimationFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("애니메이션 JSON 파일을 읽을 수 없습니다.");
  }
  if (!isRecord(value) || value.format !== "pose-mesh-animation" || value.version !== 1
    || typeof value.createdAt !== "string" || !isRecord(value.clip)) {
    throw new Error("지원하지 않는 Pose Mesh Animation 저장 파일입니다.");
  }

  const source = value.clip;
  if (typeof source.id !== "string" || !source.id.trim() || typeof source.name !== "string" || !source.name.trim()
    || !Number.isInteger(source.fps) || (source.fps as number) <= 0 || !Array.isArray(source.keys)) {
    throw new Error("애니메이션 클립 정보가 올바르지 않습니다.");
  }

  let playback: PoseClip["playback"];
  if (source.playback !== undefined) {
    if (!isRecord(source.playback) || (source.playback.mode !== "ping-pong" && source.playback.mode !== "loop")
      || !Number.isInteger(source.playback.closingFrames) || (source.playback.closingFrames as number) < 1) {
      throw new Error("애니메이션 재생 설정이 올바르지 않습니다.");
    }
    playback = { mode: source.playback.mode, closingFrames: source.playback.closingFrames as number };
  }
  let clip: PoseClip = { id: source.id, name: source.name, fps: source.fps as number, keys: [], ...(playback ? { playback } : {}) };
  for (const sourceKey of source.keys) {
    if (!isRecord(sourceKey) || typeof sourceKey.id !== "string" || typeof sourceKey.name !== "string"
      || !Number.isInteger(sourceKey.frame) || !isRigRecord(sourceKey.rig)) {
      throw new Error("애니메이션 키프레임 형식이 올바르지 않습니다.");
    }
    const rig = sourceKey.rig as unknown as Rig;
    let errors: string[];
    try {
      errors = validateRig(rig);
    } catch {
      throw new Error("키프레임의 리그 데이터를 읽을 수 없습니다.");
    }
    if (errors.length > 0) throw new Error(`키프레임의 리그 데이터가 올바르지 않습니다: ${errors[0]}`);
    clip = addPoseKey(clip, createPoseKey(sourceKey.id, sourceKey.name, sourceKey.frame as number, rig));
  }

  return { format: "pose-mesh-animation", version: 1, createdAt: value.createdAt, clip };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRigRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.defaultColor === "string"
    && typeof value.projectionStrength === "number"
    && typeof value.viewYRotation === "number"
    && Array.isArray(value.palette)
    && Array.isArray(value.groups)
    && Array.isArray(value.joints)
    && Array.isArray(value.peerGroups)
    && Array.isArray(value.faces);
}
