import type { RigState } from "../rig/rig-state.ts";
import type { Rig } from "../rig/types.ts";

export interface PresetParts {
  pose: boolean;
  proportions: boolean;
  colors: boolean;
}

interface SavedJointPose {
  x: number;
  y: number;
  localRotation: number;
  axes: Record<string, number>;
  depth?: number;
}

interface SavedJointProportions {
  x: number;
  y: number;
  radius: number;
  bodyRadius?: number;
  sideRadius?: number;
}

export interface RigPreset {
  format: "pose-mesh-editor";
  version: 1;
  createdAt: string;
  /** Parent identities allow incompatible pose coordinate systems to be detected. */
  hierarchy?: Record<string, string | null>;
  pose?: { projectionStrength?: number; viewYRotation?: number; silhouetteRetention?: number; joints: Record<string, SavedJointPose> };
  proportions?: { joints: Record<string, SavedJointProportions> };
  colors?: {
    defaultColor: string;
    palette: Rig["palette"];
    joints: Record<string, { color?: string; paletteId?: string } | null>;
    faces: Record<string, { color?: string; paletteId?: string } | null>;
  };
  /** Reserved for future ArtShape and texture asset data. */
  character?: never;
}

export function createRigPreset(rig: Rig, parts: PresetParts): RigPreset {
  const preset: RigPreset = {
    format: "pose-mesh-editor",
    version: 1,
    createdAt: new Date().toISOString(),
    hierarchy: Object.fromEntries(rig.joints.map((joint) => [joint.id, joint.parentJointId ?? null])),
  };
  if (parts.pose) {
    preset.pose = {
      projectionStrength: rig.projectionStrength,
      viewYRotation: rig.viewYRotation,
      silhouetteRetention: rig.silhouetteRetention,
      joints: Object.fromEntries(rig.joints.map((joint) => [joint.id, {
        x: joint.x,
        y: joint.y,
        localRotation: joint.localRotation,
        axes: Object.fromEntries(joint.axes.map((axis) => [axis.id, axis.angle])),
        depth: joint.depth ?? 0,
      }])),
    };
  }
  if (parts.proportions) {
    preset.proportions = {
      joints: Object.fromEntries(rig.joints.map((joint) => [joint.id, {
        x: joint.x,
        y: joint.y,
        radius: joint.radius,
        ...(joint.bodyRadius === undefined ? {} : { bodyRadius: joint.bodyRadius }),
        ...(joint.sideRadius === undefined ? {} : { sideRadius: joint.sideRadius }),
      }])),
    };
  }
  if (parts.colors) {
    preset.colors = {
      defaultColor: rig.defaultColor,
      palette: rig.palette.map((entry) => ({ ...entry })),
      joints: Object.fromEntries(rig.joints.map((joint) => [joint.id, joint.color || joint.paletteId ? { ...(joint.color ? { color: joint.color } : {}), ...(joint.paletteId ? { paletteId: joint.paletteId } : {}) } : null])),
      faces: Object.fromEntries(rig.faces.map((face) => [face.id, face.color || face.paletteId ? { ...(face.color ? { color: face.color } : {}), ...(face.paletteId ? { paletteId: face.paletteId } : {}) } : null])),
    };
  }
  return preset;
}

export function parseRigPreset(text: string): RigPreset {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일을 읽을 수 없습니다.");
  }
  if (!isRecord(value) || value.format !== "pose-mesh-editor" || value.version !== 1
    || typeof value.createdAt !== "string") {
    throw new Error("지원하지 않는 Pose Mesh Editor 저장 파일입니다.");
  }
  if (value.pose !== undefined && !isRecord(value.pose)) throw new Error("포즈 데이터 형식이 올바르지 않습니다.");
  if (value.hierarchy !== undefined && (!isRecord(value.hierarchy)
    || Object.values(value.hierarchy).some((parent) => parent !== null && typeof parent !== "string"))) {
    throw new Error("관절 계층 데이터 형식이 올바르지 않습니다.");
  }
  if (value.proportions !== undefined && !isRecord(value.proportions)) throw new Error("비율 데이터 형식이 올바르지 않습니다.");
  if (value.colors !== undefined && !isRecord(value.colors)) throw new Error("색상 데이터 형식이 올바르지 않습니다.");
  return value as unknown as RigPreset;
}

export function applyRigPreset(state: RigState, preset: RigPreset, parts: PresetParts): string[] {
  const applied: string[] = [];
  if ((parts.pose || parts.proportions) && preset.hierarchy) {
    for (const joint of state.rig.joints) {
      if (Object.hasOwn(preset.hierarchy, joint.id) && preset.hierarchy[joint.id] !== (joint.parentJointId ?? null)) {
        throw new Error("저장된 관절 계층이 현재 모델과 달라 포즈와 비율을 적용할 수 없습니다. 같은 관절 구조를 사용해 주세요.");
      }
    }
  }
  const compatiblePreset = !preset.hierarchy && hasJoint(state.rig, "pelvis-pivot")
    ? migrateOldHipHierarchy(state, preset, parts) : preset;
  state.beginHistoryTransaction();
  try {
    if (parts.proportions && compatiblePreset.proportions?.joints) {
      for (const [jointId, value] of Object.entries(compatiblePreset.proportions.joints)) {
        if (!isProportions(value) || !hasJoint(state.rig, jointId)) continue;
        state.applyJointProportions(jointId, value);
      }
      applied.push("비율");
    }
    if (parts.pose && compatiblePreset.pose?.joints) {
      if (isFiniteNumber(compatiblePreset.pose.projectionStrength)) {
        state.setProjectionStrength(compatiblePreset.pose.projectionStrength);
      }
      if (isFiniteNumber(compatiblePreset.pose.viewYRotation)) {
        state.setViewYRotation(compatiblePreset.pose.viewYRotation);
      }
      if (isFiniteNumber(compatiblePreset.pose.silhouetteRetention)) {
        state.setSilhouetteRetention(compatiblePreset.pose.silhouetteRetention);
      }
      for (const [jointId, value] of Object.entries(compatiblePreset.pose.joints)) {
        if (!isPose(value) || !hasJoint(state.rig, jointId)) continue;
        state.applyJointPose(jointId, value);
      }
      applied.push("포즈");
    }
    if (parts.colors && preset.colors && isColors(preset.colors)) {
      state.applyColors(preset.colors);
      applied.push("색상");
    }
  } finally {
    state.endHistoryTransaction();
  }
  return applied;
}

