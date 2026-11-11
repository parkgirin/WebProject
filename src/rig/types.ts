export type AxisPointSide = -1 | 1;

export interface JointAxis {
  id: string;
  angle: number;
  /** Endpoint distance from the joint centre. Defaults to the joint radius. */
  length?: number;
  pointSides: AxisPointSide[];
  /** Derives the axis from a connection direction or a reference-axis tangent. */
  alignment?: "parent-perpendicular" | "parent-parallel" | "parent-peer-perpendicular" | "parent-peer-parallel"
    | "child-perpendicular" | "reference-axis-outer-tangent";
  /** Reference-axis endpoint and this axis endpoint used by tangent alignment. */
  referenceAxisId?: string;
  referenceAxisSide?: AxisPointSide;
  alignedPointSide?: AxisPointSide;
}

export interface Joint {
  id: string;
  /** Parent-relative position. Root joints use world coordinates. */
  x: number;
  y: number;
  /** Rotation inherited by children, in degrees. */
  localRotation: number;
  /** Local single-axis rotations. Z remains localRotation for compatibility. */
  localRotationX?: number;
  localRotationY?: number;
  parentJointId?: string;
  /** Optional derived point on the parent used as this joint's transform origin. */
  parentAnchor?: { type: "capsule-end"; role: "outer" };
  /** Optional reference for automatically aligned axes, independent of the transform parent. */
  axisReferenceJointId?: string;
  /** Non-body transform control, such as a pelvis or scene pivot. */
  isVirtual?: boolean;
  radius: number;
  /** Optional reusable local surface outline for this otherwise generic joint. */
  surfaceProfileId?: string;
  /** Per-joint local scaling for a reusable surface profile. */
  surfaceScale?: { x: number; y: number; z: number };
  /** Up to two local axes can expose a flat capsule/rounded-rect span. */
  capsuleFlatAxes?: Array<"x" | "y" | "z">;
  capsuleFlatLengths?: Partial<Record<"x" | "y" | "z", number>>;
  /**
   * A peer-aligned capsule keeps this joint at one sphere and derives the
   * other sphere toward or away from the paired joint. Omitted capsules
   * remain centred on the joint transform.
   */
  capsuleFlatAlignment?: "peer-inward" | "peer-outward";
  /** Optional radius used at a full left or right side view (±90°). */
  sideRadius?: number;
  /** Local Z coordinate. Positive values are closer to the viewer. */
  z: number;
  /** Structural parent-relative distance supplied by the active body type. */
  baseDistance?: number;
  /** Pose-only multiplier of baseDistance. 100 keeps the body type's length. */
  distancePercent?: number;
  /** Temporary preview output size; migrate to a joint-bound ArtShape. */
  bodyRadius?: number;
  color?: string;
  /** Palette-linked paint remains live when its palette swatch changes. */
  paletteId?: string;
  groupId?: string;
  axes: JointAxis[];
  renderOrder: number;
  guideVisible: boolean;
  bodyVisible: boolean;
  /** Controls the joint circle and hidden-joint closing outline. Missing values are visible. */
  outlineVisible?: boolean;
  /** Allows connected faces to extend to their boundary intersection. Missing values are enabled. */
  faceExtensionEnabled?: boolean;
}

export type BodyViewId = "front" | "side" | "back";

/**
 * Per-view shape correction, kept separate from the skeletal pose. A value of
 * 1 retains the joint's current radius (or legacy sideRadius at side view).
 */
export interface BodyViewProfile {
  jointRadiusScale: Record<string, number>;
}

export type BodyViewProfiles = Record<BodyViewId, BodyViewProfile>;

const BODY_VIEW_IDS: readonly BodyViewId[] = ["front", "side", "back"];

export function createNeutralBodyViewProfiles(joints: readonly Joint[]): BodyViewProfiles {
  const jointRadiusScale = () => Object.fromEntries(joints.map((joint) => [joint.id, 1]));
  return {
    front: { jointRadiusScale: jointRadiusScale() },
    side: { jointRadiusScale: jointRadiusScale() },
    back: { jointRadiusScale: jointRadiusScale() },
  };
}

/** Migrates missing view data while preserving all existing body dimensions. */
export function normalizeBodyViewProfiles(rig: Pick<Rig, "joints"> & Partial<Pick<Rig, "bodyViewProfiles">>): void {
  const profiles = rig.bodyViewProfiles ??= createNeutralBodyViewProfiles(rig.joints);
  for (const view of BODY_VIEW_IDS) {
    const profile = profiles[view] ??= { jointRadiusScale: {} };
    profile.jointRadiusScale ??= {};
    for (const joint of rig.joints) profile.jointRadiusScale[joint.id] ??= 1;
  }
}

