export type AxisPointSide = -1 | 1;

export interface JointAxis {
  id: string;
  angle: number;
  /** Endpoint distance from the joint centre. Defaults to the joint radius. */
  length?: number;
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
  /** Z-axis movement. Positive values are closer to the viewer; defaults to 0. */
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
  /** Controls the joint circle and hidden-joint closing outline. Missing values are visible. */
  outlineVisible?: boolean;
  /** Allows connected faces to extend to their boundary intersection. Missing values are enabled. */
  faceExtensionEnabled?: boolean;
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

export type ArtShapeVertex =
  | { id: string; source: "self"; x: number; y: number }
  | { id: string; source: "root"; rootJointId: string; x: number; y: number }
  | { id: string; source: "joint-center"; jointId: string; offsetX: number; offsetY: number }
  | { id: string; source: "axis-point"; jointId: string; axisId: string; side: AxisPointSide; offsetX: number; offsetY: number };

export type ArtCompositeMode = "paint" | "cutout" | "overlay";

export interface ArtShape {
  id: string;
  kind: "polygon" | "line" | "circle";
  vertices: ArtShapeVertex[];
  /** Line thickness in model units. Used only when kind is line. */
  strokeWidth?: number;
  /** Horizontal and vertical radii for circle shapes. */
  radiusX?: number;
  radiusY?: number;
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
  /** 0..100: how strongly joint depth affects the rendered 2.5D projection. */
  projectionStrength: number;
  /** -90..90: camera rotation around the canvas' vertical (Y) axis. */
  viewYRotation: number;
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

export interface RigLimits {
  maxAxesPerJoint: number;
}

// The schema uses an array so this policy can be raised without another data migration.
export const DEFAULT_RIG_LIMITS: Readonly<RigLimits> = {
  maxAxesPerJoint: 8,
};
