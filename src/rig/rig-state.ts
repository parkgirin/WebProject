import {
  DEFAULT_RIG_LIMITS,
  type AxisPointSide,
  type ArtCompositeMode,
  type ArtShape,
  type ArtShapeVertex,
  type ElementLayerId,
  normalizeBodyViewProfiles,
  type Rig,
  type RigLimits,
} from "./types.ts";
import {
  getAxisPoint,
  getArtShapeVertexPoint,
  getCircleTangentPoints,
  getJointWorldTransform,
  getPeerGroupCentroid,
  getPeerGroupPivot,
  normalizeAngle,
} from "./geometry.ts";

const VALID_SIDES = new Set<AxisPointSide>([-1, 1]);

/**
 * Migrates documents written before z became a required coordinate.
 * Only an omitted legacy value is repaired; malformed values remain for
 * validateRig to report.
 */
export function normalizeRigZCoordinates(rig: Rig): void {
  for (const joint of rig.joints) {
    const legacyJoint = joint as unknown as { z?: number; depth?: number };
    if (legacyJoint.z === undefined) legacyJoint.z = legacyJoint.depth ?? 0;
    delete legacyJoint.depth;
  }
}

/**
 * Upgrades the stock limb faces in documents saved before their rendered
 * boundary became camera-facing. It deliberately recognizes only the eight
 * canonical ids, leaving custom faces and their authored axis endpoints
 * untouched.
 */
export function normalizeCameraFacingLimbFaces(rig: Rig): void {
  const endpoints: Record<string, readonly [string, string]> = {
    "left-upper-arm": ["left-shoulder", "left-elbow"],
    "left-lower-arm": ["left-elbow", "left-wrist"],
    "right-upper-arm": ["right-shoulder", "right-elbow"],
    "right-lower-arm": ["right-elbow", "right-wrist"],
    "left-upper-leg": ["left-hip", "left-knee"],
    "left-lower-leg": ["left-knee", "left-ankle"],
    "right-upper-leg": ["right-hip", "right-knee"],
    "right-lower-leg": ["right-knee", "right-ankle"],
  };
  const jointIds = new Set(rig.joints.map((joint) => joint.id));
  for (const face of rig.faces) {
    if (face.cameraFacingLimb) continue;
    const pair = endpoints[face.id];
    if (pair && pair.every((jointId) => jointIds.has(jointId))) {
      face.cameraFacingLimb = { startJointId: pair[0], endJointId: pair[1] };
    }
  }
}

/** Adds the generic waist profile to documents created before profiles existed. */
export function normalizeSurfaceProfiles(rig: Rig): void {
  const profiles = rig.surfaceProfiles ??= [];
  for (const profile of profiles) if (profile.id === "waist-flat") profile.id = "rounded-rect";
  for (const joint of rig.joints) if (joint.surfaceProfileId === "waist-flat") joint.surfaceProfileId = "rounded-rect";
  if (!profiles.some((profile) => profile.id === "rounded-rect")) {
    profiles.push({ id: "rounded-rect", depthScale: 1, outline: [
      { x: -1, y: -.55 }, { x: .55, y: -1 }, { x: 1, y: -.55 }, { x: 1, y: .55 },
      { x: .55, y: 1 }, { x: -.55, y: 1 }, { x: -1, y: .55 },
    ] });
  }
  const waist = rig.joints.find((joint) => joint.id === "waist");
  if (!waist) return;
  waist.surfaceProfileId ??= "rounded-rect";
  if (!waist.surfaceScale) {
    const limbRadius = rig.joints.find((joint) => joint.id === "left-shoulder")?.radius ?? waist.radius;
    waist.surfaceScale = { x: 1, y: 1, z: limbRadius / waist.radius };
  }
  waist.capsuleFlatAxes ??= ["x"];
  waist.capsuleFlatLengths ??= { x: waist.radius };
  waist.capsuleFlatLengths.x ??= waist.radius;
}

export interface PolygonDraftPoint {
  x: number;
  y: number;
  axisPoint?: { jointId: string; axisId: string; side: AxisPointSide };
}

export function validateRig(
  rig: Rig,
  limits: Readonly<RigLimits> = DEFAULT_RIG_LIMITS,
): string[] {
  const errors: string[] = [];
  const jointIds = new Set<string>();
  const faceIds = new Set<string>();
  const shapeIds = new Set<string>();
  const groupIds = new Set<string>();
  const paletteIds = new Set<string>();
  if (rig.elementLayers && ["joints", "axes", "faces", "shapes"].some((key) => (
    typeof rig.elementLayers![key as ElementLayerId] !== "boolean"
  ))) errors.push("Invalid element layer visibility");

  if (!isHexColor(rig.defaultColor)) {
    errors.push(`Invalid default color: ${rig.defaultColor}`);
  }
  if (!Number.isFinite(rig.projectionStrength) || rig.projectionStrength < 0 || rig.projectionStrength > 100) {
    errors.push(`Projection strength must be between 0 and 100: ${rig.projectionStrength}`);
  }
  if (!Number.isFinite(rig.viewYRotation) || rig.viewYRotation < -180 || rig.viewYRotation > 180) {
    errors.push(`View Y rotation must be between -180 and 180: ${rig.viewYRotation}`);
  }
  for (const view of ["front", "side", "back"] as const) {
    const profile = rig.bodyViewProfiles?.[view];
    if (!profile || !profile.jointRadiusScale) {
      errors.push(`Missing body view profile: ${view}`);
      continue;
    }
    for (const [jointId, scale] of Object.entries(profile.jointRadiusScale)) {
      if (!Number.isFinite(scale) || scale <= 0) errors.push(`Invalid body view radius scale: ${view}.${jointId}`);
    }
  }
  for (const entry of rig.palette) {
    if (!entry.id.trim()) errors.push("Palette id cannot be empty");
    if (paletteIds.has(entry.id)) errors.push(`Duplicate palette id: ${entry.id}`);
    if (!isHexColor(entry.color)) errors.push(`Invalid palette color: ${entry.id}.${entry.color}`);
    paletteIds.add(entry.id);
  }

  for (const group of rig.groups) {
    if (!group.id.trim()) errors.push("Layer group id cannot be empty");
    if (!group.name.trim()) errors.push(`Layer group name cannot be empty: ${group.id}`);
    if (groupIds.has(group.id)) errors.push(`Duplicate layer group id: ${group.id}`);
    if (!Number.isFinite(group.order)) errors.push(`Layer group order must be finite: ${group.id}`);
    groupIds.add(group.id);
  }

  for (const joint of rig.joints) {
    if (jointIds.has(joint.id)) {
      errors.push(`Duplicate joint id: ${joint.id}`);
    }
    jointIds.add(joint.id);

    if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y)) {
      errors.push(`Joint position must be finite: ${joint.id}`);
    }
    if (!Number.isFinite(joint.localRotation)) {
      errors.push(`Joint local rotation must be finite: ${joint.id}`);
    }
    if (!Number.isFinite(joint.renderOrder)) {
      errors.push(`Joint render order must be finite: ${joint.id}`);
    }
    if (joint.outlineVisible !== undefined && typeof joint.outlineVisible !== "boolean") {
      errors.push(`Invalid joint outline visibility: ${joint.id}`);
    }
    if (joint.faceExtensionEnabled !== undefined && typeof joint.faceExtensionEnabled !== "boolean") {
      errors.push(`Invalid joint face extension: ${joint.id}`);
    }
    if (joint.groupId && !groupIds.has(joint.groupId)) {
      errors.push(`Unknown joint layer group: ${joint.id}.${joint.groupId}`);
    }

    if (!(joint.radius > 0)) {
      errors.push(`Joint radius must be positive: ${joint.id}`);
    }
    if (joint.sideRadius !== undefined && !(joint.sideRadius > 0)) {
      errors.push(`Joint side radius must be positive: ${joint.id}`);
    }
    if (!Number.isFinite(joint.z)) {
      errors.push(`Joint z coordinate must be finite: ${joint.id}`);
    }
    if (joint.bodyRadius !== undefined && !(joint.bodyRadius > 0)) {
      errors.push(`Joint body radius must be positive: ${joint.id}`);
    }
    if (joint.color !== undefined && !isHexColor(joint.color)) {
      errors.push(`Invalid joint color: ${joint.id}.${joint.color}`);
    }
    if (joint.paletteId && !paletteIds.has(joint.paletteId)) errors.push(`Unknown joint palette: ${joint.id}.${joint.paletteId}`);
    if (joint.axes.length > limits.maxAxesPerJoint) {
      errors.push(
        `Joint ${joint.id} has ${joint.axes.length} axes; current limit is ${limits.maxAxesPerJoint}`,
      );
    }

    const axisIds = new Set<string>();
    for (const axis of joint.axes) {
      if (axisIds.has(axis.id)) {
        errors.push(`Duplicate axis id: ${joint.id}.${axis.id}`);
      }
      axisIds.add(axis.id);
      if (axis.length !== undefined && (!(axis.length > 0) || !Number.isFinite(axis.length))) {
        errors.push(`Axis length must be positive: ${joint.id}.${axis.id}`);
      }

      const sides = new Set<AxisPointSide>();
      for (const side of axis.pointSides) {
        if (!VALID_SIDES.has(side)) {
          errors.push(`Invalid axis point side: ${joint.id}.${axis.id}[${side}]`);
        } else if (sides.has(side)) {
          errors.push(`Duplicate axis point side: ${joint.id}.${axis.id}[${side}]`);
        }
        sides.add(side);
      }
    }
  }

  for (const joint of rig.joints) {
    if (joint.parentJointId && !jointIds.has(joint.parentJointId)) {
      errors.push(`Unknown parent joint: ${joint.id}.${joint.parentJointId}`);
    }
    if (joint.axisReferenceJointId && !jointIds.has(joint.axisReferenceJointId)) errors.push(`Unknown axis reference joint: ${joint.id}.${joint.axisReferenceJointId}`);
    for (const axis of joint.axes) {
      if (axis.alignment !== "reference-axis-outer-tangent") continue;
      const referenceJointId = joint.axisReferenceJointId ?? joint.parentJointId;
      const referenceJoint = rig.joints.find((candidate) => candidate.id === referenceJointId);
      const referenceAxis = referenceJoint?.axes.find((candidate) => candidate.id === axis.referenceAxisId);
      if (!referenceJointId) errors.push(`Tangent axis needs a reference joint: ${joint.id}.${axis.id}`);
      else if (referenceJoint && !referenceAxis) errors.push(`Unknown tangent reference axis: ${joint.id}.${axis.id}.${axis.referenceAxisId ?? ""}`);
      if (!VALID_SIDES.has(axis.referenceAxisSide as AxisPointSide)
        || (referenceAxis && !referenceAxis.pointSides.includes(axis.referenceAxisSide!))) {
        errors.push(`Invalid tangent reference side: ${joint.id}.${axis.id}`);
      }
      if (!VALID_SIDES.has(axis.alignedPointSide as AxisPointSide)
        || !axis.pointSides.includes(axis.alignedPointSide!)) {
        errors.push(`Invalid tangent aligned side: ${joint.id}.${axis.id}`);
      }
      if (!rig.peerGroups.some((group) => group.jointIds.includes(joint.id))) {
        errors.push(`Tangent axis needs a peer group: ${joint.id}.${axis.id}`);
      }
    }
    const ancestors = new Set<string>([joint.id]);
    let parentId = joint.parentJointId;
    while (parentId) {
      if (ancestors.has(parentId)) {
        errors.push(`Parent cycle: ${joint.id}`);
        break;
      }
      ancestors.add(parentId);
      parentId = rig.joints.find((candidate) => candidate.id === parentId)?.parentJointId;
    }
  }

  const peerGroupIds = new Set<string>();
  for (const group of rig.peerGroups) {
    if (peerGroupIds.has(group.id)) errors.push(`Duplicate peer group id: ${group.id}`);
    peerGroupIds.add(group.id);
    if (group.jointIds.length < 2) errors.push(`Peer group needs two joints: ${group.id}`);
    const members = new Set<string>();
    for (const jointId of group.jointIds) {
      if (!jointIds.has(jointId)) errors.push(`Unknown peer joint: ${group.id}.${jointId}`);
      if (members.has(jointId)) errors.push(`Duplicate peer joint: ${group.id}.${jointId}`);
      members.add(jointId);
    }
    if (group.centerJointId) {
      const center = rig.joints.find((joint) => joint.id === group.centerJointId);
      if (!center?.isVirtual) errors.push(`Peer center must be a virtual joint: ${group.id}.${group.centerJointId}`);
      if (members.has(group.centerJointId)) errors.push(`Peer center cannot be a member: ${group.id}`);
    }
  }

  for (const face of rig.faces) {
    if (faceIds.has(face.id)) {
      errors.push(`Duplicate face id: ${face.id}`);
    }
    faceIds.add(face.id);

    if (face.color !== undefined && !isHexColor(face.color)) {
      errors.push(`Invalid face color: ${face.id}.${face.color}`);
    }
    if (face.paletteId && !paletteIds.has(face.paletteId)) errors.push(`Unknown face palette: ${face.id}.${face.paletteId}`);
    if (!Number.isFinite(face.orderOffset)) {
      errors.push(`Face order offset must be finite: ${face.id}`);
    }
    if (face.layerOrder !== undefined && !Number.isFinite(face.layerOrder)) {
      errors.push(`Face layer order must be finite: ${face.id}`);
    }
    if (face.groupId && !groupIds.has(face.groupId)) {
      errors.push(`Unknown face layer group: ${face.id}.${face.groupId}`);
    }
    if (face.cameraFacingLimb) {
      for (const jointId of [face.cameraFacingLimb.startJointId, face.cameraFacingLimb.endJointId]) {
        if (!rig.joints.some((joint) => joint.id === jointId)) {
          errors.push(`Unknown camera-facing limb joint: ${face.id}.${jointId}`);
        }
      }
      if (face.cameraFacingLimb.startJointId === face.cameraFacingLimb.endJointId) {
        errors.push(`Camera-facing limb needs two joints: ${face.id}`);
      }
    }
    const rotationTarget = face.rotationTarget;
    if (rotationTarget.type === "child") {
      const child = rig.joints.find((joint) => joint.id === rotationTarget.childJointId);
      if (!child) {
        errors.push(`Unknown face rotation child: ${face.id}.${rotationTarget.childJointId}`);
      } else if (!child.parentJointId) {
        errors.push(`Face rotation child needs a parent: ${face.id}.${child.id}`);
      }
    } else {
      const group = rig.peerGroups.find((candidate) => candidate.id === rotationTarget.peerGroupId);
      if (!group) {
        errors.push(`Unknown face rotation peer group: ${face.id}.${rotationTarget.peerGroupId}`);
      } else if (!group.jointIds.includes(rotationTarget.referenceJointId)) {
        errors.push(`Face rotation reference is not in peer group: ${face.id}.${rotationTarget.referenceJointId}`);
      }
    }

    for (const vertex of face.vertices) {
      const joint = rig.joints.find((candidate) => candidate.id === vertex.jointId);
      const axis = joint?.axes.find((candidate) => candidate.id === vertex.axisId);
      if (!joint) {
        errors.push(`Face ${face.id} references unknown joint: ${vertex.jointId}`);
      } else if (!axis) {
        errors.push(
          `Face ${face.id} references unknown axis: ${vertex.jointId}.${vertex.axisId}`,
        );
      } else if (!axis.pointSides.includes(vertex.side)) {
        errors.push(
          `Face ${face.id} references inactive point: ${vertex.jointId}.${vertex.axisId}[${vertex.side}]`,
        );
      }
    }
  }

  for (const shape of rig.artShapes ?? []) {
    if (!shape.id.trim() || shapeIds.has(shape.id)) errors.push(`Invalid or duplicate art shape id: ${shape.id}`);
    shapeIds.add(shape.id);
    if (shape.kind === "polygon" && shape.vertices.length < 3) errors.push(`Art shape needs at least three vertices: ${shape.id}`);
    if (shape.kind === "line" && (shape.vertices.length !== 2 || !(shape.strokeWidth! > 0) || !Number.isFinite(shape.strokeWidth))) {
      errors.push(`Art line needs two vertices and a positive width: ${shape.id}`);
    }
    if (shape.kind === "circle" && (shape.vertices.length !== 1 || !(shape.radiusX! > 0) || !(shape.radiusY! > 0)
      || !Number.isFinite(shape.radiusX) || !Number.isFinite(shape.radiusY))) errors.push(`Art circle needs one center and positive radii: ${shape.id}`);
    if (shape.kind !== "polygon" && shape.kind !== "line" && shape.kind !== "circle") errors.push(`Unknown art shape kind: ${shape.id}`);
    if (!Number.isFinite(shape.layerOrder)) errors.push(`Art shape layer order must be finite: ${shape.id}`);
    if (shape.color !== undefined && !isHexColor(shape.color)) errors.push(`Invalid art shape color: ${shape.id}.${shape.color}`);
    if (shape.paletteId && !paletteIds.has(shape.paletteId)) errors.push(`Unknown art shape palette: ${shape.id}.${shape.paletteId}`);
    if (shape.groupId && !groupIds.has(shape.groupId)) errors.push(`Unknown art shape layer group: ${shape.id}.${shape.groupId}`);
    if (shape.compositeMode !== undefined && shape.compositeMode !== "paint"
      && shape.compositeMode !== "cutout" && shape.compositeMode !== "overlay") {
      errors.push(`Invalid art shape composite mode: ${shape.id}`);
    }
    if (shape.compositeMode === "cutout" && shape.kind === "line") errors.push(`Art lines cannot be cutouts: ${shape.id}`);
    if (shape.compositeGroupId !== undefined && !shape.compositeGroupId.trim()) errors.push(`Invalid art shape composite group: ${shape.id}`);
    const vertexIds = new Set<string>();
    for (const vertex of shape.vertices) {
      if (!vertex.id.trim() || vertexIds.has(vertex.id)) errors.push(`Invalid art shape vertex id: ${shape.id}.${vertex.id}`);
      vertexIds.add(vertex.id);
      if (vertex.source === "self" && (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) errors.push(`Invalid self vertex: ${shape.id}.${vertex.id}`);
      if (vertex.source === "root") {
        if (!jointIds.has(vertex.rootJointId) || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) errors.push(`Invalid root vertex: ${shape.id}.${vertex.id}`);
      }
      if (vertex.source === "joint-center") {
        if (!jointIds.has(vertex.jointId) || !Number.isFinite(vertex.offsetX) || !Number.isFinite(vertex.offsetY)) errors.push(`Invalid joint-center vertex: ${shape.id}.${vertex.id}`);
      }
      if (vertex.source === "axis-point") {
        const joint = rig.joints.find((candidate) => candidate.id === vertex.jointId);
        const axis = joint?.axes.find((candidate) => candidate.id === vertex.axisId);
        if (!axis || !axis.pointSides.includes(vertex.side) || !Number.isFinite(vertex.offsetX) || !Number.isFinite(vertex.offsetY)) {
          errors.push(`Invalid axis-point vertex: ${shape.id}.${vertex.id}`);
        }
      }
    }
  }

  const compositeGroupIds = new Set<string>();
  for (const group of rig.artCompositeGroups ?? []) {
    if (!group.id.trim() || compositeGroupIds.has(group.id)) errors.push(`Invalid or duplicate art composite group: ${group.id}`);
    compositeGroupIds.add(group.id);
    if (group.compositeMode !== undefined && group.compositeMode !== "paint"
      && group.compositeMode !== "cutout" && group.compositeMode !== "overlay") {
      errors.push(`Invalid art composite group mode: ${group.id}`);
    }
  }
  for (const group of rig.artCompositeGroups ?? []) {
    if (group.parentGroupId && !compositeGroupIds.has(group.parentGroupId)) errors.push(`Unknown art composite parent: ${group.id}.${group.parentGroupId}`);
    const ancestors = new Set([group.id]);
    let parentId = group.parentGroupId;
    while (parentId) {
      if (ancestors.has(parentId)) {
        errors.push(`Art composite group cycle: ${group.id}`);
        break;
      }
      ancestors.add(parentId);
      parentId = rig.artCompositeGroups?.find((candidate) => candidate.id === parentId)?.parentGroupId;
    }
  }

  return errors;
}

