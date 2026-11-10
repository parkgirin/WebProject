import { createDefaultRig } from "../rig/default-rig.ts";
import { validateRig, type RigState } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";

export const HUMAN_RIG_TEMPLATE_ID = "human-v1";

const humanTemplate = createDefaultRig();
const jointIds = humanTemplate.joints.map((joint) => joint.id);
const axisIds = humanTemplate.joints.map((joint) => joint.axes.map((axis) => axis.id));

export type CompactJointPose = [jointIndex: number, x: number, y: number, localRotation: number, z: number, axes: number[], distancePercent?: number];
export type CompactJointProportions = [jointIndex: number, x: number, y: number, radius: number, sideRadius?: number];

export interface PresetParts {
  pose: boolean;
  proportions: boolean;
  colors: boolean;
  shapes?: boolean;
}

export interface RigPreset {
  format: "pose-mesh-editor";
  version: 2;
  createdAt: string;
  rigTemplate: typeof HUMAN_RIG_TEMPLATE_ID;
  pose?: { perspectiveEnabled?: boolean; projectionStrength?: number; viewYRotation?: number; joints: CompactJointPose[] };
  proportions?: { joints: CompactJointProportions[] };
  colors?: {
    defaultColor: string;
    palette: Rig["palette"];
    joints: Record<string, { color?: string; paletteId?: string } | null>;
    faces: Record<string, { color?: string; paletteId?: string } | null>;
  };
  artShapes?: NonNullable<Rig["artShapes"]>;
  artCompositeGroups?: NonNullable<Rig["artCompositeGroups"]>;
  artAxes?: Record<string, Rig["joints"][number]["axes"]>;
}

export function createRigPreset(rig: Rig, parts: PresetParts): RigPreset {
  assertHumanRig(rig);
  const preset: RigPreset = { format: "pose-mesh-editor", version: 2, createdAt: new Date().toISOString(), rigTemplate: HUMAN_RIG_TEMPLATE_ID };
  if (parts.pose) preset.pose = {
    perspectiveEnabled: rig.perspectiveEnabled !== false,
    projectionStrength: rig.projectionStrength,
    viewYRotation: rig.viewYRotation,
    joints: rig.joints.map((joint, index): CompactJointPose => [index, joint.x, joint.y, joint.localRotation, joint.z,
      axisIds[index].map((axisId) => joint.axes.find((axis) => axis.id === axisId)?.angle ?? 0),
      joint.parentJointId && joint.baseDistance && joint.baseDistance > 0 ? Math.hypot(joint.x, joint.y) / joint.baseDistance * 100 : 100]),
  };
  if (parts.proportions) preset.proportions = {
    joints: rig.joints.map((joint, index): CompactJointProportions => joint.sideRadius === undefined
      ? [index, joint.x, joint.y, joint.radius] : [index, joint.x, joint.y, joint.radius, joint.sideRadius]),
  };
  if (parts.colors) preset.colors = {
    defaultColor: rig.defaultColor,
    palette: rig.palette.map((entry) => ({ ...entry })),
    joints: Object.fromEntries(rig.joints.map((joint) => [joint.id, joint.color || joint.paletteId ? { ...(joint.color ? { color: joint.color } : {}), ...(joint.paletteId ? { paletteId: joint.paletteId } : {}) } : null])),
    faces: Object.fromEntries(rig.faces.map((face) => [face.id, face.color || face.paletteId ? { ...(face.color ? { color: face.color } : {}), ...(face.paletteId ? { paletteId: face.paletteId } : {}) } : null])),
  };
  if (parts.shapes) {
    preset.artShapes = structuredClone(rig.artShapes ?? []);
    preset.artCompositeGroups = structuredClone(rig.artCompositeGroups ?? []);
    const references = new Map<string, Set<string>>();
    for (const shape of rig.artShapes ?? []) for (const vertex of shape.vertices) {
      if (vertex.source !== "axis-point") continue;
      const ids = references.get(vertex.jointId) ?? new Set<string>();
      ids.add(vertex.axisId); references.set(vertex.jointId, ids);
    }
    preset.artAxes = Object.fromEntries([...references].map(([jointId, ids]) => [jointId,
      structuredClone(rig.joints.find((joint) => joint.id === jointId)?.axes.filter((axis) => ids.has(axis.id)) ?? [])]));
  }
  return preset;
}

export function parseRigPreset(text: string): RigPreset {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("JSON 파일을 읽을 수 없습니다."); }
  if (!isRecord(value) || value.format !== "pose-mesh-editor" || value.version !== 2
    || value.rigTemplate !== HUMAN_RIG_TEMPLATE_ID || typeof value.createdAt !== "string") {
    throw new Error("지원하지 않는 Pose Mesh Editor 저장 파일입니다.");
  }
  if (value.pose !== undefined && !isPose(value.pose)) throw new Error("포즈 데이터 형식이 올바르지 않습니다.");
  if (value.proportions !== undefined && !isProportions(value.proportions)) throw new Error("비율 데이터 형식이 올바르지 않습니다.");
  if (value.colors !== undefined && !isColors(value.colors)) throw new Error("색상 데이터 형식이 올바르지 않습니다.");
  if (value.artShapes !== undefined && !Array.isArray(value.artShapes)) throw new Error("도형 데이터 형식이 올바르지 않습니다.");
  if (value.artCompositeGroups !== undefined && !Array.isArray(value.artCompositeGroups)) throw new Error("도형 합성 그룹 형식이 올바르지 않습니다.");
  if (value.artAxes !== undefined && !isRecord(value.artAxes)) throw new Error("도형 축 데이터 형식이 올바르지 않습니다.");
  return value as unknown as RigPreset;
}

