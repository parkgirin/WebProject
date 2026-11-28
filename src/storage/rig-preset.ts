import { createDefaultRig } from "../rig/default-rig.ts";
import { captureBodyRelativePose, restoreBodyRelativePose } from "../rig/body-relative-pose.ts";
import { normalizeArtShapeSpheres, validateRig, type RigState } from "../rig/rig-state.ts";
import type { AxisExpansionRule, Rig } from "../rig/types.ts";
import {
  quaternionBetweenVectors,
  quaternionFromEuler,
  quaternionToEuler,
  rotateVector,
  type Quaternion,
  type Vector3Tuple,
} from "./project-document.ts";

export const HUMAN_RIG_TEMPLATE_ID = "human-v1";

const humanTemplate = createDefaultRig();
const jointIds = humanTemplate.joints.map((joint) => joint.id);
const axisIds = humanTemplate.joints.map((joint) => joint.axes.map((axis) => axis.id));

export type CompactJointPose = [
  jointIndex: number, x: number, y: number, localRotation: number, z: number,
  axes: number[], distancePercent?: number, localRotationX?: number, localRotationY?: number,
];
/** v3 body-relative pose: rotation from rest offset, XYZ scale, inherited orientation, axis angles. */
export type CompactRelativeJointPose = [
  jointIndex: number, offsetRotation: Quaternion, lengthScale: number, orientation: Quaternion, axes: number[],
];
export type CompactJointProportions = [
  jointIndex: number, x: number, y: number, radius: number, sideRadius?: number | null, restZ?: number,
  capsuleFlatLengths?: Partial<Record<"x" | "y" | "z", number>>,
  capsuleAxisExpansionRules?: Partial<Record<"x" | "y" | "z", AxisExpansionRule>>,
];

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
  pose?: LegacyPoseData | BodyRelativePoseData;
  proportions?: {
    joints: CompactJointProportions[];
    peerDistances?: Record<string, number>;
    peerAxisExpansionRules?: Record<string, AxisExpansionRule>;
  };
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

interface PosePresentation {
  perspectiveEnabled?: boolean;
  projectionStrength?: number;
  viewYRotation?: number;
}

interface LegacyPoseData extends PosePresentation {
  /** v2 compatibility: parent-relative XYZ coordinates. */
  space?: undefined;
  joints: CompactJointPose[];
}

interface BodyRelativePoseData extends PosePresentation {
  /** v3 pose parameters, independent of the body's rest offsets. */
  space: "body-relative-v3";
  rootOrientation: Quaternion;
  joints: CompactRelativeJointPose[];
}

export function createRigPreset(rig: Rig, parts: PresetParts): RigPreset {
  assertHumanRig(rig);
  const preset: RigPreset = { format: "pose-mesh-editor", version: 2, createdAt: new Date().toISOString(), rigTemplate: HUMAN_RIG_TEMPLATE_ID };
  if (parts.pose) preset.pose = createBodyRelativePose(rig);
  if (parts.proportions) preset.proportions = {
    joints: rig.joints.map((joint, index): CompactJointProportions => {
      const parent = joint.parentJointId ? rig.joints.find((candidate) => candidate.id === joint.parentJointId) : null;
      const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: joint.z - (parent?.z ?? 0) };
      return [index, rest.x, rest.y, joint.radius, joint.sideRadius, rest.z,
        joint.capsuleFlatLengths ? structuredClone(joint.capsuleFlatLengths) : undefined,
        joint.capsuleAxisExpansionRules ? structuredClone(joint.capsuleAxisExpansionRules) : undefined];
    }),
    peerDistances: Object.fromEntries(rig.peerGroups.flatMap((group) => {
      if (group.jointIds.length !== 2) return [];
      const first = rig.joints.find((joint) => joint.id === group.jointIds[0]);
      const second = rig.joints.find((joint) => joint.id === group.jointIds[1]);
      return first && second ? [[group.id, Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z)]] : [];
    })),
    peerAxisExpansionRules: Object.fromEntries(rig.peerGroups.map((group) => [
      group.id, structuredClone(group.axisExpansionRule ?? { mode: "centered" }),
    ])),
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

