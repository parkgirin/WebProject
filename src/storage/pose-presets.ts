import type { RigState } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";
import { createDefaultRig } from "../rig/default-rig.ts";
import { applyRigPreset, createRigPreset, parseRigPreset, type RigPreset } from "./rig-preset.ts";

export interface UserPosePreset {
  id: string;
  name: string;
  createdAt: string;
  preset: RigPreset;
}

export const BUILTIN_T_POSE_ID = "builtin-t-pose";
export const BUILTIN_T_POSE_NAME = "T 포즈";

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
  applyRigPreset(state, entry.preset, { pose: true, proportions: false, colors: false, shapes: false });
}

export function applyTPose(state: RigState): void {
  const target = structuredClone(state.rig);
  const defaults = createDefaultRig();
  const directions: Record<string, { x: number; y: number }> = {
    waist: { x: 0, y: -1 }, chest: { x: 0, y: -1 }, head: { x: 0, y: -1 },
    "left-shoulder": { x: -1, y: 0 }, "right-shoulder": { x: 1, y: 0 },
    "left-elbow": { x: -1, y: 0 }, "right-elbow": { x: 1, y: 0 },
    "left-wrist": { x: -1, y: 0 }, "right-wrist": { x: 1, y: 0 },
    "left-hip": { x: -1, y: 0 }, "right-hip": { x: 1, y: 0 },
    "left-knee": { x: 0, y: 1 }, "right-knee": { x: 0, y: 1 },
    "left-ankle": { x: 0, y: 1 }, "right-ankle": { x: 0, y: 1 },
  };
  target.viewYRotation = 0;
  for (const joint of target.joints) {
    joint.localRotation = 0;
    joint.depth = 0;
    const direction = directions[joint.id];
    if (direction) {
      const length = Math.hypot(joint.x, joint.y);
      joint.x = direction.x * length;
      joint.y = direction.y * length;
    }
    const defaultJoint = defaults.joints.find((candidate) => candidate.id === joint.id);
    for (const axis of joint.axes) {
      const defaultAxis = defaultJoint?.axes.find((candidate) => candidate.id === axis.id);
      if (defaultAxis) axis.angle = defaultAxis.angle;
    }
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
    if (!preset.pose || !isRecord(preset.pose.joints)) throw new Error("포즈 정보가 없는 프리셋입니다.");
    return { id: entry.id, name: entry.name.trim(), createdAt: entry.createdAt, preset };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