export interface PeerGroup {
  id: string;
  jointIds: string[];
  /** Optional virtual parent used as the group's rotation center. */
  centerJointId?: string;
  /** Draw the two member spheres and their camera-facing bridge as one derived capsule. */
  virtualCapsule?: boolean;
}

export interface JointPointRef {
  jointId: string;
  axisId: string;
  side: AxisPointSide;
}

export type FaceRotationTarget =
  | { type: "child"; childJointId: string }
  | { type: "peer"; peerGroupId: string; referenceJointId: string };

export interface Face {
  id: string;
  vertices: JointPointRef[];
  /** Procedural surfaces retain face styling/selection without authored axis endpoints. */
  proceduralSurface?: "torso" | "peer-capsule" | "waist-hip";
  /**
   * Renders this face from the camera-facing great circles of the two joint
   * spheres. The authored axis points remain available for editing and for
   * legacy connections; only the rendered boundary is view dependent.
   */
  cameraFacingLimb?: {
    startJointId: string;
    endJointId: string;
  };
  rotationTarget: FaceRotationTarget;
  color?: string;
  paletteId?: string;
  groupId?: string;
  /** Explicit order inside the assigned layer group. */
  layerOrder?: number;
  orderOffset: number;
}

export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

export interface ColorPaletteEntry {
  id: string;
  color: string;
}

export type ArtShapeVertex =
  | { id: string; source: "self"; x: number; y: number }
  | { id: string; source: "root"; rootJointId: string; x: number; y: number }
  | { id: string; source: "joint-center"; jointId: string; offsetX: number; offsetY: number }
  | { id: string; source: "axis-point"; jointId: string; axisId: string; side: AxisPointSide; offsetX: number; offsetY: number };

export type ArtCompositeMode = "paint" | "cutout" | "overlay";

export interface ArtShape {
  id: string;
  kind: "polygon" | "line" | "circle" | "sphere";
  vertices: ArtShapeVertex[];
  /** Line thickness in model units. Used only when kind is line. */
  strokeWidth?: number;
  /** Horizontal and vertical radii for circle shapes. */
  radiusX?: number;
  radiusY?: number;
  /** Model-space radius for a camera-facing 3D sphere. */
  radius?: number;
  color?: string;
  paletteId?: string;
  groupId?: string;
  layerOrder: number;
  /** Missing values from older files are treated as paint. */
  compositeMode?: ArtCompositeMode;
  /** Editing-only composition identity, independent from the output layer group. */
  compositeGroupId?: string;
}

export interface ArtCompositeGroup {
  id: string;
  /** Parent composition. Missing values make this a root output group. */
  parentGroupId?: string;
  /** Operation used when this group's result participates in its parent. */
  compositeMode?: ArtCompositeMode;
}

export type ElementLayerId = "joints" | "axes" | "faces" | "shapes";

export type ElementLayerVisibility = Record<ElementLayerId, boolean>;

export interface Rig {
  defaultColor: string;
  /** False uses orthographic size while retaining camera rotation and depth ordering. Defaults to true. */
  perspectiveEnabled?: boolean;
  /** 0..100: how strongly camera-space Z affects the rendered 2.5D projection. */
  projectionStrength: number;
  /** -180..180: camera rotation around the canvas' vertical (Y) axis. */
  viewYRotation: number;
  /** Scene transform, kept separate from character pose and pose animation. */
  worldRotation?: { x: number; y: number; z: number };
  /** Independent body-shape corrections for front, side, and back views. */
  bodyViewProfiles: BodyViewProfiles;
  surfaceProfiles?: SurfaceProfile[];
  palette: ColorPaletteEntry[];
  groups: LayerGroup[];
  joints: Joint[];
  peerGroups: PeerGroup[];
  faces: Face[];
  artShapes?: ArtShape[];
  artCompositeGroups?: ArtCompositeGroup[];
  /** Photo-editor style global visibility for each element category. */
  elementLayers?: ElementLayerVisibility;
}

/** A normalized XY outline extruded symmetrically along local Z. */
export interface SurfaceProfile {
  id: string;
  outline: Array<{ x: number; y: number }>;
  depthScale: number;
}

export interface RigLimits {
  maxAxesPerJoint: number;
}

// The schema uses an array so this policy can be raised without another data migration.
export const DEFAULT_RIG_LIMITS: Readonly<RigLimits> = {
  maxAxesPerJoint: 8,
};