/** Capture a pose independently from the active body's rest offsets. */
function createBodyRelativePose(rig: Rig): BodyRelativePoseData {
  assertHumanRig(rig);
  const root = rig.joints.find((joint) => !joint.parentJointId) ?? rig.joints[0];
  if (!root) throw new Error("포즈를 저장할 관절이 없습니다.");
  return {
    space: "body-relative-v3",
    perspectiveEnabled: rig.perspectiveEnabled !== false,
    projectionStrength: rig.projectionStrength,
    viewYRotation: rig.viewYRotation,
    rootOrientation: quaternionFromEuler(root.localRotationX ?? 0, root.localRotationY ?? 0, root.localRotation),
    joints: rig.joints.flatMap((joint, index): CompactRelativeJointPose[] => {
      if (!joint.parentJointId) return [];
      const parent = rig.joints.find((candidate) => candidate.id === joint.parentJointId);
      const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: joint.z - (parent?.z ?? 0) };
      const posed: Vector3Tuple = [joint.x, joint.y, joint.z - (parent?.z ?? 0)];
      const restVector: Vector3Tuple = [rest.x, rest.y, rest.z];
      const restLength = Math.hypot(...restVector);
      const posedLength = Math.hypot(...posed);
      return [[index,
        restLength > 1e-9 && posedLength > 1e-9 ? quaternionBetweenVectors(restVector, posed) : [0, 0, 0, 1],
        restLength > 1e-9 ? posedLength / restLength : 1,
        quaternionFromEuler(joint.localRotationX ?? 0, joint.localRotationY ?? 0, joint.localRotation),
        axisIds[index].map((axisId) => joint.axes.find((axis) => axis.id === axisId)?.angle ?? 0),
      ]];
    }),
  };
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
  if (!preset.pose || isBodyRelativePose(preset.pose)) return [];
  return preset.pose.joints.map((entry) => [jointIds[entry[0]], entry] as [string, CompactJointPose]);
}

export function isBodyRelativePose(pose: NonNullable<RigPreset["pose"]>): pose is BodyRelativePoseData {
  return pose.space === "body-relative-v3";
}

export function proportionEntries(preset: RigPreset): Array<[string, CompactJointProportions]> {
  return (preset.proportions?.joints ?? []).map((entry) => [jointIds[entry[0]], entry] as [string, CompactJointProportions]);
}