export class RigState {
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: Rig[] = [];
  private readonly redoStack: Rig[] = [];
  private lastSnapshot: Rig;
  private transactionStart: Rig | null = null;
  private restoringHistory = false;

  public constructor(
    public readonly rig: Rig,
    public readonly limits: Readonly<RigLimits> = DEFAULT_RIG_LIMITS,
  ) {
    normalizeRigZCoordinates(rig);
    normalizeBodyViewProfiles(rig);
    normalizeCameraFacingLimbFaces(rig);
    normalizeSurfaceProfiles(rig);
    rig.artShapes ??= [];
    rig.artCompositeGroups ??= [];
    rig.elementLayers ??= { joints: true, axes: true, faces: true, shapes: true };
    for (const joint of rig.joints) {
      if (!joint.parentJointId) continue;
      joint.baseDistance ??= Math.hypot(joint.x, joint.y);
      joint.distancePercent ??= 100;
    }
    const errors = validateRig(rig, limits);
    if (errors.length > 0) {
      throw new Error(`Invalid rig:\n${errors.join("\n")}`);
    }
    for (const joint of rig.joints) this.alignDirectConnectionAxes(joint.id);
    this.alignShoulderBandAxes();
    this.lastSnapshot = cloneRig(rig);
  }

  public get canUndo(): boolean { return this.undoStack.length > 0; }
  public get canRedo(): boolean { return this.redoStack.length > 0; }

  public beginHistoryTransaction(): void {
    if (!this.transactionStart) this.transactionStart = cloneRig(this.rig);
  }

  public endHistoryTransaction(): void {
    if (!this.transactionStart) return;
    const current = cloneRig(this.rig);
    if (!sameRig(this.transactionStart, current)) {
      this.undoStack.push(this.transactionStart);
      this.redoStack.length = 0;
      this.trimHistory();
    }
    this.transactionStart = null;
    this.lastSnapshot = current;
    this.emit();
  }

