import { RigState, normalizeArtShapeSpheres, validateRig } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";
import { rotateVectorAroundAxis } from "../rig/geometry.ts";
import { createRigPreset, isHumanRig, parseRigPreset, proportionEntries, type RigPreset } from "../storage/rig-preset.ts";

export interface UserBodyPreset {
  id: string;
  name: string;
  createdAt: string;
  preset?: RigPreset;
  /** Structurally different bodies replace the complete rig hierarchy. */
  rig?: Rig;
}

const BODY_PRESET_SHAPE_PREFIX = "body-preset-";

export function createUserBodyPreset(id: string, name: string, rig: Rig): UserBodyPreset {
  const normalizedName = name.trim();
  if (!id.trim() || !normalizedName) throw new Error("체형 프리셋 이름이 필요합니다.");
  const bodyRig = structuredClone(rig);
  new RigState(bodyRig).rebaseCurrentPoseAsBodyRest();
  const common = {
    id,
    name: normalizedName,
    createdAt: new Date().toISOString(),
  };
  return isHumanRig(bodyRig)
    ? { ...common, preset: createRigPreset(bodyRig, { pose: false, proportions: true, colors: false, shapes: false }) }
    : { ...common, rig: bodyRig };
}

export function applyUserBodyPreset(state: RigState, entry: UserBodyPreset): void {
  if (entry.rig) {
    state.replaceRig(entry.rig);
    return;
  }
  if (!entry.preset?.proportions) throw new Error("체형 정보가 없는 프리셋입니다.");
  state.beginHistoryTransaction();
  try {
    for (const [jointId, value] of proportionEntries(entry.preset)) {
      const joint = state.getJoint(jointId);
      if (value[5] !== undefined && joint.parentJointId && joint.id !== "pelvis-pivot") {
        const rest = { x: value[1], y: value[2], z: value[5] };
        let posed = rotateVectorAroundAxis(rest, { x: 1, y: 0, z: 0 }, joint.localRotationX ?? 0);
        posed = rotateVectorAroundAxis(posed, { x: 0, y: 1, z: 0 }, joint.localRotationY ?? 0);
        posed = rotateVectorAroundAxis(posed, { x: 0, y: 0, z: 1 }, joint.localRotation);
        const parent = state.getJoint(joint.parentJointId);
        joint.x = posed.x;
        joint.y = posed.y;
        joint.z = Math.min(100, Math.max(-100, parent.z + posed.z));
        joint.baseOffset = rest;
        joint.baseDistance = Math.hypot(rest.x, rest.y);
        joint.distancePercent = 100;
        state.setJointRadius(joint.id, value[3]);
        if (typeof value[4] === "number") state.setJointSideRadius(joint.id, value[4]);
        continue;
      }
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
        ...(typeof value[4] === "number" ? { sideRadius: value[4] } : {}),
      });
    }
    const candidate = structuredClone(state.rig);
    candidate.artShapes = (candidate.artShapes ?? []).filter((shape) => !shape.id.startsWith(BODY_PRESET_SHAPE_PREFIX));
    for (const savedShape of entry.preset.artShapes ?? []) {
      if (savedShape.kind !== "sphere") continue;
      const target = candidate.artShapes.find((shape) => shape.id === savedShape.id && shape.kind === "sphere");
      if (target) target.radius = savedShape.radius;
      else if (savedShape.id.startsWith(BODY_PRESET_SHAPE_PREFIX)) candidate.artShapes.push(structuredClone(savedShape));
    }
    normalizeArtShapeSpheres(candidate);
    const errors = validateRig(candidate);
    if (errors.length) throw new Error(`체형 도형을 적용할 수 없습니다: ${errors[0]}`);
    state.rig.artShapes = candidate.artShapes;
  } finally {
    state.endHistoryTransaction();
  }
}

export function parseUserBodyPresets(value: unknown): UserBodyPreset[] {
  if (!Array.isArray(value)) throw new Error("체형 프리셋 목록이 올바르지 않습니다.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)
      || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.createdAt !== "string") {
      throw new Error("체형 프리셋 데이터가 올바르지 않습니다.");
    }
    ids.add(entry.id);
    if (isRecord(entry.rig)) {
      if (entry.preset !== undefined) throw new Error("체형 프리셋은 비율 또는 전체 리그 중 하나만 가져야 합니다.");
      const rig = structuredClone(entry.rig) as unknown as Rig;
      new RigState(rig);
      return { id: entry.id, name: entry.name.trim(), createdAt: entry.createdAt, rig };
    }
    if (!isRecord(entry.preset)) throw new Error("체형 프리셋 데이터가 올바르지 않습니다.");
    const preset = parseRigPreset(JSON.stringify(entry.preset));
    if (!preset.proportions || !Array.isArray(preset.proportions.joints)) throw new Error("체형 정보가 없는 프리셋입니다.");
    return { id: entry.id, name: entry.name.trim(), createdAt: entry.createdAt, preset };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
