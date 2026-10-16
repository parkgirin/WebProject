import type { RigState } from "../rig/rig-state";
import type { Rig } from "../rig/types";

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
}

interface SavedJointProportions {
  x: number;
  y: number;
  radius: number;
  bodyRadius?: number;
}

export interface RigPreset {
  format: "pose-mesh-editor";
  version: 1;
  createdAt: string;
  pose?: { joints: Record<string, SavedJointPose> };
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
  };
  if (parts.pose) {
    preset.pose = {
      joints: Object.fromEntries(rig.joints.map((joint) => [joint.id, {
        x: joint.x,
        y: joint.y,
        localRotation: joint.localRotation,
        axes: Object.fromEntries(joint.axes.map((axis) => [axis.id, axis.angle])),
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
  if (value.proportions !== undefined && !isRecord(value.proportions)) throw new Error("비율 데이터 형식이 올바르지 않습니다.");
  if (value.colors !== undefined && !isRecord(value.colors)) throw new Error("색상 데이터 형식이 올바르지 않습니다.");
  return value as unknown as RigPreset;
}

export function applyRigPreset(state: RigState, preset: RigPreset, parts: PresetParts): string[] {
  const applied: string[] = [];
  const legacyPelvisPose = preset.pose?.joints["pelvis-pivot"];
  const legacyPelvisProportions = preset.proportions?.joints["pelvis-pivot"];
  const usesHipPeerRig = !hasJoint(state.rig, "pelvis-pivot")
    && hasJoint(state.rig, "left-hip") && hasJoint(state.rig, "right-hip");
  state.beginHistoryTransaction();
  try {
    if (parts.proportions && preset.proportions?.joints) {
      for (const [jointId, value] of Object.entries(preset.proportions.joints)) {
        if (!isProportions(value) || !hasJoint(state.rig, jointId)) continue;
        const migrated = usesHipPeerRig && isHipJoint(jointId) && isProportions(legacyPelvisProportions)
          ? { ...value, x: legacyPelvisProportions.x + value.x, y: legacyPelvisProportions.y + value.y }
          : value;
        state.applyJointProportions(jointId, migrated);
      }
      applied.push("비율");
    }
    if (parts.pose && preset.pose?.joints) {
      for (const [jointId, value] of Object.entries(preset.pose.joints)) {
        if (!isPose(value) || !hasJoint(state.rig, jointId)) continue;
        const migrated = usesHipPeerRig && isHipJoint(jointId) && isPose(legacyPelvisPose)
          ? migrateLegacyHipPose(value, legacyPelvisPose)
          : value;
        state.applyJointPose(jointId, migrated);
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

function isHipJoint(jointId: string): boolean {
  return jointId === "left-hip" || jointId === "right-hip";
}

function migrateLegacyHipPose(hip: SavedJointPose, pivot: SavedJointPose): SavedJointPose {
  const radians = pivot.localRotation * Math.PI / 180;
  return {
    ...hip,
    x: pivot.x + Math.cos(radians) * hip.x - Math.sin(radians) * hip.y,
    y: pivot.y + Math.sin(radians) * hip.x + Math.cos(radians) * hip.y,
    localRotation: pivot.localRotation + hip.localRotation,
  };
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
  return Object.values(value.axes).every(isFiniteNumber);
}

function isProportions(value: unknown): value is SavedJointProportions {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
    && isFiniteNumber(value.radius)
    && (value.bodyRadius === undefined || isFiniteNumber(value.bodyRadius));
}

function isColors(value: unknown): value is NonNullable<RigPreset["colors"]> {
  return isRecord(value) && typeof value.defaultColor === "string"
    && Array.isArray(value.palette) && isRecord(value.joints) && isRecord(value.faces);
}