  public undo(): void {
    this.endOpenTransactionWithoutEmit();
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneRig(this.rig));
    this.restore(previous);
  }

  public redo(): void {
    this.endOpenTransactionWithoutEmit();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneRig(this.rig));
    this.restore(next);
  }

  public getJoint(jointId: string) {
    const joint = this.rig.joints.find((candidate) => candidate.id === jointId);
    if (!joint) {
      throw new Error(`Unknown joint: ${jointId}`);
    }
    return joint;
  }

  public getFace(faceId: string) {
    const face = this.rig.faces.find((candidate) => candidate.id === faceId);
    if (!face) {
      throw new Error(`Unknown face: ${faceId}`);
    }
    return face;
  }

  public getArtShape(shapeId: string) {
    const shape = this.rig.artShapes?.find((candidate) => candidate.id === shapeId);
    if (!shape) throw new Error(`Unknown art shape: ${shapeId}`);
    return shape;
  }

  public addPolygon(points: PolygonDraftPoint[], rootJointId = "scene-root"): string {
    if (points.length < 3) throw new Error("다각형에는 3개 이상의 꼭짓점이 필요합니다.");
    const root = this.getJoint(rootJointId);
    let index = (this.rig.artShapes?.length ?? 0) + 1;
    let id = `polygon-${index}`;
    while (this.rig.artShapes?.some((shape) => shape.id === id)) id = `polygon-${++index}`;
    const vertices = points.map((point, vertexIndex): ArtShapeVertex => point.axisPoint
      ? { id: `vertex-${vertexIndex + 1}`, source: "axis-point", ...point.axisPoint, offsetX: 0, offsetY: 0 }
      : { id: `vertex-${vertexIndex + 1}`, source: "root", rootJointId, ...this.worldToLocal(root.id, point.x, point.y) });
    const maxOrder = Math.max(0, ...this.getBodyStackEntries().map((entry) => entry.order));
    this.rig.artShapes ??= [];
    this.rig.artShapes.push({ id, kind: "polygon", vertices, layerOrder: clampLayerValue(maxOrder + 1), compositeMode: "paint", compositeGroupId: `composite-${id}` });
    this.notify();
    return id;
  }

  public addLine(points: PolygonDraftPoint[], strokeWidth = 16, rootJointId = "scene-root"): string {
    if (points.length !== 2) throw new Error("선분에는 두 개의 끝점이 필요합니다.");
    if (!(strokeWidth > 0) || !Number.isFinite(strokeWidth)) throw new Error("선분 두께는 0보다 커야 합니다.");
    const root = this.getJoint(rootJointId);
    let index = (this.rig.artShapes?.filter((shape) => shape.kind === "line").length ?? 0) + 1;
    let id = `line-${index}`;
    while (this.rig.artShapes?.some((shape) => shape.id === id)) id = `line-${++index}`;
    const vertices = points.map((point, vertexIndex): ArtShapeVertex => point.axisPoint
      ? { id: `vertex-${vertexIndex + 1}`, source: "axis-point", ...point.axisPoint, offsetX: 0, offsetY: 0 }
      : { id: `vertex-${vertexIndex + 1}`, source: "root", rootJointId, ...this.worldToLocal(root.id, point.x, point.y) });
    const maxOrder = Math.max(0, ...this.getBodyStackEntries().map((entry) => entry.order));
    this.rig.artShapes ??= [];
    this.rig.artShapes.push({ id, kind: "line", vertices, strokeWidth, layerOrder: clampLayerValue(maxOrder + 1), compositeMode: "paint", compositeGroupId: `composite-${id}` });
    this.notify();
    return id;
  }

  public addCircle(x: number, y: number, radius = 36, rootJointId = "scene-root"): string {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(radius > 0)) throw new Error("원의 중심과 반지름이 올바르지 않습니다.");
    const root = this.getJoint(rootJointId);
    let index = (this.rig.artShapes?.filter((shape) => shape.kind === "circle").length ?? 0) + 1;
    let id = `circle-${index}`;
    while (this.rig.artShapes?.some((shape) => shape.id === id)) id = `circle-${++index}`;
    const maxOrder = Math.max(0, ...this.getBodyStackEntries().map((entry) => entry.order));
    this.rig.artShapes ??= [];
    this.rig.artShapes.push({ id, kind: "circle", vertices: [{ id: "center", source: "root", rootJointId, ...this.worldToLocal(root.id, x, y) }], radiusX: radius, radiusY: radius, layerOrder: clampLayerValue(maxOrder + 1), compositeMode: "paint", compositeGroupId: `composite-${id}` });
    this.notify();
    return id;
  }

  public addArtShapeFromFace(faceId: string): string {
    const face = this.getFace(faceId);
    let index = 1;
    let id = `${face.id}-shape-${index}`;
    while (this.rig.artShapes?.some((shape) => shape.id === id)) id = `${face.id}-shape-${++index}`;
    const vertices: ArtShapeVertex[] = face.vertices.map((vertex, vertexIndex) => ({
      id: `vertex-${vertexIndex + 1}`,
      source: "axis-point",
      ...vertex,
      offsetX: 0,
      offsetY: 0,
    }));
    this.rig.artShapes ??= [];
    this.rig.artShapes.push({
      id,
      kind: "polygon",
      vertices,
      ...(face.color ? { color: face.color } : {}),
      ...(face.paletteId ? { paletteId: face.paletteId } : {}),
      ...(face.groupId ? { groupId: face.groupId } : {}),
      layerOrder: clampLayerValue(this.getFaceLayerOrder(face.id) + 1),
      compositeMode: "paint",
      compositeGroupId: `composite-${id}`,
    });
    this.notify();
    return id;
  }

  public insertArtShapeVertex(shapeId: string, afterVertexId: string, x: number, y: number, rootJointId = "scene-root"): string {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("꼭짓점 좌표가 올바르지 않습니다.");
    const shape = this.getArtShape(shapeId);
    if (shape.kind !== "polygon") throw new Error("꼭짓점 삽입은 다각형에서만 사용할 수 있습니다.");
    const index = shape.vertices.findIndex((vertex) => vertex.id === afterVertexId);
    if (index < 0) throw new Error(`Unknown art shape vertex: ${shapeId}.${afterVertexId}`);
    const root = this.getJoint(rootJointId);
    let sequence = shape.vertices.length + 1;
    let id = `vertex-${sequence}`;
    while (shape.vertices.some((vertex) => vertex.id === id)) id = `vertex-${++sequence}`;
    shape.vertices.splice(index + 1, 0, {
      id,
      source: "root",
      rootJointId,
      ...this.worldToLocal(root.id, x, y),
    });
    this.notify();
    return id;
  }

  public removeArtShapeVertex(shapeId: string, vertexId: string): string | null {
    const shape = this.getArtShape(shapeId);
    const minimum = shape.kind === "line" ? 2 : shape.kind === "circle" ? 1 : 3;
    if (shape.vertices.length <= minimum) throw new Error(shape.kind === "line" ? "선분에는 두 개의 끝점이 필요합니다." : "다각형에는 최소 3개의 꼭짓점이 필요합니다.");
    const index = shape.vertices.findIndex((vertex) => vertex.id === vertexId);
    if (index < 0) return null;
    shape.vertices.splice(index, 1);
    const next = shape.vertices[Math.min(index, shape.vertices.length - 1)] ?? null;
    this.notify();
    return next?.id ?? null;
  }

  public bindArtShapeVertexToAxis(
    shapeId: string,
    vertexId: string,
    jointId: string,
    axisId: string,
    side: AxisPointSide,
    snap = false,
  ): void {
    const shape = this.getArtShape(shapeId);
    const index = shape.vertices.findIndex((vertex) => vertex.id === vertexId);
    if (index < 0) throw new Error(`Unknown art shape vertex: ${shapeId}.${vertexId}`);
    const joint = this.getJoint(jointId);
    const axis = joint.axes.find((candidate) => candidate.id === axisId);
    if (!axis || !axis.pointSides.includes(side)) throw new Error("사용할 수 없는 축 끝점입니다.");
    const world = getArtShapeVertexPoint(this.rig, shape.vertices[index]);
    const next: ArtShapeVertex = { id: vertexId, source: "axis-point", jointId, axisId, side, offsetX: 0, offsetY: 0 };
    if (!snap) this.setArtShapeVertexWorldPosition(next, world.x, world.y);
    shape.vertices[index] = next;
    this.notify();
  }

  public unbindArtShapeVertex(shapeId: string, vertexId: string, rootJointId = "scene-root"): void {
    const shape = this.getArtShape(shapeId);
    const index = shape.vertices.findIndex((vertex) => vertex.id === vertexId);
    if (index < 0) throw new Error(`Unknown art shape vertex: ${shapeId}.${vertexId}`);
    const world = getArtShapeVertexPoint(this.rig, shape.vertices[index]);
    const root = this.getJoint(rootJointId);
    shape.vertices[index] = { id: vertexId, source: "root", rootJointId, ...this.worldToLocal(root.id, world.x, world.y) };
    this.notify();
  }

  public removeArtShape(shapeId: string): void {
    this.removeArtShapes([shapeId]);
  }

  public removeArtShapes(shapeIds: string[]): void {
    const ids = new Set(shapeIds);
    if (!ids.size || !this.rig.artShapes?.some((shape) => ids.has(shape.id))) return;
    this.rig.artShapes = this.rig.artShapes.filter((shape) => !ids.has(shape.id));
    const retainedGroups = new Set((this.rig.artShapes ?? [])
      .map((shape) => shape.compositeGroupId ?? `composite-${shape.id}`));
    for (const directGroupId of [...retainedGroups]) {
      let parentId = this.rig.artCompositeGroups?.find((group) => group.id === directGroupId)?.parentGroupId;
      while (parentId && !retainedGroups.has(parentId)) {
        retainedGroups.add(parentId);
        parentId = this.rig.artCompositeGroups?.find((group) => group.id === parentId)?.parentGroupId;
      }
    }
    this.rig.artCompositeGroups = (this.rig.artCompositeGroups ?? [])
      .filter((group) => retainedGroups.has(group.id));
    this.notify();
  }

  public duplicateArtShapes(shapeIds: string[]): string[] {
    const sourceIds = [...new Set(shapeIds)];
    if (!sourceIds.length) return [];
    const sources = sourceIds.map((shapeId) => this.getArtShape(shapeId));
    const existingIds = new Set((this.rig.artShapes ?? []).map((shape) => shape.id));
    const existingCompositeGroups = new Set([
      ...(this.rig.artShapes ?? []).map((shape) => shape.compositeGroupId ?? `composite-${shape.id}`),
      ...(this.rig.artCompositeGroups ?? []).map((group) => group.id),
    ]);
    const compositeCopies = new Map<string, string>();
    const copies = sources.map((source) => {
      let sequence = 1;
      let id = `${source.id}-copy`;
      while (existingIds.has(id)) id = `${source.id}-copy-${++sequence}`;
      existingIds.add(id);
      const sourceCompositeGroup = source.compositeGroupId ?? `composite-${source.id}`;
      let compositeGroupId = compositeCopies.get(sourceCompositeGroup);
      if (!compositeGroupId) {
        let groupSequence = 1;
        compositeGroupId = `${sourceCompositeGroup}-copy`;
        while (existingCompositeGroups.has(compositeGroupId)) compositeGroupId = `${sourceCompositeGroup}-copy-${++groupSequence}`;
        existingCompositeGroups.add(compositeGroupId);
        compositeCopies.set(sourceCompositeGroup, compositeGroupId);
      }
      return { ...structuredClone(source), id, compositeGroupId, layerOrder: clampLayerValue(source.layerOrder + 1) };
    });
    this.rig.artShapes ??= [];
    this.rig.artShapes.push(...copies);
    const relevantGroupIds = new Set(compositeCopies.keys());
    for (const directId of [...relevantGroupIds]) {
      let parentId = this.rig.artCompositeGroups?.find((group) => group.id === directId)?.parentGroupId;
      while (parentId && !relevantGroupIds.has(parentId)) {
        relevantGroupIds.add(parentId);
        parentId = this.rig.artCompositeGroups?.find((group) => group.id === parentId)?.parentGroupId;
      }
    }
    for (const sourceGroup of this.rig.artCompositeGroups ?? []) {
      if (!relevantGroupIds.has(sourceGroup.id) || compositeCopies.has(sourceGroup.id)) continue;
      let sequence = 1;
      let copiedId = `${sourceGroup.id}-copy`;
      while (existingCompositeGroups.has(copiedId)) copiedId = `${sourceGroup.id}-copy-${++sequence}`;
      existingCompositeGroups.add(copiedId);
      compositeCopies.set(sourceGroup.id, copiedId);
    }
    this.rig.artCompositeGroups ??= [];
    for (const sourceGroup of [...this.rig.artCompositeGroups]) {
      const copiedId = compositeCopies.get(sourceGroup.id);
      if (!copiedId) continue;
      this.rig.artCompositeGroups.push({
        id: copiedId,
        compositeMode: sourceGroup.compositeMode ?? "paint",
        ...(sourceGroup.parentGroupId && compositeCopies.has(sourceGroup.parentGroupId)
          ? { parentGroupId: compositeCopies.get(sourceGroup.parentGroupId)! } : {}),
      });
    }
    this.notify();
    return copies.map((shape) => shape.id);
  }

  public moveArtShapeVertex(shapeId: string, vertexId: string, x: number, y: number): void {
    const vertex = this.getArtShape(shapeId).vertices.find((candidate) => candidate.id === vertexId);
    if (!vertex || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.setArtShapeVertexWorldPosition(vertex, x, y);
    this.notify();
  }

  public moveArtShape(shapeId: string, deltaX: number, deltaY: number): void {
    this.moveArtShapes([shapeId], deltaX, deltaY);
  }

  public moveArtShapes(shapeIds: string[], deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const ids = [...new Set(shapeIds)];
    if (!ids.length || deltaX === 0 && deltaY === 0) return;
    for (const shapeId of ids) {
      const shape = this.getArtShape(shapeId);
      for (const vertex of shape.vertices) {
        const world = getArtShapeVertexPoint(this.rig, vertex);
        this.setArtShapeVertexWorldPosition(vertex, world.x + deltaX, world.y + deltaY);
      }
    }
    this.notify();
  }

  public paintArtShapeWithColor(shapeId: string, color: string): void {
    const paletteId = this.getOrCreatePaletteColor(color);
    if (!paletteId) return;
    const shape = this.getArtShape(shapeId);
    shape.paletteId = paletteId;
    delete shape.color;
    this.notify();
  }

  public setArtShapeStrokeWidth(shapeId: string, strokeWidth: number): void {
    if (!(strokeWidth > 0) || !Number.isFinite(strokeWidth)) return;
    const shape = this.getArtShape(shapeId);
    if (shape.kind !== "line") return;
    shape.strokeWidth = strokeWidth;
    this.notify();
  }

  public setArtShapeCircleRadii(shapeId: string, radiusX: number, radiusY: number): void {
    if (!(radiusX > 0) || !(radiusY > 0) || !Number.isFinite(radiusX) || !Number.isFinite(radiusY)) return;
    const shape = this.getArtShape(shapeId);
    if (shape.kind !== "circle") return;
    shape.radiusX = radiusX;
    shape.radiusY = radiusY;
    this.notify();
  }

  public setArtShapeGroup(shapeId: string, groupId: string | null): void {
    const shape = this.getArtShape(shapeId);
    if (groupId) this.getLayerGroup(groupId);
    shape.groupId = groupId ?? undefined;
    this.notify();
  }

  public setArtShapeLayerOrder(shapeId: string, layerOrder: number): void {
    if (!Number.isFinite(layerOrder)) return;
    this.getArtShape(shapeId).layerOrder = clampLayerValue(layerOrder);
    this.notify();
  }

  public setArtShapeComposite(shapeId: string, mode: ArtCompositeMode, compositeGroupId?: string): void {
    const shape = this.getArtShape(shapeId);
    if (mode === "cutout" && shape.kind === "line") throw new Error("선분은 제외 도형으로 사용할 수 없습니다.");
    const group = (compositeGroupId ?? shape.compositeGroupId ?? `composite-${shape.id}`).trim();
    if (!group) throw new Error("합성 그룹 이름이 필요합니다.");
    shape.compositeMode = mode;
    shape.compositeGroupId = group;
    this.notify();
  }

  public createArtShapeCompositeGroup(shapeIds: string[]): string {
    const uniqueIds = [...new Set(shapeIds)];
    if (uniqueIds.length < 2) throw new Error("합성 그룹에는 도형이 2개 이상 필요합니다.");
    const shapes = uniqueIds.map((shapeId) => this.getArtShape(shapeId));
    const used = new Set([
      ...(this.rig.artShapes ?? []).map((shape) => shape.compositeGroupId).filter(Boolean),
      ...(this.rig.artCompositeGroups ?? []).map((group) => group.id),
    ]);
    let index = 1;
    while (used.has(`composite-group-${index}`)) index += 1;
    const groupId = `composite-group-${index}`;
    for (const shape of shapes) shape.compositeGroupId = groupId;
    this.rig.artCompositeGroups ??= [];
    this.rig.artCompositeGroups.push({ id: groupId, compositeMode: "paint" });
    this.notify();
    return groupId;
  }

  public createNestedArtCompositeGroup(shapeIds: string[]): string {
    const selectedIds = new Set(shapeIds);
    const groups = this.rig.artCompositeGroups ??= [];
    const directGroupId = (shape: ArtShape) => shape.compositeGroupId ?? `composite-${shape.id}`;
    const topGroupId = (groupId: string) => {
      let current = groupId;
      const visited = new Set<string>();
      while (!visited.has(current)) {
        visited.add(current);
        const parent = groups.find((group) => group.id === current)?.parentGroupId;
        if (!parent) return current;
        current = parent;
      }
      return current;
    };
    const operandIds = [...new Set((this.rig.artShapes ?? [])
      .filter((shape) => selectedIds.has(shape.id)).map((shape) => topGroupId(directGroupId(shape))))];
    if (operandIds.length < 2) throw new Error("중첩하려면 서로 다른 합성 그룹을 2개 이상 선택해야 합니다.");
    const belongsToOperand = (shape: ArtShape, operandId: string) => topGroupId(directGroupId(shape)) === operandId;
    for (const operandId of operandIds) {
      const members = (this.rig.artShapes ?? []).filter((shape) => belongsToOperand(shape, operandId));
      if (members.some((shape) => !selectedIds.has(shape.id))) throw new Error("중첩할 그룹의 모든 도형을 선택해야 합니다.");
    }
    const used = new Set([
      ...(this.rig.artShapes ?? []).map((shape) => directGroupId(shape)),
      ...groups.map((group) => group.id),
    ]);
    let index = 1;
    while (used.has(`composite-parent-${index}`)) index += 1;
    const parentId = `composite-parent-${index}`;
    groups.push({ id: parentId, compositeMode: "paint" });
    for (const operandId of operandIds) {
      let group = groups.find((candidate) => candidate.id === operandId);
      if (!group) {
        group = { id: operandId, compositeMode: "paint" };
        groups.push(group);
      }
      group.parentGroupId = parentId;
    }
    this.notify();
    return parentId;
  }

  public setArtCompositeGroupMode(groupId: string, mode: ArtCompositeMode): void {
    const group = this.rig.artCompositeGroups?.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error(`Unknown art composite group: ${groupId}`);
    group.compositeMode = mode;
    this.notify();
  }

  public setElementLayerVisibility(layer: ElementLayerId, visible: boolean): void {
    this.rig.elementLayers ??= { joints: true, axes: true, faces: true, shapes: true };
    this.rig.elementLayers[layer] = visible;
    this.notify();
  }

  public setAxisLength(jointId: string, axisId: string, length: number): void {
    if (!(length > 0) || !Number.isFinite(length)) return;
    const axis = this.getJoint(jointId).axes.find((candidate) => candidate.id === axisId);
    if (!axis) return;
    axis.length = length;
    this.notify();
  }

  public addAxis(jointId: string): string {
    const joint = this.getJoint(jointId);
    if (joint.axes.length >= this.limits.maxAxesPerJoint) {
      throw new Error(`관절당 축은 최대 ${this.limits.maxAxesPerJoint}개까지 추가할 수 있습니다.`);
    }
    let sequence = joint.axes.length + 1;
    let id = `art-axis-${sequence}`;
    while (joint.axes.some((axis) => axis.id === id)) id = `art-axis-${++sequence}`;
    joint.axes.push({ id, angle: 0, length: joint.radius, pointSides: [-1, 1] });
    this.notify();
    return id;
  }

  public setAxisPointSides(jointId: string, axisId: string, pointSides: AxisPointSide[]): void {
    const axis = this.getJoint(jointId).axes.find((candidate) => candidate.id === axisId);
    if (!axis) throw new Error(`Unknown axis: ${jointId}.${axisId}`);
    const unique = [...new Set(pointSides)].filter((side): side is AxisPointSide => side === -1 || side === 1);
    if (unique.length === 0) throw new Error("축 끝점은 한쪽 이상 활성화해야 합니다.");
    const removed = axis.pointSides.filter((side) => !unique.includes(side));
    const inUse = (this.rig.artShapes ?? []).some((shape) => shape.vertices.some((vertex) => (
      vertex.source === "axis-point" && vertex.jointId === jointId && vertex.axisId === axisId && removed.includes(vertex.side)
    ))) || this.rig.faces.some((face) => face.vertices.some((vertex) => (
      vertex.jointId === jointId && vertex.axisId === axisId && removed.includes(vertex.side)
    )));
    if (inUse) throw new Error("도형이나 면이 사용하는 축 끝점은 비활성화할 수 없습니다.");
    axis.pointSides = unique.sort((a, b) => a - b);
    this.notify();
  }

  public moveJoint(jointId: string, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const joint = this.getJoint(jointId);
    this.setJointWorldPosition(joint, x, y);
    this.alignDirectConnectionAxes(jointId);
    this.notify();
  }

  /**
   * Move only one joint in world space. Its direct children are rebased so
   * their current world positions stay fixed instead of following the parent.
   */
  public moveJointIndependently(jointId: string, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const joint = this.getJoint(jointId);
    const children = this.rig.joints
      .filter((candidate) => candidate.parentJointId === jointId)
      .map((child) => ({ child, world: getJointWorldTransform(this.rig, child.id) }));
    this.setJointWorldPosition(joint, x, y);
    for (const { child, world } of children) this.setJointWorldPosition(child, world.x, world.y);
    this.alignDirectConnectionAxes(jointId);
    for (const { child } of children) this.alignDirectConnectionAxes(child.id);
    this.notify();
  }

  public setJointDistance(movingJointId: string, anchorJointId: string, distance: number): void {
    if (!Number.isFinite(distance) || distance < 0 || movingJointId === anchorJointId) return;
    const moving = this.getJoint(movingJointId);
    const anchor = this.getJoint(anchorJointId);
    const related = moving.parentJointId === anchor.id || anchor.parentJointId === moving.id
      || this.rig.peerGroups.some((group) => group.jointIds.includes(moving.id) && group.jointIds.includes(anchor.id));
    // A descendant anchor would move along with its ancestor and cannot remain fixed.
    if (!related || this.isDescendant(anchor.id, moving.id)) return;
    if (moving.parentJointId === anchor.id) {
      this.setJointBaseDistance(moving.id, distance);
      return;
    }
    const movingWorld = getJointWorldTransform(this.rig, moving.id);
    const anchorWorld = getJointWorldTransform(this.rig, anchor.id);
    const dx = movingWorld.x - anchorWorld.x;
    const dy = movingWorld.y - anchorWorld.y;
    const current = Math.hypot(dx, dy);
    const directionX = current > 1e-9 ? dx / current : 1;
    const directionY = current > 1e-9 ? dy / current : 0;
    this.moveJoint(moving.id, anchorWorld.x + directionX * distance, anchorWorld.y + directionY * distance);
  }

  /** Changes a body-type distance while retaining the current pose's distance percentage. */
  public setJointBaseDistance(jointId: string, distance: number): void {
    if (!Number.isFinite(distance) || distance < 0) return;
    const joint = this.getJoint(jointId);
    if (!joint.parentJointId) return;
    const current = Math.hypot(joint.x, joint.y);
    const fallback = Math.hypot(joint.x, joint.y) || 1;
    const percent = this.getJointDistancePercent(joint.id);
    joint.baseDistance = distance;
    joint.x = (current > 1e-9 ? joint.x / current : joint.x / fallback) * distance * percent / 100;
    joint.y = (current > 1e-9 ? joint.y / current : joint.y / fallback) * distance * percent / 100;
    this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public getJointDistancePercent(jointId: string): number {
    const joint = this.getJoint(jointId);
    const baseDistance = joint.baseDistance;
    if (!joint.parentJointId || !(baseDistance && baseDistance > 1e-9)) return 100;
    return Math.hypot(joint.x, joint.y) / baseDistance * 100;
  }

  public setJointDistancePercent(jointId: string, percent: number): void {
    if (!Number.isFinite(percent) || percent < 0 || percent > 300) return;
    const joint = this.getJoint(jointId);
    const baseDistance = joint.baseDistance;
    if (!joint.parentJointId || !(baseDistance && baseDistance > 0)) return;
    const current = Math.hypot(joint.x, joint.y);
    const directionX = current > 1e-9 ? joint.x / current : 1;
    const directionY = current > 1e-9 ? joint.y / current : 0;
    joint.distancePercent = percent;
    joint.x = directionX * baseDistance * percent / 100;
    joint.y = directionY * baseDistance * percent / 100;
    this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public getPeerGroupDistance(peerGroupId: string): number | null {
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group || group.jointIds.length !== 2) return null;
    const first = getJointWorldTransform(this.rig, group.jointIds[0]);
    const second = getJointWorldTransform(this.rig, group.jointIds[1]);
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  /** Set a two-member peer distance symmetrically, preserving its midpoint and pivot offset. */
  public setPeerGroupDistance(peerGroupId: string, distance: number): void {
    if (!Number.isFinite(distance) || distance < 0) return;
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group || group.jointIds.length !== 2) return;
    const first = this.getJoint(group.jointIds[0]);
    const second = this.getJoint(group.jointIds[1]);
    const firstWorld = getJointWorldTransform(this.rig, first.id);
    const secondWorld = getJointWorldTransform(this.rig, second.id);
    const midpoint = { x: (firstWorld.x + secondWorld.x) / 2, y: (firstWorld.y + secondWorld.y) / 2 };
    const dx = secondWorld.x - firstWorld.x;
    const dy = secondWorld.y - firstWorld.y;
    const current = Math.hypot(dx, dy);
    const directionX = current > 1e-9 ? dx / current : 1;
    const directionY = current > 1e-9 ? dy / current : 0;
    const half = distance / 2;
    this.setJointWorldPosition(first, midpoint.x - directionX * half, midpoint.y - directionY * half);
    this.setJointWorldPosition(second, midpoint.x + directionX * half, midpoint.y + directionY * half);
    this.alignDirectConnectionAxes(first.id);
    this.alignDirectConnectionAxes(second.id);
    this.notify();
  }

  /** Return the virtual pivot offset in peer-axis coordinates: X along first-to-second, Y perpendicular. */
  public getPeerCenterOffset(peerGroupId: string): { x: number; y: number } | null {
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group?.centerJointId || group.jointIds.length !== 2) return null;
    const first = getJointWorldTransform(this.rig, group.jointIds[0]);
    const second = getJointWorldTransform(this.rig, group.jointIds[1]);
    const center = getJointWorldTransform(this.rig, group.centerJointId);
    const midpoint = getPeerGroupCentroid(this.rig, peerGroupId);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    const axisX = length > 1e-9 ? dx / length : 1;
    const axisY = length > 1e-9 ? dy / length : 0;
    const offsetX = center.x - midpoint.x;
    const offsetY = center.y - midpoint.y;
    return {
      x: offsetX * axisX + offsetY * axisY,
      y: -offsetX * axisY + offsetY * axisX,
    };
  }

  /** Rebase a virtual peer pivot without changing the current pose of its direct children. */
  public setPeerCenterOffset(peerGroupId: string, offsetX: number, offsetY: number): void {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group?.centerJointId || group.jointIds.length !== 2) return;
    const center = this.getJoint(group.centerJointId);
    const first = getJointWorldTransform(this.rig, group.jointIds[0]);
    const second = getJointWorldTransform(this.rig, group.jointIds[1]);
    const midpoint = getPeerGroupCentroid(this.rig, peerGroupId);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    const axisX = length > 1e-9 ? dx / length : 1;
    const axisY = length > 1e-9 ? dy / length : 0;
    const children = this.rig.joints
      .filter((joint) => joint.parentJointId === center.id)
      .map((joint) => ({ joint, world: getJointWorldTransform(this.rig, joint.id) }));
    this.setJointWorldPosition(center,
      midpoint.x + axisX * offsetX - axisY * offsetY,
      midpoint.y + axisY * offsetX + axisX * offsetY,
    );
    const centerRotation = getJointWorldTransform(this.rig, center.id).rotation;
    for (const { joint, world } of children) {
      this.setJointWorldPosition(joint, world.x, world.y);
      joint.localRotation = normalizeAngle(world.rotation - centerRotation);
    }
    for (const { joint } of children) this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public moveJointsBy(jointIds: string[], deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const roots = this.getSelectionRoots(jointIds);
    const snapshots = roots.map((jointId) => ({
      joint: this.getJoint(jointId),
      world: getJointWorldTransform(this.rig, jointId),
    }));
    for (const { joint, world } of snapshots) {
      this.setJointWorldPosition(joint, world.x + deltaX, world.y + deltaY);
      this.alignDirectConnectionAxes(joint.id);
    }
    this.notify();
  }

  public moveJointsConstrainedBy(jointIds: string[], angleDelta: number, deltaX: number, deltaY: number): void {
    if (![angleDelta, deltaX, deltaY].every(Number.isFinite)) return;
    const radians = angleDelta * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const joints = [...new Set(jointIds)].map((jointId) => this.getJoint(jointId));
    for (const joint of joints) {
      if (!joint.parentJointId) {
        joint.x += deltaX;
        joint.y += deltaY;
      } else {
        const x = joint.x;
        const y = joint.y;
        joint.x = cosine * x - sine * y;
        joint.y = sine * x + cosine * y;
      }
    }
    for (const joint of joints) this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public rotateJointsAround(jointIds: string[], pivotX: number, pivotY: number, delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    const radians = delta * Math.PI / 180;
    const snapshots = this.getSelectionRoots(jointIds).map((jointId) => ({
      joint: this.getJoint(jointId),
      world: getJointWorldTransform(this.rig, jointId),
    }));
    for (const { joint, world } of snapshots) {
      const relativeX = world.x - pivotX;
      const relativeY = world.y - pivotY;
      this.setJointWorldPosition(
        joint,
        pivotX + Math.cos(radians) * relativeX - Math.sin(radians) * relativeY,
        pivotY + Math.sin(radians) * relativeX + Math.cos(radians) * relativeY,
      );
      joint.localRotation = normalizeAngle(joint.localRotation + delta);
    }
    for (const { joint } of snapshots) this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public setParentJoint(jointId: string, parentJointId: string | null): void {
    const joint = this.getJoint(jointId);
    if (parentJointId === joint.parentJointId) return;
    if (parentJointId === jointId) throw new Error("A joint cannot be its own parent");
    if (parentJointId && this.isDescendant(parentJointId, jointId)) {
      throw new Error("A descendant cannot become a parent");
    }

    const world = getJointWorldTransform(this.rig, jointId);
    joint.parentJointId = parentJointId ?? undefined;
    this.setJointWorldPosition(joint, world.x, world.y);
    const parentRotation = parentJointId
      ? getJointWorldTransform(this.rig, parentJointId).rotation
      : 0;
    joint.localRotation = normalizeAngle(world.rotation - parentRotation);
    this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public getValidParents(jointId: string): string[] {
    this.getJoint(jointId);
    return this.rig.joints
      .filter((candidate) => candidate.id !== jointId && !this.isDescendant(candidate.id, jointId))
      .map((candidate) => candidate.id);
  }

  /** Insert a virtual parent for two peer joints without changing their world pose. */
  public addPeerCenter(peerGroupId: string): string | null {
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group || group.centerJointId || group.jointIds.length !== 2) return null;
    const members = group.jointIds.map((id) => this.getJoint(id));
    if (members[0].parentJointId !== members[1].parentJointId) return null;
    const parentId = members[0].parentJointId;
    const snapshots = members.map((joint) => ({ joint, world: getJointWorldTransform(this.rig, joint.id) }));
    const baseId = `${group.id}-center`;
    let id = baseId;
    let suffix = 2;
    while (this.rig.joints.some((joint) => joint.id === id)) id = `${baseId}-${suffix++}`;
    const center: Rig["joints"][number] = {
      id, parentJointId: parentId, groupId: members[0].groupId, x: 0, y: 0,
      z: 0, localRotation: 0, isVirtual: true, radius: 8, axes: [], renderOrder: 0,
      guideVisible: true, bodyVisible: false,
    };
    this.rig.joints.push(center);
    normalizeBodyViewProfiles(this.rig);
    this.setJointWorldPosition(center, (snapshots[0].world.x + snapshots[1].world.x) / 2,
      (snapshots[0].world.y + snapshots[1].world.y) / 2);
    const rotation = getJointWorldTransform(this.rig, center.id).rotation;
    for (const { joint, world } of snapshots) {
      if (parentId && !joint.axisReferenceJointId && joint.axes.some((axis) => axis.alignment)) {
        joint.axisReferenceJointId = parentId;
      }
      joint.parentJointId = id;
      this.setJointWorldPosition(joint, world.x, world.y);
      joint.localRotation = normalizeAngle(world.rotation - rotation);
    }
    group.centerJointId = id;
    for (const joint of members) this.alignDirectConnectionAxes(joint.id);
    this.notify();
    return id;
  }

  public rotateChildAroundParent(jointId: string, worldAngle: number): void {
    const joint = this.getJoint(jointId);
    if (!joint.parentJointId) return;
    const parent = getJointWorldTransform(this.rig, joint.parentJointId);
    const current = getJointWorldTransform(this.rig, jointId);
    const currentAngle = Math.atan2(current.y - parent.y, current.x - parent.x) * 180 / Math.PI;
    const delta = worldAngle - currentAngle;
    const radians = (delta * Math.PI) / 180;
    const relativeX = current.x - parent.x;
    const relativeY = current.y - parent.y;
    const x = parent.x + Math.cos(radians) * relativeX - Math.sin(radians) * relativeY;
    const y = parent.y + Math.sin(radians) * relativeX + Math.cos(radians) * relativeY;
    this.setJointWorldPosition(joint, x, y);
    joint.localRotation = normalizeAngle(joint.localRotation + delta);
    this.rotateSharedParentAxes(joint.parentJointId, jointId, delta);
    this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public rotatePeerGroup(peerGroupId: string, worldAngle: number): void {
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group) throw new Error(`Unknown peer group: ${peerGroupId}`);
    const pivot = getPeerGroupPivot(this.rig, peerGroupId);
    const first = getJointWorldTransform(this.rig, group.jointIds[0]);
    const currentAngle = Math.atan2(first.y - pivot.y, first.x - pivot.x) * 180 / Math.PI;
    const delta = normalizeSignedAngle(worldAngle - currentAngle);
    if (Math.abs(delta) < 1e-9) return;
    if (group.centerJointId && group.jointIds.every((id) => this.isDescendant(id, group.centerJointId!))) {
      const center = this.getJoint(group.centerJointId);
      center.localRotation = normalizeAngle(center.localRotation + delta);
      for (const id of group.jointIds) this.alignDirectConnectionAxes(id);
      this.notify();
      return;
    }
    const radians = (delta * Math.PI) / 180;
    const snapshots = group.jointIds.map((id) => ({ joint: this.getJoint(id), world: getJointWorldTransform(this.rig, id) }));
    for (const { joint, world } of snapshots) {
      const relativeX = world.x - pivot.x;
      const relativeY = world.y - pivot.y;
      this.setJointWorldPosition(joint,
        pivot.x + Math.cos(radians) * relativeX - Math.sin(radians) * relativeY,
        pivot.y + Math.sin(radians) * relativeX + Math.cos(radians) * relativeY,
      );
      joint.localRotation = normalizeAngle(joint.localRotation + delta);
    }
    for (const { joint } of snapshots) this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public getFaceRotationAngle(faceId: string): number | null {
    const target = this.getFaceRotationTarget(faceId);
    if (!target) return null;
    if (target.type === "child") {
      const parent = getJointWorldTransform(this.rig, target.parentJointId);
      const child = getJointWorldTransform(this.rig, target.childJointId);
      return normalizeAngle(Math.atan2(child.y - parent.y, child.x - parent.x) * 180 / Math.PI);
    }
    const pivot = getPeerGroupPivot(this.rig, target.peerGroupId);
    const joint = getJointWorldTransform(this.rig, target.referenceJointId);
    return normalizeAngle(Math.atan2(joint.y - pivot.y, joint.x - pivot.x) * 180 / Math.PI);
  }

  public rotateFace(faceId: string, worldAngle: number): void {
    const target = this.getFaceRotationTarget(faceId);
    if (!target) return;
    if (target.type === "child") {
      this.rotateChildAroundParent(target.childJointId, worldAngle);
    } else {
      this.rotatePeerGroup(target.peerGroupId, worldAngle);
    }
  }

  public getGlobalRotation(): number {
    return this.getJoint("scene-root").localRotation;
  }

  public setGlobalRotation(angle: number): void {
    if (!Number.isFinite(angle)) return;
    if (!Number.isFinite(angle)) return;
    this.getJoint("scene-root").localRotation = normalizeAngle(angle);
    this.notify();
    this.notify();
  }

  public getGlobalAxisRotation(axis: "x" | "y" | "z"): number {
    return this.rig.worldRotation?.[axis] ?? 0;
  }

  public setGlobalAxisRotation(axis: "x" | "y" | "z", angle: number): void {
    if (!Number.isFinite(angle)) return;
    this.rig.worldRotation ??= { x: 0, y: 0, z: 0 };
    this.rig.worldRotation[axis] = angle;
    this.notify();
  }

  public setJointRadius(jointId: string, radius: number): void {
    if (!Number.isFinite(radius)) return;
    this.getJoint(jointId).radius = Math.min(80, Math.max(8, radius));
    this.notify();
  }

  public setJointSurfaceScale(jointId: string, axis: "x" | "y" | "z", value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    const joint = this.getJoint(jointId);
    joint.surfaceScale ??= { x: 1, y: 1, z: 1 };
    joint.surfaceScale[axis] = Math.min(10, Math.max(.05, value));
    this.notify();
  }

  public setJointCapsuleFlatAxis(jointId: string, axis: "x" | "y" | "z", enabled: boolean): void {
    const joint = this.getJoint(jointId);
    const axes = new Set(joint.capsuleFlatAxes ?? []);
    if (enabled) { if (axes.size >= 2) return; axes.add(axis); } else axes.delete(axis);
    joint.capsuleFlatAxes = [...axes];
    joint.capsuleFlatLengths ??= {};
    joint.capsuleFlatLengths[axis] ??= joint.radius;
    this.notify();
  }

  public setJointCapsuleFlatLength(jointId: string, axis: "x" | "y" | "z", value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const joint = this.getJoint(jointId);
    joint.capsuleFlatLengths ??= {};
    joint.capsuleFlatLengths[axis] = value;
    this.notify();
  }

  public setJointSideRadius(jointId: string, radius: number): void {
    if (!Number.isFinite(radius)) return;
    this.getJoint(jointId).sideRadius = Math.min(80, Math.max(4, radius));
    this.notify();
  }

  public setJointZ(jointId: string, z: number): void {
    if (!Number.isFinite(z)) return;
    this.getJoint(jointId).z = Math.min(100, Math.max(-100, z));
    this.notify();
  }

  public setJointAxisRotation(jointId: string, axis: "x" | "y" | "z", angle: number): void {
    if (!Number.isFinite(angle)) return;
    const joint = this.getJoint(jointId);
    const normalized = normalizeAngle(angle);
    if (axis === "z") {
      joint.localRotation = normalized;
      this.notify();
      return;
    }
    const previous = axis === "x" ? joint.localRotationX ?? 0 : joint.localRotationY ?? 0;
    const delta = ((normalized - previous + 540) % 360) - 180;
    if (Math.abs(delta) < 1e-9) return;
    const pivot = getJointWorldTransform(this.rig, jointId);
    const descendants: Array<{ joint: Rig["joints"][number]; world: { x: number; y: number; z: number } }> = [];
    const visit = (parentId: string) => {
      for (const child of this.rig.joints.filter((candidate) => candidate.parentJointId === parentId)) {
        const world = getJointWorldTransform(this.rig, child.id);
        descendants.push({ joint: child, world: { x: world.x, y: world.y, z: child.z } });
        visit(child.id);
      }
    };
    visit(jointId);
    const radians = delta * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    for (const entry of descendants) {
      const dx = entry.world.x - pivot.x, dy = entry.world.y - pivot.y, dz = entry.world.z - joint.z;
      const next = axis === "x"
        ? { x: pivot.x + dx, y: pivot.y + dy * cosine - dz * sine, z: joint.z + dy * sine + dz * cosine }
        : { x: pivot.x + dx * cosine + dz * sine, y: pivot.y + dy, z: joint.z - dx * sine + dz * cosine };
      this.setJointWorldPosition(entry.joint, next.x, next.y);
      entry.joint.z = Math.min(100, Math.max(-100, next.z));
    }
    if (axis === "x") joint.localRotationX = normalized;
    else joint.localRotationY = normalized;
    this.notify();
  }

  public setProjectionStrength(strength: number): void {
    if (!Number.isFinite(strength)) return;
    this.rig.projectionStrength = Math.min(100, Math.max(0, strength));
    this.notify();
  }

  public setViewYRotation(angle: number): void {
    if (!Number.isFinite(angle)) return;
    this.rig.viewYRotation = Math.min(180, Math.max(-180, angle));
    this.notify();
  }

  public applyJointPose(
    jointId: string,
    pose: { x: number; y: number; localRotation: number; axes: Record<string, number>; z?: number; distancePercent?: number },
  ): void {
    const joint = this.getJoint(jointId);
    joint.x = pose.x;
    joint.y = pose.y;
    joint.localRotation = normalizeAngle(pose.localRotation);
    if (Number.isFinite(pose.z)) joint.z = Math.min(100, Math.max(-100, pose.z!));
    if (Number.isFinite(pose.distancePercent) && joint.parentJointId) joint.distancePercent = Math.min(300, Math.max(0, pose.distancePercent!));
    for (const axis of joint.axes) {
      const angle = pose.axes[axis.id];
      if (Number.isFinite(angle)) axis.angle = normalizeAngle(angle);
    }
    this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public applyJointProportions(
    jointId: string,
    proportions: { x: number; y: number; radius: number; bodyRadius?: number; sideRadius?: number },
  ): void {
    const joint = this.getJoint(jointId);
    if (joint.parentJointId) {
      const baseDistance = Math.hypot(proportions.x, proportions.y);
      const current = Math.hypot(joint.x, joint.y);
      const directionX = current > 1e-9 ? joint.x / current : proportions.x / Math.max(baseDistance, 1e-9);
      const directionY = current > 1e-9 ? joint.y / current : proportions.y / Math.max(baseDistance, 1e-9);
      const percent = this.getJointDistancePercent(joint.id);
      joint.baseDistance = baseDistance;
      joint.x = directionX * baseDistance * percent / 100;
      joint.y = directionY * baseDistance * percent / 100;
    } else {
      joint.x = proportions.x;
      joint.y = proportions.y;
    }
    joint.radius = Math.min(80, Math.max(8, proportions.radius));
    if (proportions.sideRadius === undefined) delete joint.sideRadius;
    else if (proportions.sideRadius > 0) joint.sideRadius = Math.min(80, Math.max(4, proportions.sideRadius));
    if (proportions.bodyRadius === undefined) delete joint.bodyRadius;
    else if (proportions.bodyRadius > 0) joint.bodyRadius = proportions.bodyRadius;
    this.alignDirectConnectionAxes(joint.id);
    this.notify();
  }

  public applyColors(colors: {
    defaultColor: string;
    palette: Rig["palette"];
    joints: Record<string, { color?: string; paletteId?: string } | null>;
    faces: Record<string, { color?: string; paletteId?: string } | null>;
  }): void {
    if (isHexColor(colors.defaultColor)) this.rig.defaultColor = colors.defaultColor;
    const seenPaletteIds = new Set<string>();
    const palette = colors.palette.filter((entry) => entry.id.trim()
      && isHexColor(entry.color) && !seenPaletteIds.has(entry.id) && (seenPaletteIds.add(entry.id), true));
    if (palette.length > 0) this.rig.palette = palette.map((entry) => ({ ...entry }));
    for (const joint of this.rig.joints) {
      const assignment = colors.joints[joint.id];
      if (assignment === null) {
        delete joint.color;
        delete joint.paletteId;
      } else if (assignment) {
        if (isHexColor(assignment.color ?? "")) joint.color = assignment.color;
        else delete joint.color;
        if (assignment.paletteId && this.rig.palette.some((entry) => entry.id === assignment.paletteId)) joint.paletteId = assignment.paletteId;
        else delete joint.paletteId;
      }
    }
    for (const face of this.rig.faces) {
      const assignment = colors.faces[face.id];
      if (assignment === null) {
        delete face.color;
        delete face.paletteId;
      } else if (assignment) {
        if (isHexColor(assignment.color ?? "")) face.color = assignment.color;
        else delete face.color;
        if (assignment.paletteId && this.rig.palette.some((entry) => entry.id === assignment.paletteId)) face.paletteId = assignment.paletteId;
        else delete face.paletteId;
      }
    }
    this.notify();
  }

  public setJointBodyVisible(jointId: string, visible: boolean): void {
    this.setJointsBodyVisible([jointId], visible);
  }

  public setJointsBodyVisible(jointIds: string[], visible: boolean): void {
    const ids = [...new Set(jointIds)];
    if (!ids.length) return;
    for (const jointId of ids) this.getJoint(jointId).bodyVisible = visible;
    this.notify();
  }

  public setJointsOutlineVisible(jointIds: string[], visible: boolean): void {
    const ids = [...new Set(jointIds)];
    if (!ids.length) return;
    for (const jointId of ids) this.getJoint(jointId).outlineVisible = visible;
    this.notify();
  }

  public setJointsFaceExtensionEnabled(jointIds: string[], enabled: boolean): void {
    const ids = [...new Set(jointIds)];
    if (!ids.length) return;
    for (const jointId of ids) this.getJoint(jointId).faceExtensionEnabled = enabled;
    this.notify();
  }

  public setJointColor(jointId: string, color: string): void {
    if (!isHexColor(color)) return;
    const joint = this.getJoint(jointId);
    joint.color = color;
    delete joint.paletteId;
    this.notify();
  }

  public clearJointColor(jointId: string): void {
    const joint = this.getJoint(jointId);
    delete joint.color;
    delete joint.paletteId;
    this.notify();
  }

  public setJointRenderOrder(jointId: string, order: number): void {
    if (!Number.isFinite(order)) return;
    this.getJoint(jointId).renderOrder = clampLayerValue(order);
    this.notify();
  }

  public setFaceOrderOffset(faceId: string, orderOffset: number): void {
    if (!Number.isFinite(orderOffset)) return;
    this.getFace(faceId).orderOffset = clampLayerValue(orderOffset);
    this.notify();
  }

  public getFaceLayerOrder(faceId: string): number {
    const face = this.getFace(faceId);
    if (face.layerOrder !== undefined) return face.layerOrder;
    const jointIds = [...new Set(face.vertices.map((vertex) => vertex.jointId))];
    const total = jointIds.reduce((sum, jointId) => sum + this.getJoint(jointId).renderOrder, 0);
    return total / Math.max(jointIds.length, 1) + face.orderOffset;
  }

  public setFaceLayerOrder(faceId: string, layerOrder: number): void {
    if (!Number.isFinite(layerOrder)) return;
    this.getFace(faceId).layerOrder = clampLayerValue(layerOrder);
    this.notify();
  }

  public addLayerGroup(name: string): string | null {
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    let index = this.rig.groups.length + 1;
    let id = `group-${index}`;
    while (this.rig.groups.some((group) => group.id === id)) {
      index += 1;
      id = `group-${index}`;
    }
    const highestOrder = this.rig.groups.reduce((highest, group) => Math.max(highest, group.order), 0);
    this.rig.groups.push({ id, name: trimmedName, visible: true, order: highestOrder + 10 });
    this.notify();
    return id;
  }

  public setLayerGroupVisibility(groupId: string, visible: boolean): void {
    const group = this.getLayerGroup(groupId);
    group.visible = visible;
    this.notify();
  }

  public setLayerGroupOrder(groupId: string, order: number): void {
    if (!Number.isFinite(order)) return;
    this.getLayerGroup(groupId).order = clampLayerValue(order);
    this.notify();
  }

  /** Reorder group offsets without changing the individual item layers. */
  public moveLayerGroupInStack(groupId: string, direction: -1 | 1, toEnd: boolean): void {
    const groups = [...this.rig.groups].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const index = groups.findIndex((group) => group.id === groupId);
    if (index < 0 || (direction > 0 ? index === groups.length - 1 : index === 0)) return;
    const [target] = groups.splice(index, 1);
    const insertion = toEnd ? (direction > 0 ? groups.length : 0) : index + direction;
    const previous = groups[insertion - 1];
    const next = groups[insertion];
    const boundaryBlocked = (!previous && next.order <= -999) || (!next && previous.order >= 999);
    if ((!previous || !next || previous.order < next.order) && !boundaryBlocked) {
      const order = !previous ? Math.max(-999, next.order - 1) : !next ? Math.min(999, previous.order + 1) : (previous.order + next.order) / 2;
      target.order = order;
    } else {
      const tiedOrder = previous?.order ?? next.order;
      let first = insertion;
      let last = insertion - 1;
      while (first > 0 && groups[first - 1].order === tiedOrder) first--;
      while (last + 1 < groups.length && groups[last + 1].order === tiedOrder) last++;
      const tied = groups.slice(first, last + 1);
      tied.splice(insertion - first, 0, target);
      const lower = Math.max(-999, groups[first - 1]?.order ?? -999, tiedOrder - 0.5);
      const upper = Math.min(999, groups[last + 1]?.order ?? 999, tiedOrder + 0.5);
      if (upper - lower < 1e-8) return;
      tied.forEach((group, position) => { group.order = lower + (upper - lower) * (position + 1) / (tied.length + 1); });
    }
    this.notify();
  }

  public bringJointsToFront(jointIds: string[]): void {
    const ids = new Set(jointIds);
    const selected = [...ids].map((jointId) => this.getJoint(jointId));
    if (selected.length === 0) return;
    const highestOtherOrder = Math.max(0, ...this.getBodyStackEntries()
      .filter((entry) => entry.type !== "joint" || !ids.has(entry.id))
      .map((entry) => entry.order));
    if (selected.every((joint) => this.getJointStackOrder(joint) > highestOtherOrder)) return;
    selected
      .sort((first, second) => this.getJointStackOrder(first) - this.getJointStackOrder(second))
      .forEach((joint, index) => this.setJointStackOrder(joint, highestOtherOrder + index + 1));
    this.notify();
  }

  /** Move one visible item to an exact position in the rendered body stack. */
  public moveBodyItemInStack(type: "joint" | "face" | "shape", id: string, direction: -1 | 1, toEnd: boolean): void {
    const visible = (groupId: string | undefined) => !groupId || this.getLayerGroup(groupId).visible;
    const itemGroupId = (entry: { type: "joint" | "face" | "shape"; id: string }) => entry.type === "joint"
      ? this.getJoint(entry.id).groupId : entry.type === "face" ? this.getFace(entry.id).groupId : this.getArtShape(entry.id).groupId;
    const entries = this.getBodyStackEntries().filter((entry) => visible(
      itemGroupId(entry),
    )).sort((a, b) => a.order - b.order || `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
    const index = entries.findIndex((entry) => entry.type === type && entry.id === id);
    if (index < 0 || (direction > 0 ? index === entries.length - 1 : index === 0)) return;
    const [target] = entries.splice(index, 1);
    const insertion = toEnd ? (direction > 0 ? entries.length : 0) : index + direction;
    const previous = entries[insertion - 1];
    const next = entries[insertion];
    const groupOrder = (entry: typeof target) => this.getGroupStackOrder(
      itemGroupId(entry),
    );
    const assignments: Array<{ entry: typeof target; order: number }> = [];
    const assign = (entry: typeof target, order: number) => {
      assignments.push({ entry, order });
    };
    if (!previous || !next || previous.order < next.order) {
      const order = !previous ? next.order - 1 : !next ? previous.order + 1 : (previous.order + next.order) / 2;
      if (order - groupOrder(target) < -999 || order - groupOrder(target) > 999) return;
      assign(target, order);
    } else {
      // Break only the tied run around the insertion point, preserving its order.
      const order = previous.order;
      let first = insertion - 1;
      let last = insertion;
      while (first > 0 && entries[first - 1].order === order) first--;
      while (last + 1 < entries.length && entries[last + 1].order === order) last++;
      const run = entries.slice(first, last + 1);
      run.splice(insertion - first, 0, target);
      const lower = Math.max(entries[first - 1]?.order ?? -Infinity, ...run.map((entry) => groupOrder(entry) - 999));
      const upper = Math.min(entries[last + 1]?.order ?? Infinity, ...run.map((entry) => groupOrder(entry) + 999));
      const start = Math.max(lower, order - 0.5);
      const end = Math.min(upper, order + 0.5);
      if (end - start < 1e-8) return;
      run.forEach((entry, position) => assign(entry, start + (end - start) * (position + 1) / (run.length + 1)));
    }
    const movedJoints = new Set(assignments.filter(({ entry }) => entry.type === "joint").map(({ entry }) => entry.id));
    const assignedFaces = new Set(assignments.filter(({ entry }) => entry.type === "face").map(({ entry }) => entry.id));
    for (const face of this.rig.faces) {
      if (face.layerOrder === undefined && !assignedFaces.has(face.id)
        && face.vertices.some((vertex) => movedJoints.has(vertex.jointId))) {
        face.layerOrder = this.getFaceLayerOrder(face.id);
      }
    }
    for (const { entry, order } of assignments) {
      const local = order - groupOrder(entry);
      if (entry.type === "joint") this.getJoint(entry.id).renderOrder = local;
      else if (entry.type === "face") this.getFace(entry.id).layerOrder = local;
      else this.getArtShape(entry.id).layerOrder = local;
    }
    this.notify();
  }

  public moveJointsInLayerStack(jointIds: string[], direction: -1 | 1): void {
    const ids = new Set(jointIds);
    const selected = [...ids].map((jointId) => this.getJoint(jointId));
    if (selected.length === 0) return;
    const others = this.getBodyStackEntries()
      .filter((entry) => entry.type !== "joint" || !ids.has(entry.id));
    const selectedOrders = selected.map((joint) => this.getJointStackOrder(joint));
    const boundary = direction > 0 ? Math.max(...selectedOrders) : Math.min(...selectedOrders);
    const adjacentOrders = others.map((entry) => entry.order).filter((order) => (
      direction > 0 ? order > boundary : order < boundary
    ));
    const adjacent = direction > 0
      ? Math.min(...adjacentOrders)
      : Math.max(...adjacentOrders);
    const target = Number.isFinite(adjacent) ? adjacent + direction : boundary + direction;
    const ordered = selected.sort((first, second) => this.getJointStackOrder(first) - this.getJointStackOrder(second));
    ordered.forEach((joint, index) => {
      const offset = direction > 0 ? index : index - ordered.length + 1;
      this.setJointStackOrder(joint, target + offset);
    });
    this.notify();
  }

  public moveFaceInLayerStack(faceId: string, direction: -1 | 1): void {
    const face = this.getFace(faceId);
    const current = this.getFaceStackOrder(face);
    const adjacentOrders = this.getBodyStackEntries()
      .filter((entry) => entry.type !== "face" || entry.id !== faceId)
      .map((entry) => entry.order)
      .filter((order) => direction > 0 ? order > current : order < current);
    const adjacent = direction > 0
      ? Math.min(...adjacentOrders)
      : Math.max(...adjacentOrders);
    this.setFaceStackOrder(face, Number.isFinite(adjacent) ? adjacent + direction : current + direction);
    this.notify();
  }

  public setJointGroup(jointId: string, groupId: string | null): void {
    const joint = this.getJoint(jointId);
    if (groupId) this.getLayerGroup(groupId);
    joint.groupId = groupId ?? undefined;
    this.notify();
  }

  public setFaceGroup(faceId: string, groupId: string | null): void {
    const face = this.getFace(faceId);
    if (groupId) this.getLayerGroup(groupId);
    face.groupId = groupId ?? undefined;
    this.notify();
  }

  public setFaceColor(faceId: string, color: string): void {
    if (!isHexColor(color)) return;
    const face = this.getFace(faceId);
    face.color = color;
    delete face.paletteId;
    this.notify();
  }

  public clearFaceColor(faceId: string): void {
    const face = this.getFace(faceId);
    delete face.color;
    delete face.paletteId;
    this.notify();
  }

  public setPaletteColor(paletteId: string, color: string): string | null {
    if (!isHexColor(color)) return null;
    const palette = this.rig.palette.find((entry) => entry.id === paletteId);
    if (!palette) throw new Error(`Unknown palette: ${paletteId}`);
    palette.color = color;
    const matching = this.rig.palette.find((entry) => entry.id !== paletteId
      && entry.color.toLowerCase() === color.toLowerCase());
    if (matching) {
      for (const joint of this.rig.joints) {
        if (joint.paletteId === paletteId) joint.paletteId = matching.id;
      }
      for (const face of this.rig.faces) {
        if (face.paletteId === paletteId) face.paletteId = matching.id;
      }
      for (const shape of this.rig.artShapes ?? []) {
        if (shape.paletteId === paletteId) shape.paletteId = matching.id;
      }
      this.rig.palette = this.rig.palette.filter((entry) => entry.id !== paletteId);
    }
    this.notify();
    return matching?.id ?? paletteId;
  }

  public paintJointWithPalette(jointId: string, paletteId: string): void {
    if (!this.rig.palette.some((entry) => entry.id === paletteId)) return;
    const joint = this.getJoint(jointId);
    joint.paletteId = paletteId;
    delete joint.color;
    this.notify();
  }

  public paintJointWithColor(jointId: string, color: string): void {
    const paletteId = this.getOrCreatePaletteColor(color);
    if (paletteId) this.paintJointWithPalette(jointId, paletteId);
  }

  public paintFaceWithPalette(faceId: string, paletteId: string): void {
    if (!this.rig.palette.some((entry) => entry.id === paletteId)) return;
    const face = this.getFace(faceId);
    face.paletteId = paletteId;
    delete face.color;
    this.notify();
  }

  public paintFaceWithColor(faceId: string, color: string): void {
    const paletteId = this.getOrCreatePaletteColor(color);
    if (paletteId) this.paintFaceWithPalette(faceId, paletteId);
  }

  private getOrCreatePaletteColor(color: string): string | null {
    if (!isHexColor(color)) return null;
    const existing = this.rig.palette.find((entry) => entry.color.toLowerCase() === color.toLowerCase());
    if (existing) return existing.id;
    let index = this.rig.palette.length + 1;
    let id = `color-${index}`;
    while (this.rig.palette.some((entry) => entry.id === id)) id = `color-${++index}`;
    this.rig.palette.push({ id, color });
    return id;
  }

  public setDefaultColor(color: string): void {
    if (!isHexColor(color)) return;
    this.rig.defaultColor = color;
    this.notify();
  }

  public setAxisAngle(jointId: string, axisId: string, angle: number): void {
    if (!Number.isFinite(angle)) return;
    const joint = this.getJoint(jointId);
    const axis = joint.axes.find(
      (candidate) => candidate.id === axisId,
    );
    if (!axis) {
      throw new Error(`Unknown axis: ${jointId}.${axisId}`);
    }
    if (axis.alignment) return;
    const currentWorldAngle = normalizeAngle(
      getJointWorldTransform(this.rig, jointId).rotation + axis.angle,
    );
    const delta = normalizeSignedAngle(angle - currentWorldAngle);
    const shoulderBand = this.rig.faces.find((face) => face.id === "shoulder-band" && face.rotationTarget.type === "peer");
    if (shoulderBand?.rotationTarget.type === "peer"
      && shoulderBand.vertices.some((vertex) => vertex.jointId === jointId && vertex.axisId === axisId)) {
      const currentAngle = this.getFaceRotationAngle(shoulderBand.id);
      if (currentAngle !== null) this.rotatePeerGroup(shoulderBand.rotationTarget.peerGroupId, currentAngle + delta);
      return;
    }
    const connectionChild = this.findAxisConnectionChild(jointId, axisId);
    if (connectionChild?.parentJointId) {
      const parent = getJointWorldTransform(this.rig, connectionChild.parentJointId);
      const child = getJointWorldTransform(this.rig, connectionChild.id);
      const currentAngle = Math.atan2(child.y - parent.y, child.x - parent.x) * 180 / Math.PI;
      this.rotateChildAroundParent(connectionChild.id, currentAngle + delta);
      return;
    }
    axis.angle = normalizeAngle(angle - getJointWorldTransform(this.rig, jointId).rotation);
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const joint of this.rig.joints) {
      if (joint.axisReferenceJointId) this.alignDirectConnectionAxes(joint.id);
    }
    this.alignShoulderBandAxes();
    if (!this.restoringHistory && !this.transactionStart) {
      const current = cloneRig(this.rig);
      if (!sameRig(this.lastSnapshot, current)) {
        this.undoStack.push(this.lastSnapshot);
        this.redoStack.length = 0;
        this.trimHistory();
        this.lastSnapshot = current;
      }
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private restore(snapshot: Rig): void {
    this.restoringHistory = true;
    Object.assign(this.rig, cloneRig(snapshot));
    this.lastSnapshot = cloneRig(this.rig);
    this.restoringHistory = false;
    this.emit();
  }

  private endOpenTransactionWithoutEmit(): void {
    if (!this.transactionStart) return;
    const current = cloneRig(this.rig);
    if (!sameRig(this.transactionStart, current)) {
      this.undoStack.push(this.transactionStart);
      this.redoStack.length = 0;
      this.trimHistory();
    }
    this.transactionStart = null;
    this.lastSnapshot = current;
  }

  private trimHistory(): void {
    if (this.undoStack.length > 100) this.undoStack.splice(0, this.undoStack.length - 100);
  }

  private getLayerGroup(groupId: string) {
    const group = this.rig.groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error(`Unknown layer group: ${groupId}`);
    return group;
  }

  private getGroupStackOrder(groupId: string | undefined): number {
    return groupId ? this.getLayerGroup(groupId).order : 0;
  }

  private getJointStackOrder(joint: Rig["joints"][number]): number {
    return this.getGroupStackOrder(joint.groupId) + joint.renderOrder;
  }

  private getFaceStackOrder(face: Rig["faces"][number]): number {
    return this.getGroupStackOrder(face.groupId) + this.getFaceLayerOrder(face.id);
  }

  private setJointStackOrder(joint: Rig["joints"][number], stackOrder: number): void {
    joint.renderOrder = clampLayerValue(stackOrder - this.getGroupStackOrder(joint.groupId));
  }

  private setFaceStackOrder(face: Rig["faces"][number], stackOrder: number): void {
    face.layerOrder = clampLayerValue(stackOrder - this.getGroupStackOrder(face.groupId));
  }

  private getBodyStackEntries(): Array<{ type: "joint" | "face" | "shape"; id: string; order: number }> {
    return [
      ...this.rig.joints
        .filter((joint) => joint.bodyVisible)
        .map((joint) => ({ type: "joint" as const, id: joint.id, order: this.getJointStackOrder(joint) })),
      ...this.rig.faces
        .map((face) => ({ type: "face" as const, id: face.id, order: this.getFaceStackOrder(face) })),
      ...(this.rig.artShapes ?? [])
        .map((shape) => ({ type: "shape" as const, id: shape.id, order: this.getGroupStackOrder(shape.groupId) + shape.layerOrder })),
    ];
  }

  private worldToLocal(jointId: string, x: number, y: number): { x: number; y: number } {
    const joint = getJointWorldTransform(this.rig, jointId);
    const radians = -joint.rotation * Math.PI / 180;
    const dx = x - joint.x;
    const dy = y - joint.y;
    return { x: Math.cos(radians) * dx - Math.sin(radians) * dy, y: Math.sin(radians) * dx + Math.cos(radians) * dy };
  }

  private setArtShapeVertexWorldPosition(vertex: ArtShapeVertex, x: number, y: number): void {
    if (vertex.source === "self") {
      vertex.x = x;
      vertex.y = y;
      return;
    }
    if (vertex.source === "root") {
      Object.assign(vertex, this.worldToLocal(vertex.rootJointId, x, y));
      return;
    }
    if (vertex.source === "joint-center") {
      const joint = getJointWorldTransform(this.rig, vertex.jointId);
      const radians = -joint.rotation * Math.PI / 180;
      const dx = x - joint.x;
      const dy = y - joint.y;
      vertex.offsetX = Math.cos(radians) * dx - Math.sin(radians) * dy;
      vertex.offsetY = Math.sin(radians) * dx + Math.cos(radians) * dy;
      return;
    }
    const joint = getJointWorldTransform(this.rig, vertex.jointId);
    const endpoint = getArtShapeVertexPoint(this.rig, { ...vertex, offsetX: 0, offsetY: 0 });
    const radians = -joint.rotation * Math.PI / 180;
    const dx = x - endpoint.x;
    const dy = y - endpoint.y;
    vertex.offsetX = Math.cos(radians) * dx - Math.sin(radians) * dy;
    vertex.offsetY = Math.sin(radians) * dx + Math.cos(radians) * dy;
  }

  private setJointWorldPosition(joint: Rig["joints"][number], x: number, y: number): void {
    if (!joint.parentJointId) {
      joint.x = x;
      joint.y = y;
      return;
    }
    const parent = getJointWorldTransform(this.rig, joint.parentJointId);
    const radians = (-parent.rotation * Math.PI) / 180;
    const relativeX = x - parent.x;
    const relativeY = y - parent.y;
    joint.x = Math.cos(radians) * relativeX - Math.sin(radians) * relativeY;
    joint.y = Math.sin(radians) * relativeX + Math.cos(radians) * relativeY;
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    let currentId: string | undefined = candidateId;
    while (currentId) {
      if (currentId === ancestorId) return true;
      currentId = this.getJoint(currentId).parentJointId;
    }
    return false;
  }

  private getSelectionRoots(jointIds: string[]): string[] {
    const selected = new Set(jointIds);
    return [...selected].filter((jointId) => {
      let parentId = this.getJoint(jointId).parentJointId;
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = this.getJoint(parentId).parentJointId;
      }
      return true;
    });
  }

  private findAxisConnectionChild(jointId: string, axisId: string) {
    const matchesAxis = (face: Rig["faces"][number]) => face.vertices.some(
      (vertex) => vertex.jointId === jointId && vertex.axisId === axisId,
    );
    const outgoing = this.rig.faces.find((face) => {
      if (face.rotationTarget.type !== "child" || !matchesAxis(face)) return false;
      return this.getJoint(face.rotationTarget.childJointId).parentJointId === jointId;
    });
    if (outgoing?.rotationTarget.type === "child") {
      return this.getJoint(outgoing.rotationTarget.childJointId);
    }
    const incoming = this.rig.faces.find((face) => (
      face.rotationTarget.type === "child"
      && face.rotationTarget.childJointId === jointId
      && matchesAxis(face)
    ));
    return incoming ? this.getJoint(jointId) : null;
  }

  private alignDirectConnectionAxes(childJointId: string): void {
    const child = this.getJoint(childJointId);
    if (!child.parentJointId) return;
    const parent = this.getJoint(child.parentJointId);
    const parentWorld = getJointWorldTransform(this.rig, child.axisReferenceJointId ?? parent.id);
    const childWorld = getJointWorldTransform(this.rig, child.id);
    const connectionWorldAngle = Math.atan2(
      childWorld.y - parentWorld.y,
      childWorld.x - parentWorld.x,
    ) * 180 / Math.PI;
    const crossSectionWorldAngle = connectionWorldAngle - 90;

    for (const axis of child.axes) {
      const alignedWorldAngle = axis.alignment === "parent-perpendicular"
        ? crossSectionWorldAngle
        : axis.alignment === "parent-parallel"
          ? connectionWorldAngle
          : null;
      if (alignedWorldAngle !== null) axis.angle = normalizeAngle(alignedWorldAngle - childWorld.rotation);
    }

    const peerGroup = this.rig.peerGroups.find((group) => group.jointIds.includes(child.id));
    const peerCenter = peerGroup ? getPeerGroupCentroid(this.rig, peerGroup.id) : null;
    if (peerGroup) {
      const parentToPeerAngle = Math.atan2(
        peerCenter!.y - parentWorld.y,
        peerCenter!.x - parentWorld.x,
      ) * 180 / Math.PI;

      // Peer-aligned axes share the parent-to-geometric-center reference rather
      // than each member's diagonal. The virtual rotation pivot may be offset
      // independently without changing these structural face boundaries.
      for (const memberId of peerGroup.jointIds) {
        const member = this.getJoint(memberId);
        const memberWorld = getJointWorldTransform(this.rig, member.id);
        for (const axis of member.axes) {
          const alignedWorldAngle = axis.alignment === "parent-peer-perpendicular"
            ? parentToPeerAngle - 90
            : axis.alignment === "parent-peer-parallel"
              ? parentToPeerAngle
              : null;
          if (alignedWorldAngle !== null) {
            axis.angle = normalizeAngle(alignedWorldAngle - memberWorld.rotation);
          }
        }
      }
    }

    // The outer pelvis boundary touches the hip circle exactly. Of the two
    // possible tangents, use the point farther from the hip-pair centroid.
    const tangentReferenceJointId = child.axisReferenceJointId ?? child.parentJointId;
    if (peerCenter && tangentReferenceJointId) {
      const referenceJoint = this.getJoint(tangentReferenceJointId);
      for (const axis of child.axes) {
        if (axis.alignment !== "reference-axis-outer-tangent") continue;
        if (!axis.referenceAxisId || axis.referenceAxisSide === undefined
          || axis.alignedPointSide === undefined) continue;
        const referenceAxis = referenceJoint.axes.find((candidate) => candidate.id === axis.referenceAxisId);
        if (!referenceAxis) continue;
        const referencePoint = getAxisPoint(this.rig, referenceJoint, referenceAxis, axis.referenceAxisSide);
        const tangentPoints = getCircleTangentPoints(referencePoint, childWorld, child.radius);
        if (!tangentPoints) continue;
        const distanceToPeer = (point: { x: number; y: number }) => (
          (point.x - peerCenter.x) ** 2 + (point.y - peerCenter.y) ** 2
        );
        const target = tangentPoints[distanceToPeer(tangentPoints[0]) > distanceToPeer(tangentPoints[1]) ? 0 : 1];
        let alignedWorldAngle = Math.atan2(target.y - childWorld.y, target.x - childWorld.x) * 180 / Math.PI;
        if (axis.alignedPointSide === -1) alignedWorldAngle += 180;
        axis.angle = normalizeAngle(alignedWorldAngle - childWorld.rotation);
      }
    }

    for (const face of this.rig.faces) {
      if (face.rotationTarget.type !== "child" || face.rotationTarget.childJointId !== child.id) continue;
      const jointIds = new Set(face.vertices.map((vertex) => vertex.jointId));
      if (!jointIds.has(parent.id) || !jointIds.has(child.id)) continue;
      for (const vertex of face.vertices) {
        if (vertex.jointId !== parent.id && vertex.jointId !== child.id) continue;
        const endpoint = this.getJoint(vertex.jointId);
        const axis = endpoint.axes.find((candidate) => candidate.id === vertex.axisId);
        if (!axis) continue;
        const endpointWorld = getJointWorldTransform(this.rig, endpoint.id);
        axis.angle = normalizeAngle(crossSectionWorldAngle - endpointWorld.rotation);
      }
    }
  }

  private alignShoulderBandAxes(): void {
    const face = this.rig.faces.find((candidate) => candidate.id === "shoulder-band");
    if (!face || face.rotationTarget.type !== "peer") return;
    const peerGroupId = face.rotationTarget.peerGroupId;
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group || group.jointIds.length !== 2) return;
    const first = getJointWorldTransform(this.rig, group.jointIds[0]);
    const second = getJointWorldTransform(this.rig, group.jointIds[1]);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    if (Math.hypot(dx, dy) < 1e-8) return;
    const axisWorldAngle = Math.atan2(dy, dx) * 180 / Math.PI - 90;
    for (const jointId of group.jointIds) {
      const joint = this.getJoint(jointId);
      const world = getJointWorldTransform(this.rig, jointId);
      for (const vertex of face.vertices) {
        if (vertex.jointId !== jointId) continue;
        const axis = joint.axes.find((candidate) => candidate.id === vertex.axisId);
        if (axis) axis.angle = normalizeAngle(axisWorldAngle - world.rotation);
      }
    }
  }

  private getFaceRotationTarget(faceId: string):
    | { type: "child"; parentJointId: string; childJointId: string }
    | { type: "peer"; peerGroupId: string; referenceJointId: string }
    | null {
    const target = this.getFace(faceId).rotationTarget;
    if (target.type === "peer") return target;
    const child = this.getJoint(target.childJointId);
    return child.parentJointId
      ? { type: "child", parentJointId: child.parentJointId, childJointId: child.id }
      : null;
  }

  /**
   * A child transform already rotates every axis on the child. Rotate the
   * matching axes on its parent as well so faces spanning this connection
   * move as rigid shapes rather than stretching at the parent edge. A torso
   * face can connect the parent to a descendant of the rotated child, so
   * that case is included as well.
   */
  private rotateSharedParentAxes(parentJointId: string, childJointId: string, delta: number): void {
    const sharedAxisIds = new Set<string>();
    for (const face of this.rig.faces) {
      const jointIds = new Set(face.vertices.map((vertex) => vertex.jointId));
      const reachesRotatedBranch = [...jointIds].some(
        (jointId) => jointId === childJointId || this.isDescendant(jointId, childJointId),
      );
      if (!jointIds.has(parentJointId) || !reachesRotatedBranch) continue;
      for (const vertex of face.vertices) {
        if (vertex.jointId === parentJointId) sharedAxisIds.add(vertex.axisId);
      }
    }

    const parent = this.getJoint(parentJointId);
    for (const axis of parent.axes) {
      if (sharedAxisIds.has(axis.id)) {
        axis.angle = normalizeAngle(axis.angle + delta);
      }
    }
  }
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function clampLayerValue(value: number): number {
  return Math.min(999, Math.max(-999, Math.round(value)));
}

function normalizeSignedAngle(angle: number): number {
  const normalized = normalizeAngle(angle);
  return normalized > 180 ? normalized - 360 : normalized;
}

function cloneRig(rig: Rig): Rig {
  return structuredClone(rig);
}

function sameRig(left: Rig, right: Rig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
