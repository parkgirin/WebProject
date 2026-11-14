import type { PoseClip, PosePlaybackSettings } from "../rig/pose-interpolation.ts";
import type {
  ArtCompositeGroup,
  ArtShape,
  BodyViewProfiles,
  ColorPaletteEntry,
  ElementLayerVisibility,
  Face,
  Joint,
  JointAxis,
  LayerGroup,
  PeerGroup,
  Rig,
  SurfaceProfile,
} from "../rig/types.ts";
import { validateRig } from "../rig/rig-state.ts";

export type Quaternion = [x: number, y: number, z: number, w: number];
export type Vector3Tuple = [x: number, y: number, z: number];

export interface RigDefinition {
  id: string;
  family: string;
  version: number;
  rootJointId: string;
  joints: RigJointDefinition[];
  peerGroups: PeerGroup[];
  faces: RigFaceDefinition[];
}

export interface RigJointDefinition {
  id: string;
  parentId: string | null;
  parentAnchor?: Joint["parentAnchor"];
  axisReferenceJointId?: string;
  isVirtual?: boolean;
  axes: Array<Omit<JointAxis, "angle">>;
}

export type RigFaceDefinition = Pick<Face,
  "id" | "vertices" | "proceduralSurface" | "cameraFacingLimb" | "rotationTarget">;

export interface BodyDefinition {
  id: string;
  name: string;
  rigId: string;
  rigVersion: number;
  joints: Record<string, BodyJointDefinition>;
  bodyViewProfiles: BodyViewProfiles;
  surfaceProfiles: SurfaceProfile[];
}

export interface BodyJointDefinition {
  restOffset: Vector3Tuple;
  radius: number;
  sideRadius?: number;
  baseDistance?: number;
  baseZ?: number;
  bodyRadius?: number;
  surfaceProfileId?: string;
  surfaceScale?: { x: number; y: number; z: number };
  capsuleFlatAxes?: Array<"x" | "y" | "z">;
  capsuleFlatLengths?: Partial<Record<"x" | "y" | "z", number>>;
  capsuleFlatAlignment?: "peer-inward" | "peer-outward";
}

export interface PoseDefinition {
  rigId: string;
  rigVersion: number;
  root: { translation: Vector3Tuple; rotation: Quaternion };
  joints: Record<string, PoseJointDefinition>;
}

export interface PoseJointDefinition {
  /** Rotation taking the body's rest vector to the posed parent-relative vector. */
  offsetRotation: Quaternion;
  /** Full XYZ length multiplier. */
  lengthScale: number;
  /** Orientation inherited by descendants. */
  orientation: Quaternion;
  axisAngles: Record<string, number>;
}

export interface AppearanceDefinition {
  defaultColor: string;
  palette: ColorPaletteEntry[];
  groups: LayerGroup[];
  joints: Record<string, JointAppearance>;
  faces: Record<string, FaceAppearance>;
  artShapes: ArtShape[];
  artCompositeGroups: ArtCompositeGroup[];
  elementLayers?: ElementLayerVisibility;
}

export type JointAppearance = Pick<Joint,
  "color" | "paletteId" | "groupId" | "renderOrder" | "guideVisible" | "bodyVisible"
  | "outlineVisible" | "faceExtensionEnabled">;

export type FaceAppearance = Pick<Face,
  "color" | "paletteId" | "groupId" | "layerOrder" | "orderOffset">;

export interface OutputView {
  rotation: Quaternion;
  perspectiveEnabled: boolean;
  projectionStrength: number;
  transparentBackground: boolean;
}

export interface WorldTransformState {
  rotation: Quaternion;
}

export interface AnimationDefinition {
  id: string;
  name: string;
  rigId: string;
  fps: number;
  playback?: PosePlaybackSettings;
  poseTrack: { keys: PoseTrackKey[] };
  appearanceTrack?: { keys: AppearanceTrackKey[] };
  worldRotationTrack?: { pivot: "scene-root"; keys: WorldRotationTrackKey[] };
}

export interface PoseTrackKey {
  id: string;
  name: string;
  frame: number;
  pose: PoseDefinition;
}

export interface WorldRotationTrackKey {
  frame: number;
  rotation: Quaternion;
}

export interface AppearanceTrackKey {
  frame: number;
  appearance: AppearanceDefinition;
}

