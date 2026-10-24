export type AxisPointSide = -1 | 1;

export interface JointAxis {
  id: string;
  angle: number;
  pointSides: AxisPointSide[];
  /** Derives the axis from a connection direction or a reference-axis tangent. */
  alignment?: "parent-perpendicular" | "parent-parallel" | "parent-peer-perpendicular" | "parent-peer-parallel"
    | "reference-axis-outer-tangent";
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
  parentJointId?: string;
  /** Optional reference for automatically aligned axes, independent of the transform parent. */
  axisReferenceJointId?: string;
  /** Non-body transform control, such as a pelvis or scene pivot. */
  isVirtual?: boolean;
  radius: number;
  /** Optional radius used at a full left or right side view (±90°). */
  sideRadius?: number;
  /** Camera-relative depth. Positive values are closer to the viewer. */
  depth?: number;
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
}

export interface PeerGroup {
  id: string;
  jointIds: string[];
  /** Optional virtual parent used as the group's rotation center. */
  centerJointId?: string;
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

export interface Rig {
  defaultColor: string;
  /** 0..100: how strongly joint depth affects the rendered 2.5D projection. */
  projectionStrength: number;
  /** -90..90: camera rotation around the canvas' vertical (Y) axis. */
  viewYRotation: number;
  /** 0..50: minimum horizontal silhouette retained at a full side view. */
  silhouetteRetention: number;
  palette: ColorPaletteEntry[];
  groups: LayerGroup[];
  joints: Joint[];
  peerGroups: PeerGroup[];
  faces: Face[];
}

export interface RigLimits {
  maxAxesPerJoint: number;
}

// The schema uses an array so this policy can be raised without another data migration.
export const DEFAULT_RIG_LIMITS: Readonly<RigLimits> = {
  maxAxesPerJoint: 3,
};
