import type { RigState } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";
import { createDefaultRig } from "../rig/default-rig.ts";
import { applyRigPreset, createRigPreset, parseRigPreset, poseEntries, type RigPreset } from "../storage/rig-preset.ts";

export interface UserPosePreset {
  id: string;
  name: string;
  createdAt: string;
  preset: RigPreset;
}

export const BUILTIN_T_POSE_ID = "builtin-t-pose";
export const BUILTIN_T_POSE_NAME = "T 포즈";
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

export function applyTPose(state: RigState): void {
  applyNeutralTPose(state, 0);
}

/** Spread both arm and leg chains 30° away from the neutral body axes. */
export function applyLimbSpreadPose(state: RigState): void {
  applyNeutralTPose(state, 0, 30);
}

function applyNeutralTPose(state: RigState, viewYRotation: number, limbSpreadDegrees = 0): void {
  const target = structuredClone(state.rig);
  const defaults = createDefaultRig();
  // Shoulder and hip width are peer-group dimensions, not the parent-relative
  // baseline saved on each member. Preserve the active body type's width when
  // the neutral pose aligns both members to the horizontal axis.
  const shoulderHalf = state.getPeerGroupDistance("shoulder-band")! / 2;
  const hipHalf = state.getPeerGroupDistance("hip-band")! / 2;
  const peerHalfLengths: Record<string, number> = {
    "left-shoulder": shoulderHalf, "right-shoulder": shoulderHalf,
    "left-hip": hipHalf, "right-hip": hipHalf,
  };
  const directions: Record<string, { x: number; y: number }> = {
    waist: { x: 0, y: -1 }, chest: { x: 0, y: -1 }, head: { x: 0, y: -1 },
    "left-shoulder": { x: -1, y: 0 }, "right-shoulder": { x: 1, y: 0 },
    "left-elbow": { x: -1, y: 0 }, "right-elbow": { x: 1, y: 0 },
    "left-wrist": { x: -1, y: 0 }, "right-wrist": { x: 1, y: 0 },
    "left-hip": { x: -1, y: 0 }, "right-hip": { x: 1, y: 0 },
    "left-knee": { x: 0, y: 1 }, "right-knee": { x: 0, y: 1 },
    "left-ankle": { x: 0, y: 1 }, "right-ankle": { x: 0, y: 1 },
  };
  target.viewYRotation = viewYRotation;
  for (const joint of target.joints) {
    joint.localRotation = 0;
    joint.z = 0;
    const direction = directions[joint.id];
    if (direction) {
      const length = peerHalfLengths[joint.id] ?? joint.baseDistance ?? Math.hypot(joint.x, joint.y);
      joint.x = direction.x * length;
      joint.y = direction.y * length;
      joint.distancePercent = 100;
    }
    const defaultJoint = defaults.joints.find((candidate) => candidate.id === joint.id);
    for (const axis of joint.axes) {
      const defaultAxis = defaultJoint?.axes.find((candidate) => candidate.id === axis.id);
      if (defaultAxis) axis.angle = defaultAxis.angle;
    }
  }
  if (limbSpreadDegrees) {
    // The pose stores its spread at the four root limb joints only. Every
    // elbow, wrist, knee, and ankle remains at local rotation 0 and inherits
    // its orientation from the shoulder or hip above it.
    target.joints.find((joint) => joint.id === "left-shoulder")!.localRotation = -limbSpreadDegrees;
    target.joints.find((joint) => joint.id === "right-shoulder")!.localRotation = limbSpreadDegrees;
    target.joints.find((joint) => joint.id === "left-hip")!.localRotation = limbSpreadDegrees;
    target.joints.find((joint) => joint.id === "right-hip")!.localRotation = -limbSpreadDegrees;
  }
  applyRigPreset(state, createRigPreset(target, { pose: true, proportions: false, colors: false, shapes: false }),
    { pose: true, proportions: false, colors: false, shapes: false });
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