export interface ProjectDocument {
  format: "pose-mesh-project";
  version: 3;
  createdAt: string;
  rig: RigDefinition;
  body: BodyDefinition;
  pose: PoseDefinition;
  appearance: AppearanceDefinition;
  outputView: OutputView;
  worldTransform: WorldTransformState;
  animations: AnimationDefinition[];
}

export interface ProjectDocumentOptions {
  rigId?: string;
  rigFamily?: string;
  rigVersion?: number;
  bodyId?: string;
  bodyName?: string;
  animations?: PoseClip[];
  createdAt?: string;
}

const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];

export function createProjectDocument(rig: Rig, options: ProjectDocumentOptions = {}): ProjectDocument {
  const rigId = options.rigId ?? inferRigId(rig);
  const rigVersion = options.rigVersion ?? 1;
  const definition = createRigDefinition(rig, rigId, options.rigFamily ?? inferRigFamily(rig), rigVersion);
  const body = createBodyDefinition(rig, definition, options.bodyId ?? `${rigId}-body`, options.bodyName ?? "현재 신체");
  return {
    format: "pose-mesh-project",
    version: 3,
    createdAt: options.createdAt ?? new Date().toISOString(),
    rig: definition,
    body,
    pose: createPoseDefinition(rig, definition, body),
    appearance: createAppearanceDefinition(rig),
    outputView: {
      rotation: quaternionFromEuler(0, rig.viewYRotation, 0),
      perspectiveEnabled: rig.perspectiveEnabled !== false,
      projectionStrength: rig.projectionStrength,
      transparentBackground: true,
    },
    worldTransform: { rotation: quaternionFromEuler(
      rig.worldRotation?.x ?? 0, rig.worldRotation?.y ?? 0, rig.worldRotation?.z ?? 0,
    ) },
    animations: (options.animations ?? []).map((clip) => createAnimationDefinition(clip, definition, body)),
  };
}

export function serializeProjectDocument(project: ProjectDocument): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectDocument(text: string): ProjectDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("프로젝트 JSON 파일을 읽을 수 없습니다.");
  }
  if (!isRecord(value) || value.format !== "pose-mesh-project" || value.version !== 3
    || typeof value.createdAt !== "string" || !isRecord(value.rig) || !isRecord(value.body)
    || !isRecord(value.pose) || !isRecord(value.appearance) || !isRecord(value.outputView)
    || !isRecord(value.worldTransform) || !Array.isArray(value.animations)) {
    throw new Error("지원하지 않는 Pose Mesh Project 저장 파일입니다.");
  }
  const project = structuredClone(value) as unknown as ProjectDocument;
  if (typeof project.rig.id !== "string" || !project.rig.id.trim()
    || project.body.rigId !== project.rig.id || project.pose.rigId !== project.rig.id
    || project.body.rigVersion !== project.rig.version || project.pose.rigVersion !== project.rig.version) {
    throw new Error("프로젝트의 리그 호환 정보가 일치하지 않습니다.");
  }
  let errors: string[];
  try {
    errors = validateRig(materializeProjectRig(project));
  } catch {
    throw new Error("프로젝트 데이터 구조가 올바르지 않습니다.");
  }
  if (errors.length) throw new Error(`프로젝트 리그 데이터가 올바르지 않습니다: ${errors[0]}`);
  try {
    materializeProjectAnimations(project);
  } catch {
    throw new Error("프로젝트 애니메이션 데이터가 올바르지 않습니다.");
  }
  return project;
}

export function createRigDefinition(rig: Rig, id: string, family: string, version: number): RigDefinition {
  const root = rig.joints.find((joint) => !joint.parentJointId) ?? rig.joints[0];
  if (!root) throw new Error("리그에는 관절이 하나 이상 필요합니다.");
  return {
    id, family, version, rootJointId: root.id,
    joints: rig.joints.map((joint) => ({
      id: joint.id,
      parentId: joint.parentJointId ?? null,
      ...(joint.parentAnchor ? { parentAnchor: structuredClone(joint.parentAnchor) } : {}),
      ...(joint.axisReferenceJointId ? { axisReferenceJointId: joint.axisReferenceJointId } : {}),
      ...(joint.isVirtual !== undefined ? { isVirtual: joint.isVirtual } : {}),
      axes: joint.axes.map(({ angle: _angle, ...axis }) => structuredClone(axis)),
    })),
    peerGroups: structuredClone(rig.peerGroups),
    faces: rig.faces.map((face) => ({
      id: face.id,
      vertices: structuredClone(face.vertices),
      ...(face.proceduralSurface ? { proceduralSurface: face.proceduralSurface } : {}),
      ...(face.cameraFacingLimb ? { cameraFacingLimb: structuredClone(face.cameraFacingLimb) } : {}),
      rotationTarget: structuredClone(face.rotationTarget),
    })),
  };
}