export function applyRigPreset(state: RigState, preset: RigPreset, parts: PresetParts): string[] {
  assertHumanRig(state.rig);
  const applied: string[] = [];
  const preservedPose = parts.proportions && preset.proportions && !(parts.pose && preset.pose)
    ? captureBodyRelativePose(state.rig) : null;
  state.beginHistoryTransaction();
  try {
    if (parts.proportions && preset.proportions) {
      for (const [jointId, value] of proportionEntries(preset)) if (jointId) {
        applyBodyProportions(state, jointId, value);
      }
      for (const [peerGroupId, rule] of Object.entries(preset.proportions.peerAxisExpansionRules ?? {})) {
        state.setAxisExpansionRule({ kind: "peer-axis", peerGroupId }, rule.mode, rule.fixedSide);
      }
      for (const [peerGroupId, distance] of Object.entries(preset.proportions.peerDistances ?? {})) {
        if (isFiniteNumber(distance)) state.setPeerGroupDistance(peerGroupId, distance);
      }
      applied.push("비율");
    }
    if (preservedPose) restoreBodyRelativePose(state, preservedPose);
    if (parts.pose && preset.pose) {
      if (typeof preset.pose.perspectiveEnabled === "boolean") state.setPerspectiveEnabled(preset.pose.perspectiveEnabled);
      if (isFiniteNumber(preset.pose.projectionStrength)) state.setProjectionStrength(preset.pose.projectionStrength);
      if (isFiniteNumber(preset.pose.viewYRotation)) state.setViewYRotation(preset.pose.viewYRotation);
      if (isBodyRelativePose(preset.pose)) applyBodyRelativePose(state, preset.pose);
      else for (const [jointId, value] of poseEntries(preset)) if (jointId) {
          state.applyJointPose(jointId, { x: value[1], y: value[2], localRotation: value[3], z: value[4], distancePercent: value[6],
            localRotationX: value[7], localRotationY: value[8],
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
      normalizeArtShapeSpheres(candidate);
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
  if (!isHumanRig(rig)) {
    throw new Error("human-v1 인체 리그에서만 프리셋을 저장하거나 적용할 수 있습니다.");
  }
}

export function isHumanRig(rig: Rig): boolean {
  return rig.joints.length === jointIds.length && !rig.joints.some((joint, index) => joint.id !== jointIds[index]
    || (joint.parentJointId ?? null) !== (humanTemplate.joints[index].parentJointId ?? null));
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isPose(value: unknown): boolean {
  if (!isRecord(value) || (value.perspectiveEnabled !== undefined && typeof value.perspectiveEnabled !== "boolean")
    || (value.projectionStrength !== undefined && !isFiniteNumber(value.projectionStrength))
    || (value.viewYRotation !== undefined && !isFiniteNumber(value.viewYRotation))) return false;
  if (value.space === "body-relative-v3") {
    return isQuaternion(value.rootOrientation) && isCompactEntries(value.joints, 5, (entry) => isFiniteNumber(entry[0])
      && isQuaternion(entry[1]) && isFiniteNumber(entry[2]) && entry[2] >= 0 && isQuaternion(entry[3])
      && Array.isArray(entry[4]) && entry[4].every(isFiniteNumber));
  }
  return value.space === undefined
    && (value.projectionStrength === undefined || isFiniteNumber(value.projectionStrength))
    && (value.viewYRotation === undefined || isFiniteNumber(value.viewYRotation))
    && isCompactEntries(value.joints, 6, (entry) => entry.slice(0, 5).every(isFiniteNumber) && Array.isArray(entry[5])
      && entry[5].every(isFiniteNumber) && (entry[6] === undefined || isFiniteNumber(entry[6]))
      && (entry[7] === undefined || isFiniteNumber(entry[7])) && (entry[8] === undefined || isFiniteNumber(entry[8])));
}
function isQuaternion(value: unknown): value is Quaternion {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function applyBodyRelativePose(state: RigState, pose: BodyRelativePoseData): void {
  const root = state.rig.joints.find((joint) => !joint.parentJointId) ?? state.rig.joints[0];
  if (!root) return;
  const rootOrientation = quaternionToEuler(pose.rootOrientation);
  state.applyJointPose(root.id, {
    x: root.x, y: root.y, z: root.z,
    localRotation: rootOrientation.z, localRotationX: rootOrientation.x, localRotationY: rootOrientation.y,
    axes: Object.fromEntries(root.axes.map((axis) => [axis.id, axis.angle])),
  });
  for (const value of pose.joints) {
    const jointId = jointIds[value[0]];
    if (!jointId) continue;
    const joint = state.rig.joints.find((candidate) => candidate.id === jointId);
    const parent = joint?.parentJointId ? state.rig.joints.find((candidate) => candidate.id === joint.parentJointId) : undefined;
    if (!joint || !parent) continue;
    const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: joint.z - parent.z };
    const offset = rotateVector([rest.x, rest.y, rest.z], value[1]).map((coordinate) => coordinate * value[2]);
    const orientation = quaternionToEuler(value[3]);
    state.applyJointPose(jointId, {
      x: offset[0], y: offset[1], z: parent.z + offset[2],
      localRotation: orientation.z, localRotationX: orientation.x, localRotationY: orientation.y,
      distancePercent: value[2] * 100,
      axes: Object.fromEntries(axisIds[value[0]].map((axisId, index) => [axisId, value[4][index] ?? 0])),
    });
  }
}
function isProportions(value: unknown): boolean {
  return isRecord(value) && isCompactEntries(value.joints, 4, (entry) => entry.slice(0, 4).every(isFiniteNumber)
    && (entry[4] === undefined || entry[4] === null || isFiniteNumber(entry[4]))
    && (entry[5] === undefined || isFiniteNumber(entry[5]))
    && (entry[6] === undefined || entry[6] === null || isFlatLengths(entry[6]))
    && (entry[7] === undefined || entry[7] === null || isCapsuleAxisExpansionRules(entry[7])))
    && (value.peerDistances === undefined || isRecord(value.peerDistances)
      && Object.values(value.peerDistances).every(isFiniteNumber))
    && (value.peerAxisExpansionRules === undefined || isRecord(value.peerAxisExpansionRules)
      && Object.values(value.peerAxisExpansionRules).every(isAxisExpansionRule));
}
function isFlatLengths(value: unknown): value is Partial<Record<"x" | "y" | "z", number>> {
  return isRecord(value) && Object.entries(value).every(([axis, length]) => (axis === "x" || axis === "y" || axis === "z")
    && isFiniteNumber(length) && length >= 0);
}
function isAxisExpansionRule(value: unknown): value is AxisExpansionRule {
  return isRecord(value) && (value.mode === "centered" || value.mode === "directional")
    && (value.fixedSide === undefined || value.fixedSide === -1 || value.fixedSide === 1);
}
function isCapsuleAxisExpansionRules(
  value: unknown,
): value is Partial<Record<"x" | "y" | "z", AxisExpansionRule>> {
  return isRecord(value) && Object.entries(value).every(([axis, rule]) =>
    (axis === "x" || axis === "y" || axis === "z") && isAxisExpansionRule(rule));
}

function applyBodyProportions(state: RigState, jointId: string, value: CompactJointProportions): void {
  const joint = state.getJoint(jointId);
  const parent = joint.parentJointId ? state.getJoint(joint.parentJointId) : null;
  if (value[5] !== undefined && parent && joint.id !== "pelvis-pivot") {
    const rest: Vector3Tuple = [value[1], value[2], value[5]];
    const posed = rotateVector(rest, quaternionFromEuler(joint.localRotationX ?? 0, joint.localRotationY ?? 0, joint.localRotation));
    joint.x = posed[0];
    joint.y = posed[1];
    joint.z = parent.z + posed[2];
    joint.baseOffset = { x: rest[0], y: rest[1], z: rest[2] };
    joint.baseDistance = Math.hypot(rest[0], rest[1]);
    joint.distancePercent = 100;
    state.setJointRadius(joint.id, value[3]);
    if (typeof value[4] === "number") state.setJointSideRadius(joint.id, value[4]);
  } else {
    state.applyJointProportions(jointId, { x: value[1], y: value[2], radius: value[3],
      ...(typeof value[4] === "number" ? { sideRadius: value[4] } : {}) });
  }
  if (value[6]) for (const [axis, length] of Object.entries(value[6])) {
    state.setJointCapsuleFlatLength(jointId, axis as "x" | "y" | "z", length!);
  }
  if (value[7]) for (const [axis, rule] of Object.entries(value[7])) {
    state.setAxisExpansionRule(
      { kind: "joint-capsule-axis", jointId, axis: axis as "x" | "y" | "z" },
      rule!.mode, rule!.fixedSide,
    );
  }
}
function isCompactEntries(value: unknown, minimumLength: number, valid: (entry: unknown[]) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  const seen = new Set<number>();
  return value.every((entry) => Array.isArray(entry) && entry.length >= minimumLength && Number.isInteger(entry[0])
    && entry[0] >= 0 && entry[0] < jointIds.length && !seen.has(entry[0]) && (seen.add(entry[0]), valid(entry)));
}
function isColors(value: unknown): value is NonNullable<RigPreset["colors"]> {
  return isRecord(value) && typeof value.defaultColor === "string" && Array.isArray(value.palette) && isRecord(value.joints) && isRecord(value.faces);
}
