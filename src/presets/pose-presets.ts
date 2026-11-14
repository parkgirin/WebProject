import type { RigState } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";
import { applyRigPreset, createRigPreset, parseRigPreset, poseEntries, type RigPreset } from "../storage/rig-preset.ts";

export interface UserPosePreset {
  id: string;
  name: string;
  createdAt: string;
  preset: RigPreset;
}

export const BUILTIN_BODY_REST_POSE_ID = "builtin-body-rest-pose";
export const BUILTIN_BODY_REST_POSE_NAME = "기본 포즈 초기화";
export const BUILTIN_ARMS_DOWN_POSE_ID = "builtin-arms-down-pose";
export const BUILTIN_ARMS_DOWN_POSE_NAME = "팔 수직 내리기";
export const BUILTIN_LIMB_SPREAD_POSE_ID = "builtin-limb-spread-pose";
export const BUILTIN_LIMB_SPREAD_POSE_NAME = "팔다리 30° 포즈";

export function createUserPosePreset(id: string, name: string, rig: Rig): UserPosePreset {
  const normalizedName = name.trim();
  if (!id.trim() || !normalizedName) throw new Error("포즈 프리셋 이름이 필요합니다.");
  return {
    id,
    name: normalizedName,
    createdAt: new Date().toISOString(),
    preset: createRigPreset(rig, { pose: true, proportions: false, colors: false, shapes: false }),
  };
}

export function applyUserPosePreset(state: RigState, entry: UserPosePreset): void {
  const preset = structuredClone(entry.preset);
  for (const [jointId, saved] of poseEntries(preset)) {
    const current = state.rig.joints.find((joint) => joint.id === jointId);
    if (!current) continue;
    if (!current.parentJointId) {
      saved[1] = current.x;
      saved[2] = current.y;
      continue;
    }
    const savedLength = Math.hypot(saved[1], saved[2]);
    const targetLength = (current.baseDistance ?? Math.hypot(current.x, current.y)) * (saved[6] ?? 100) / 100;
    if (savedLength > 1e-9) {
      saved[1] = (saved[1] / savedLength) * targetLength;
      saved[2] = (saved[2] / savedLength) * targetLength;
    } else {
      saved[1] = targetLength;
      saved[2] = 0;
    }
  }
  applyRigPreset(state, preset, { pose: true, proportions: false, colors: false, shapes: false });
}

/** Lower both arm chains from the active body's authored rest pose. */
export function applyArmsDownPose(state: RigState): void {
  const target = createBodyRestRig(state.rig);
  for (const side of ["left", "right"] as const) {
    for (const part of ["elbow", "wrist"] as const) {
      const joint = target.joints.find((candidate) => candidate.id === `${side}-${part}`);
      if (!joint?.parentJointId) continue;
      const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: 0 };
      joint.x = 0;
      joint.y = Math.hypot(rest.x, rest.y);
      joint.z = target.joints.find((candidate) => candidate.id === joint.parentJointId)!.z + rest.z;
      joint.distancePercent = 100;
    }
  }
  state.replaceRig(target);
}

/** Restore the active body's authored XYZ rest pose without changing presentation or appearance. */
export function applyBodyRestPose(state: RigState): void {
  state.replaceRig(createBodyRestRig(state.rig));
}

function createBodyRestRig(rig: Rig): Rig {
  const target = structuredClone(rig);
  const root = target.joints.find((joint) => !joint.parentJointId) ?? target.joints[0];
  if (!root) return target;
  const rootPosition = { x: root.x, y: root.y, z: root.z };
  const resolvedDepth = new Map<string, number>();
  const resolveDepth = (jointId: string, resolving = new Set<string>()): number => {
    const cached = resolvedDepth.get(jointId);
    if (cached !== undefined) return cached;
    const joint = target.joints.find((candidate) => candidate.id === jointId);
    if (!joint) throw new Error(`기본 포즈 관절을 찾을 수 없습니다: ${jointId}`);
    if (resolving.has(jointId)) throw new Error(`기본 포즈 관절 계층이 순환합니다: ${jointId}`);
    if (!joint.parentJointId) {
      resolvedDepth.set(jointId, rootPosition.z);
      return rootPosition.z;
    }
    resolving.add(jointId);
    const parentDepth = resolveDepth(joint.parentJointId, resolving);
    resolving.delete(jointId);
    const depth = parentDepth + (joint.baseOffset?.z ?? joint.z - parentDepth);
    resolvedDepth.set(jointId, depth);
    return depth;
  };

  for (const joint of target.joints) {
    joint.localRotation = 0;
    joint.localRotationX = 0;
    joint.localRotationY = 0;
    if (joint.id === root.id) {
      joint.x = rootPosition.x;
      joint.y = rootPosition.y;
      joint.z = rootPosition.z;
    } else {
      const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: 0 };
      joint.x = rest.x;
      joint.y = rest.y;
      joint.z = resolveDepth(joint.id);
      joint.distancePercent = 100;
    }
  }
  return target;
}

/** Spread both arm and leg chains 30° from the active body's authored rest pose. */
export function applyLimbSpreadPose(state: RigState): void {
  const target = createBodyRestRig(state.rig);
  // Child segments retain their authored rest offsets and inherit the spread
  // from the four limb roots.
  target.joints.find((joint) => joint.id === "left-shoulder")!.localRotation = 330;
  target.joints.find((joint) => joint.id === "right-shoulder")!.localRotation = 30;
  target.joints.find((joint) => joint.id === "left-hip")!.localRotation = 30;
  target.joints.find((joint) => joint.id === "right-hip")!.localRotation = 330;
  state.replaceRig(target);
}

export function parseUserPosePresets(value: unknown): UserPosePreset[] {
  if (!Array.isArray(value)) throw new Error("포즈 프리셋 목록이 올바르지 않습니다.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)
      || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.createdAt !== "string"
      || !isRecord(entry.preset)) {
      throw new Error("포즈 프리셋 데이터가 올바르지 않습니다.");
    }
    ids.add(entry.id);
    const preset = parseRigPreset(JSON.stringify(entry.preset));
    if (!preset.pose || !Array.isArray(preset.pose.joints)) throw new Error("포즈 정보가 없는 프리셋입니다.");
    return { id: entry.id, name: entry.name.trim(), createdAt: entry.createdAt, preset };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