export function createBodyDefinition(
  rig: Rig,
  definition: RigDefinition,
  id: string,
  name: string,
): BodyDefinition {
  return {
    id, name, rigId: definition.id, rigVersion: definition.version,
    joints: Object.fromEntries(rig.joints.map((joint) => {
      const parent = joint.parentJointId ? rig.joints.find((candidate) => candidate.id === joint.parentJointId) : undefined;
      const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: joint.z - (parent?.z ?? 0) };
      const bodyJoint: BodyJointDefinition = {
        restOffset: [rest.x, rest.y, rest.z],
        radius: joint.radius,
        ...(joint.sideRadius !== undefined ? { sideRadius: joint.sideRadius } : {}),
        ...(joint.parentJointId ? { baseDistance: vectorLength([rest.x, rest.y, rest.z]) } : {}),
        ...(joint.baseZ !== undefined ? { baseZ: joint.baseZ } : {}),
        ...(joint.bodyRadius !== undefined ? { bodyRadius: joint.bodyRadius } : {}),
        ...(joint.surfaceProfileId ? { surfaceProfileId: joint.surfaceProfileId } : {}),
        ...(joint.surfaceScale ? { surfaceScale: structuredClone(joint.surfaceScale) } : {}),
        ...(joint.capsuleFlatAxes ? { capsuleFlatAxes: [...joint.capsuleFlatAxes] } : {}),
        ...(joint.capsuleFlatLengths ? { capsuleFlatLengths: structuredClone(joint.capsuleFlatLengths) } : {}),
        ...(joint.capsuleFlatAlignment ? { capsuleFlatAlignment: joint.capsuleFlatAlignment } : {}),
      };
      return [joint.id, bodyJoint];
    })),
    bodyViewProfiles: structuredClone(rig.bodyViewProfiles),
    surfaceProfiles: structuredClone(rig.surfaceProfiles ?? []),
  };
}

export function createPoseDefinition(
  rig: Rig,
  definition: RigDefinition,
  body: BodyDefinition,
): PoseDefinition {
  const root = rig.joints.find((joint) => joint.id === definition.rootJointId);
  if (!root) throw new Error(`루트 관절을 찾을 수 없습니다: ${definition.rootJointId}`);
  const joints: Record<string, PoseJointDefinition> = {};
  for (const joint of rig.joints) {
    if (joint.id === root.id) continue;
    const parent = joint.parentJointId ? rig.joints.find((candidate) => candidate.id === joint.parentJointId) : undefined;
    const rest = body.joints[joint.id]?.restOffset;
    if (!rest) throw new Error(`신체 기준 관절을 찾을 수 없습니다: ${joint.id}`);
    const posed: Vector3Tuple = [joint.x, joint.y, joint.z - (parent?.z ?? 0)];
    const restLength = vectorLength(rest);
    const posedLength = vectorLength(posed);
    joints[joint.id] = {
      offsetRotation: restLength > 1e-9 && posedLength > 1e-9
        ? quaternionBetweenVectors(rest, posed) : [...IDENTITY_QUATERNION],
      lengthScale: restLength > 1e-9 ? posedLength / restLength : 1,
      orientation: quaternionFromEuler(joint.localRotationX ?? 0, joint.localRotationY ?? 0, joint.localRotation),
      axisAngles: Object.fromEntries(joint.axes.map((axis) => [axis.id, axis.angle])),
    };
  }
  return {
    rigId: definition.id,
    rigVersion: definition.version,
    root: {
      translation: [root.x, root.y, root.z],
      rotation: quaternionFromEuler(root.localRotationX ?? 0, root.localRotationY ?? 0, root.localRotation),
    },
    joints,
  };
}

