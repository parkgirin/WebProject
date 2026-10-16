export type AxisPointSide = -1 | 1;

export interface JointAxis {
  id: string;
  angle: number;
  pointSides: AxisPointSide[];
  /** Derives the axis from the parent connection, optionally through a peer-group center. */
  alignment?: "parent-perpendicular" | "parent-parallel" | "parent-peer-perpendicular" | "parent-peer-parallel";
}

export interface Joint {
  id: string;
  /** Parent-relative position. Root joints use world coordinates. */
  x: number;
  y: number;
  /** Rotation inherited by children, in degrees. */
  localRotation: number;
  parentJointId?: string;
  /** Non-body transform control, such as a pelvis or scene pivot. */
  isVirtual?: boolean;
  radius: number;
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
