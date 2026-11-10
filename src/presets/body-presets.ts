import type { RigState } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";
import { createRigPreset, parseRigPreset, proportionEntries, type RigPreset } from "../storage/rig-preset.ts";

export interface UserBodyPreset {
  id: string;
  name: string;
  createdAt: string;
  preset: RigPreset;
}

export function createUserBodyPreset(id: string, name: string, rig: Rig): UserBodyPreset {
  const normalizedName = name.trim();
  if (!id.trim() || !normalizedName) throw new Error("체형 프리셋 이름이 필요합니다.");
  return {
    id,
    name: normalizedName,
    createdAt: new Date().toISOString(),
    preset: createRigPreset(rig, { pose: false, proportions: true, colors: false, shapes: false }),
  };
}

export function applyUserBodyPreset(state: RigState, entry: UserBodyPreset): void {
  if (!entry.preset.proportions) throw new Error("체형 정보가 없는 프리셋입니다.");
  state.beginHistoryTransaction();
  try {
    for (const [jointId, value] of proportionEntries(entry.preset)) {
      const joint = state.getJoint(jointId);
      const targetLength = Math.hypot(value[1], value[2]);
      const currentLength = Math.hypot(joint.x, joint.y);
      const fallbackLength = Math.max(Math.hypot(value[1], value[2]), 1e-9);
      const directionX = currentLength > 1e-9 ? joint.x / currentLength : value[1] / fallbackLength;
      const directionY = currentLength > 1e-9 ? joint.y / currentLength : value[2] / fallbackLength;
      const preservePosition = !joint.parentJointId || joint.id === "pelvis-pivot";
      state.applyJointProportions(joint.id, {
        x: preservePosition ? joint.x : directionX * targetLength,
        y: preservePosition ? joint.y : directionY * targetLength,
        radius: value[3],
        ...(value[4] === undefined ? {} : { sideRadius: value[4] }),
      });
    }
  } finally {
    state.endHistoryTransaction();
  }
}

export function parseUserBodyPresets(value: unknown): UserBodyPreset[] {
  if (!Array.isArray(value)) throw new Error("체형 프리셋 목록이 올바르지 않습니다.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)
      || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.createdAt !== "string"
      || !isRecord(entry.preset)) throw new Error("체형 프리셋 데이터가 올바르지 않습니다.");
    ids.add(entry.id);
    const preset = parseRigPreset(JSON.stringify(entry.preset));
    if (!preset.proportions || !Array.isArray(preset.proportions.joints)) throw new Error("체형 정보가 없는 프리셋입니다.");
    return { id: entry.id, name: entry.name.trim(), createdAt: entry.createdAt, preset };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