export function createAppearanceDefinition(rig: Rig): AppearanceDefinition {
  return {
    defaultColor: rig.defaultColor,
    palette: structuredClone(rig.palette),
    groups: structuredClone(rig.groups),
    joints: Object.fromEntries(rig.joints.map((joint) => [joint.id, pickJointAppearance(joint)])),
    faces: Object.fromEntries(rig.faces.map((face) => [face.id, pickFaceAppearance(face)])),
    artShapes: structuredClone(rig.artShapes ?? []),
    artCompositeGroups: structuredClone(rig.artCompositeGroups ?? []),
    ...(rig.elementLayers ? { elementLayers: structuredClone(rig.elementLayers) } : {}),
  };
}

export function createAnimationDefinition(
  clip: PoseClip,
  definition: RigDefinition,
  body: BodyDefinition,
): AnimationDefinition {
  const poseKeys = clip.keys.map((key) => ({
    id: key.id,
    name: key.name,
    frame: key.frame,
    pose: createPoseDefinition(key.rig, definition, body),
  }));
  const worldKeys = clip.keys.map((key) => ({
    frame: key.frame,
    rotation: quaternionFromEuler(
      key.rig.worldRotation?.x ?? 0, key.rig.worldRotation?.y ?? 0, key.rig.worldRotation?.z ?? 0,
    ),
  }));
  const appearanceKeys = clip.keys.map((key) => ({
    frame: key.frame,
    appearance: createAppearanceDefinition(key.rig),
  }));
  const hasWorldRotation = worldKeys.some((key) => !quaternionApproximatelyEqual(key.rotation, IDENTITY_QUATERNION));
  return {
    id: clip.id,
    name: clip.name,
    rigId: definition.id,
    fps: clip.fps,
    ...(clip.playback ? { playback: structuredClone(clip.playback) } : {}),
    poseTrack: { keys: poseKeys },
    ...(appearanceKeys.length ? { appearanceTrack: { keys: appearanceKeys } } : {}),
    ...(hasWorldRotation ? { worldRotationTrack: { pivot: "scene-root" as const, keys: worldKeys } } : {}),
  };
}

/** Rebuild editable runtime clips from the separated project tracks. */
export function materializeProjectAnimations(project: ProjectDocument): PoseClip[] {
  return project.animations.map((animation): PoseClip => {
    if (animation.rigId !== project.rig.id || !Number.isFinite(animation.fps) || animation.fps <= 0) {
      throw new Error(`애니메이션 리그 호환 정보가 일치하지 않습니다: ${animation.id}`);
    }
    const frames = new Set<number>();
    const keys = animation.poseTrack.keys.map((key) => {
      if (!Number.isInteger(key.frame) || key.frame < 0 || frames.has(key.frame)) {
        throw new Error(`애니메이션 프레임이 올바르지 않습니다: ${animation.id}`);
      }
      frames.add(key.frame);
      const appearance = animation.appearanceTrack?.keys.find((entry) => entry.frame === key.frame)?.appearance
        ?? project.appearance;
      const worldRotation = animation.worldRotationTrack?.keys.find((entry) => entry.frame === key.frame)?.rotation
        ?? IDENTITY_QUATERNION;
      const keyProject: ProjectDocument = {
        ...project,
        pose: key.pose,
        appearance,
        worldTransform: { rotation: worldRotation },
        animations: [],
      };
      return { id: key.id, name: key.name, frame: key.frame, rig: materializeProjectRig(keyProject) };
    });
    return {
      id: animation.id,
      name: animation.name,
      fps: animation.fps,
      keys,
      ...(animation.playback ? { playback: structuredClone(animation.playback) } : {}),
    };
  });
}

