export type AxisPointSide = -1 | 1;

export interface JointAxis {
  id: string;
  angle: number;
  pointSides: AxisPointSide[];
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
  bodyRadius?: number;
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

export interface Face {
  id: string;
  vertices: JointPointRef[];
  color?: string;
  orderOffset: number;
}

export interface Rig {
  defaultColor: string;
  joints: Joint[];
  peerGroups: PeerGroup[];
  faces: Face[];
}

export interface RigLimits {
  maxAxesPerJoint: number;
}

// The schema uses an array so this policy can be raised without another data migration.
export const DEFAULT_RIG_LIMITS: Readonly<RigLimits> = {
  maxAxesPerJoint: 2,
};