function migrateOldHipHierarchy(state: RigState, preset: RigPreset, parts: PresetParts): RigPreset {
  const result = structuredClone(preset);
  const pose = result.pose?.joints;
  const proportions = result.proportions?.joints;
  const oldPivotPose = pose?.["pelvis-pivot"];
  const oldPivotProportions = proportions?.["pelvis-pivot"];
  const currentPivot = state.getJoint("pelvis-pivot");
  const currentWaist = state.getJoint("waist");
  const rotation = (x: number, y: number, angle: number) => {
    const radians = angle * Math.PI / 180;
    return { x: Math.cos(radians) * x - Math.sin(radians) * y, y: Math.sin(radians) * x + Math.cos(radians) * y };
  };
  const sourceAngle = parts.pose && isPose(pose?.waist) ? pose.waist.localRotation
    : currentPivot.localRotation + currentWaist.localRotation;
  const newPivotAngle = parts.pose && isPose(pose?.waist) ? sourceAngle : currentPivot.localRotation;
  const transform = (values: Record<string, { x: number; y: number }> | undefined, pivot: { x: number; y: number } | undefined) => {
    const waist = values?.waist, left = values?.["left-hip"], right = values?.["right-hip"];
    if (!waist || !left || !right || !values) return null;
    const oldAngle = isPose(oldPivotPose) ? oldPivotPose.localRotation : 0;
    const oldHip = (hip: { x: number; y: number }) => {
      const offset = rotation(hip.x, hip.y, oldAngle);
      return pivot ? { x: pivot.x + offset.x, y: pivot.y + offset.y } : hip;
    };
    const a = oldHip(left), b = oldHip(right);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const offset = rotation(midpoint.x, midpoint.y, sourceAngle);
    const waistOffset = rotation(-offset.x, -offset.y, -newPivotAngle);
    const leftOffset = rotation(a.x - midpoint.x, a.y - midpoint.y, sourceAngle - newPivotAngle);
    const rightOffset = rotation(b.x - midpoint.x, b.y - midpoint.y, sourceAngle - newPivotAngle);
    values.waist = { ...waist, ...waistOffset };
    values["left-hip"] = { ...left, ...leftOffset };
    values["right-hip"] = { ...right, ...rightOffset };
    return { x: waist.x + offset.x, y: waist.y + offset.y };
  };
  if (parts.proportions && proportions) {
    const position = transform(proportions, isProportions(oldPivotProportions) ? oldPivotProportions : undefined);
    if (!position && ["waist", "left-hip", "right-hip"].some((id) => id in proportions)) {
      throw new Error("이전 비율 데이터의 허리·골반 관절이 불완전해 변환할 수 없습니다.");
    }
    if (position) proportions["pelvis-pivot"] = { ...position, radius: currentPivot.radius };
  }
  if (parts.pose && pose) {
    const position = transform(pose, isPose(oldPivotPose) ? oldPivotPose : undefined);
    if (!position && ["waist", "left-hip", "right-hip"].some((id) => id in pose)) {
      throw new Error("이전 포즈 데이터의 허리·골반 관절이 불완전해 변환할 수 없습니다.");
    }
    if (position) {
      pose["pelvis-pivot"] = { ...position, localRotation: newPivotAngle, axes: {} };
      pose.waist.localRotation = 0;
      if (isPose(oldPivotPose)) {
        pose["left-hip"].localRotation += oldPivotPose.localRotation;
        pose["right-hip"].localRotation += oldPivotPose.localRotation;
      }
    }
  }
  return result;
}

function hasJoint(rig: Rig, jointId: string): boolean {
  return rig.joints.some((joint) => joint.id === jointId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPose(value: unknown): value is SavedJointPose {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)
    || !isFiniteNumber(value.localRotation) || !isRecord(value.axes)) return false;
  return Object.values(value.axes).every(isFiniteNumber)
    && (value.depth === undefined || isFiniteNumber(value.depth));
}

function isProportions(value: unknown): value is SavedJointProportions {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
    && isFiniteNumber(value.radius)
    && (value.bodyRadius === undefined || isFiniteNumber(value.bodyRadius))
    && (value.sideRadius === undefined || isFiniteNumber(value.sideRadius));
}

function isColors(value: unknown): value is NonNullable<RigPreset["colors"]> {
  return isRecord(value) && typeof value.defaultColor === "string"
    && Array.isArray(value.palette) && isRecord(value.joints) && isRecord(value.faces);
}