/** Rebuild the current legacy runtime shape while the editor is migrated incrementally. */
export function materializeProjectRig(project: ProjectDocument): Rig {
  const jointDepths = new Map<string, number>();
  const joints = project.rig.joints.map((definition): Joint => {
    const body = project.body.joints[definition.id];
    if (!body) throw new Error(`신체 관절 데이터가 없습니다: ${definition.id}`);
    const appearance = project.appearance.joints[definition.id];
    if (!appearance) throw new Error(`관절 외형 데이터가 없습니다: ${definition.id}`);
    const pose = project.pose.joints[definition.id];
    const isRoot = definition.id === project.rig.rootJointId;
    const parentZ = definition.parentId ? jointDepths.get(definition.parentId) ?? 0 : 0;
    const offset = isRoot
      ? project.pose.root.translation
      : pose ? scaleVector(rotateVector(body.restOffset, pose.offsetRotation), pose.lengthScale)
        : body.restOffset;
    const orientation = quaternionToEuler(isRoot ? project.pose.root.rotation : pose?.orientation ?? IDENTITY_QUATERNION);
    const z = isRoot ? offset[2] : parentZ + offset[2];
    jointDepths.set(definition.id, z);
    return {
      id: definition.id,
      x: offset[0], y: offset[1], z,
      localRotation: orientation.z,
      localRotationX: orientation.x,
      localRotationY: orientation.y,
      ...(definition.parentId ? { parentJointId: definition.parentId } : {}),
      ...(definition.parentAnchor ? { parentAnchor: structuredClone(definition.parentAnchor) } : {}),
      ...(definition.axisReferenceJointId ? { axisReferenceJointId: definition.axisReferenceJointId } : {}),
      ...(definition.isVirtual !== undefined ? { isVirtual: definition.isVirtual } : {}),
      radius: body.radius,
      ...(body.sideRadius !== undefined ? { sideRadius: body.sideRadius } : {}),
      ...(body.baseDistance !== undefined ? { baseDistance: body.baseDistance } : {}),
      ...(body.baseDistance !== undefined && body.baseDistance > 1e-9 && !isRoot
        ? { distancePercent: vectorLength(offset) / body.baseDistance * 100 } : {}),
      ...(body.baseZ !== undefined ? { baseZ: body.baseZ } : {}),
      baseOffset: { x: body.restOffset[0], y: body.restOffset[1], z: body.restOffset[2] },
      ...(body.bodyRadius !== undefined ? { bodyRadius: body.bodyRadius } : {}),
      ...(body.surfaceProfileId ? { surfaceProfileId: body.surfaceProfileId } : {}),
      ...(body.surfaceScale ? { surfaceScale: structuredClone(body.surfaceScale) } : {}),
      ...(body.capsuleFlatAxes ? { capsuleFlatAxes: [...body.capsuleFlatAxes] } : {}),
      ...(body.capsuleFlatLengths ? { capsuleFlatLengths: structuredClone(body.capsuleFlatLengths) } : {}),
      ...(body.capsuleFlatAlignment ? { capsuleFlatAlignment: body.capsuleFlatAlignment } : {}),
      ...structuredClone(appearance),
      axes: definition.axes.map((axis) => ({
        ...structuredClone(axis),
        angle: pose?.axisAngles[axis.id] ?? 0,
      })),
    };
  });
  const faces = project.rig.faces.map((definition): Face => ({
    ...structuredClone(definition),
    ...structuredClone(project.appearance.faces[definition.id]),
  }));
  const viewEuler = quaternionToEuler(project.outputView.rotation);
  const worldEuler = quaternionToEuler(project.worldTransform.rotation);
  return {
    defaultColor: project.appearance.defaultColor,
    perspectiveEnabled: project.outputView.perspectiveEnabled,
    projectionStrength: project.outputView.projectionStrength,
    viewYRotation: viewEuler.y,
    worldRotation: worldEuler,
    bodyViewProfiles: structuredClone(project.body.bodyViewProfiles),
    surfaceProfiles: structuredClone(project.body.surfaceProfiles),
    palette: structuredClone(project.appearance.palette),
    groups: structuredClone(project.appearance.groups),
    joints,
    peerGroups: structuredClone(project.rig.peerGroups),
    faces,
    artShapes: structuredClone(project.appearance.artShapes),
    artCompositeGroups: structuredClone(project.appearance.artCompositeGroups),
    ...(project.appearance.elementLayers
      ? { elementLayers: structuredClone(project.appearance.elementLayers) } : {}),
  };
}

export function quaternionFromEuler(xDegrees: number, yDegrees: number, zDegrees: number): Quaternion {
  const x = xDegrees * Math.PI / 360;
  const y = yDegrees * Math.PI / 360;
  const z = zDegrees * Math.PI / 360;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  return normalizeQuaternion([
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]);
}