export function poseEntries(preset: RigPreset): Array<[string, CompactJointPose]> {
  return (preset.pose?.joints ?? []).map((entry) => [jointIds[entry[0]], entry] as [string, CompactJointPose]);
}

export function proportionEntries(preset: RigPreset): Array<[string, CompactJointProportions]> {
  return (preset.proportions?.joints ?? []).map((entry) => [jointIds[entry[0]], entry] as [string, CompactJointProportions]);
}

export function applyRigPreset(state: RigState, preset: RigPreset, parts: PresetParts): string[] {
  assertHumanRig(state.rig);
  const applied: string[] = [];
  state.beginHistoryTransaction();
  try {
    if (parts.proportions && preset.proportions) {
      for (const [jointId, value] of proportionEntries(preset)) if (jointId) {
        state.applyJointProportions(jointId, { x: value[1], y: value[2], radius: value[3], ...(value[4] === undefined ? {} : { sideRadius: value[4] }) });
      }
      applied.push("비율");
    }
    if (parts.pose && preset.pose) {
      if (typeof preset.pose.perspectiveEnabled === "boolean") state.setPerspectiveEnabled(preset.pose.perspectiveEnabled);
      if (isFiniteNumber(preset.pose.projectionStrength)) state.setProjectionStrength(preset.pose.projectionStrength);
      if (isFiniteNumber(preset.pose.viewYRotation)) state.setViewYRotation(preset.pose.viewYRotation);
      for (const [jointId, value] of poseEntries(preset)) if (jointId) {
        state.applyJointPose(jointId, { x: value[1], y: value[2], localRotation: value[3], z: value[4], distancePercent: value[6],
          axes: Object.fromEntries(axisIds[value[0]].map((axisId, index) => [axisId, value[5][index] ?? 0])) });
      }
      applied.push("포즈");
    }
    if (parts.colors && preset.colors) { state.applyColors(preset.colors); applied.push("색상"); }
    if (parts.shapes && preset.artShapes) {
      const candidate = structuredClone(state.rig);
      for (const [jointId, savedAxes] of Object.entries(preset.artAxes ?? {})) {
        const joint = candidate.joints.find((entry) => entry.id === jointId);
        if (!joint || !Array.isArray(savedAxes)) continue;
        for (const savedAxis of savedAxes) {
          const index = joint.axes.findIndex((axis) => axis.id === savedAxis.id);
          if (index >= 0) joint.axes[index] = structuredClone(savedAxis); else joint.axes.push(structuredClone(savedAxis));
        }
      }
      candidate.artShapes = structuredClone(preset.artShapes);
      candidate.artCompositeGroups = structuredClone(preset.artCompositeGroups ?? []);
      const errors = validateRig(candidate);
      if (errors.length) throw new Error(`도형 데이터를 적용할 수 없습니다: ${errors[0]}`);
      for (const [jointId] of Object.entries(preset.artAxes ?? {})) {
        const source = candidate.joints.find((joint) => joint.id === jointId);
        const target = state.rig.joints.find((joint) => joint.id === jointId);
        if (source && target) target.axes = source.axes;
      }
      state.rig.artShapes = candidate.artShapes;
      state.rig.artCompositeGroups = candidate.artCompositeGroups;
      applied.push("도형");
    }
  } finally { state.endHistoryTransaction(); }
  return applied;
}

function assertHumanRig(rig: Rig): void {
  if (rig.joints.length !== jointIds.length || rig.joints.some((joint, index) => joint.id !== jointIds[index]
    || (joint.parentJointId ?? null) !== (humanTemplate.joints[index].parentJointId ?? null))) {
    throw new Error("human-v1 인체 리그에서만 프리셋을 저장하거나 적용할 수 있습니다.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isPose(value: unknown): boolean {
  return isRecord(value) && (value.perspectiveEnabled === undefined || typeof value.perspectiveEnabled === "boolean")
    && (value.projectionStrength === undefined || isFiniteNumber(value.projectionStrength))
    && (value.viewYRotation === undefined || isFiniteNumber(value.viewYRotation))
    && isCompactEntries(value.joints, 6, (entry) => entry.slice(0, 5).every(isFiniteNumber) && Array.isArray(entry[5])
      && entry[5].every(isFiniteNumber) && (entry[6] === undefined || isFiniteNumber(entry[6])));
}
function isProportions(value: unknown): boolean { return isRecord(value) && isCompactEntries(value.joints, 4, (entry) => entry.every(isFiniteNumber)); }
function isCompactEntries(value: unknown, minimumLength: number, valid: (entry: unknown[]) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  const seen = new Set<number>();
  return value.every((entry) => Array.isArray(entry) && entry.length >= minimumLength && Number.isInteger(entry[0])
    && entry[0] >= 0 && entry[0] < jointIds.length && !seen.has(entry[0]) && (seen.add(entry[0]), valid(entry)));
}
function isColors(value: unknown): value is NonNullable<RigPreset["colors"]> {
  return isRecord(value) && typeof value.defaultColor === "string" && Array.isArray(value.palette) && isRecord(value.joints) && isRecord(value.faces);
}