export function quaternionToEuler(value: Quaternion): { x: number; y: number; z: number } {
  const [x, y, z, w] = normalizeQuaternion(value);
  const sinX = 2 * (w * x + y * z);
  const cosX = 1 - 2 * (x * x + y * y);
  const sinY = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const sinZ = 2 * (w * z + x * y);
  const cosZ = 1 - 2 * (y * y + z * z);
  return {
    x: normalizeSignedDegrees(Math.atan2(sinX, cosX) * 180 / Math.PI),
    y: normalizeSignedDegrees(Math.asin(sinY) * 180 / Math.PI),
    z: normalizeSignedDegrees(Math.atan2(sinZ, cosZ) * 180 / Math.PI),
  };
}

export function rotateVector(vector: Vector3Tuple, rotation: Quaternion): Vector3Tuple {
  const [qx, qy, qz, qw] = normalizeQuaternion(rotation);
  const [x, y, z] = vector;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

function quaternionBetweenVectors(from: Vector3Tuple, to: Vector3Tuple): Quaternion {
  const a = normalizeVector(from);
  const b = normalizeVector(to);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (dot > 1 - 1e-10) return [...IDENTITY_QUATERNION];
  if (dot < -1 + 1e-10) {
    const perpendicular: Vector3Tuple = Math.abs(a[0]) < Math.abs(a[1])
      ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    const axis = normalizeVector(perpendicular);
    return [axis[0], axis[1], axis[2], 0];
  }
  const cross: Vector3Tuple = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  return normalizeQuaternion([cross[0], cross[1], cross[2], 1 + dot]);
}

function pickJointAppearance(joint: Joint): JointAppearance {
  return {
    ...(joint.color ? { color: joint.color } : {}),
    ...(joint.paletteId ? { paletteId: joint.paletteId } : {}),
    ...(joint.groupId ? { groupId: joint.groupId } : {}),
    renderOrder: joint.renderOrder,
    guideVisible: joint.guideVisible,
    bodyVisible: joint.bodyVisible,
    ...(joint.outlineVisible !== undefined ? { outlineVisible: joint.outlineVisible } : {}),
    ...(joint.faceExtensionEnabled !== undefined ? { faceExtensionEnabled: joint.faceExtensionEnabled } : {}),
  };
}

function pickFaceAppearance(face: Face): FaceAppearance {
  return {
    ...(face.color ? { color: face.color } : {}),
    ...(face.paletteId ? { paletteId: face.paletteId } : {}),
    ...(face.groupId ? { groupId: face.groupId } : {}),
    ...(face.layerOrder !== undefined ? { layerOrder: face.layerOrder } : {}),
    orderOffset: face.orderOffset,
  };
}

function inferRigId(rig: Rig): string {
  const ids = new Set(rig.joints.map((joint) => joint.id));
  if (ids.has("left-shoulder") && ids.has("right-ankle")) return "human-v1";
  if (ids.has("front-left-paw") && ids.has("hind-right-paw")) return "rabbit-v1";
  return `custom-${stableId([...ids].sort().join("|"))}`;
}

function inferRigFamily(rig: Rig): string {
  const ids = new Set(rig.joints.map((joint) => joint.id));
  if (ids.has("left-shoulder") && ids.has("right-hip")) return "humanoid";
  if (ids.has("front-left-paw") && ids.has("hind-right-paw")) return "quadruped";
  return "custom";
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function vectorLength(vector: Vector3Tuple): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalizeVector(vector: Vector3Tuple): Vector3Tuple {
  const length = vectorLength(vector);
  return length > 1e-12 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [1, 0, 0];
}

function scaleVector(vector: Vector3Tuple, scale: number): Vector3Tuple {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function normalizeQuaternion(value: Quaternion): Quaternion {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (length < 1e-12) return [...IDENTITY_QUATERNION];
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length];
}

function quaternionApproximatelyEqual(a: Quaternion, b: Quaternion): boolean {
  const direct = a.every((value, index) => Math.abs(value - b[index]) < 1e-9);
  const inverse = a.every((value, index) => Math.abs(value + b[index]) < 1e-9);
  return direct || inverse;
}

function normalizeSignedDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 1e-10 ? 0 : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
