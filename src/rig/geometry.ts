import type {
  AxisPointSide,
  Face,
  Joint,
  JointAxis,
  JointPointRef,
  Rig,
} from "./types.ts";

export interface Point {
  x: number;
  y: number;
}

export interface JointWorldTransform extends Point {
  rotation: number;
}

export const PROJECTION_ORIGIN: Point = { x: 300, y: 390 };

/**
 * Convert the editor's depth unit into a bounded 2.5D scale. Keeping this
 * separate from Joint.radius preserves the editable rig proportions.
 */
export function getProjectionScale(rig: Rig, depth = 0): number {
  const strength = Number.isFinite(rig.projectionStrength) ? rig.projectionStrength : 0;
  return Math.min(1.5, Math.max(0.5, 1 + depth * strength / 10_000));
}

/** Depth after rotating the X/depth plane around the canvas vertical Y axis. */
export function getProjectedDepth(rig: Rig, point: Point, depth = 0): number {
  const angle = (rig.viewYRotation * Math.PI) / 180;
  return depth * Math.cos(angle) - (point.x - PROJECTION_ORIGIN.x) * Math.sin(angle);
}

/**
 * Keep a small horizontal silhouette at side view. This is deliberately a
 * 2D rig-preview rule rather than a physical perspective camera: otherwise
 * two joints that differ only on X collapse to one point and their face has
 * zero length.
 */
export function getViewHorizontalScale(rig: Rig): number {
  const cosine = Math.cos((rig.viewYRotation * Math.PI) / 180);
  const retained = (Number.isFinite(rig.silhouetteRetention) ? rig.silhouetteRetention : 0) / 100;
  return cosine + Math.abs(1 - cosine) * retained;
}

/** Interpolate a joint's front radius to its author-provided side-view radius. */
export function getJointViewRadius(rig: Rig, joint: Joint): number {
  const sideRadius = joint.sideRadius ?? joint.radius;
  const amount = Math.min(1, Math.abs(rig.viewYRotation) / 90);
  return joint.radius + (sideRadius - joint.radius) * amount;
}

/** Project a world point away from the canvas centre as it comes forward. */
export function projectPoint(rig: Rig, point: Point, depth = 0): Point {
  const angle = (rig.viewYRotation * Math.PI) / 180;
  const x = point.x - PROJECTION_ORIGIN.x;
  const rotatedX = x * getViewHorizontalScale(rig) + depth * Math.sin(angle);
  const scale = getProjectionScale(rig, getProjectedDepth(rig, point, depth));
  return {
    x: PROJECTION_ORIGIN.x + rotatedX * scale,
    y: PROJECTION_ORIGIN.y + (point.y - PROJECTION_ORIGIN.y) * scale,
  };
}

/** Convert a rendered pointer coordinate back to its unprojected rig point. */
export function unprojectPoint(rig: Rig, point: Point, depth = 0): Point {
  const angle = (rig.viewYRotation * Math.PI) / 180;
  const sine = Math.sin(angle);
  const horizontalScale = getViewHorizontalScale(rig);
  const screenX = point.x - PROJECTION_ORIGIN.x;
  let x = screenX;
  // The depth-dependent scale makes the inverse nonlinear. The selected
  // joint's known depth keeps this one-dimensional Newton solve stable.
  for (let index = 0; index < 8; index += 1) {
    const rotatedX = x * horizontalScale + depth * sine;
    const rotatedDepth = depth * Math.cos(angle) - x * sine;
    const scale = getProjectionScale(rig, rotatedDepth);
    const error = rotatedX * scale - screenX;
    const epsilon = 0.01;
    const nextX = x + epsilon;
    const nextScale = getProjectionScale(rig, depth * Math.cos(angle) - nextX * sine);
    const derivative = ((nextX * horizontalScale + depth * sine) * nextScale - rotatedX * scale) / epsilon;
    if (Math.abs(derivative) < 1e-8) break;
    x -= error / derivative;
  }
  const rotatedDepth = depth * Math.cos(angle) - x * sine;
  const scale = getProjectionScale(rig, rotatedDepth);
  return {
    x: PROJECTION_ORIGIN.x + x,
    y: PROJECTION_ORIGIN.y + (point.y - PROJECTION_ORIGIN.y) / scale,
  };
}

/** Return the two points where lines from an external reference touch a circle. */
export function getCircleTangentPoints(reference: Point, center: Point, radius: number): [Point, Point] | null {
  const dx = reference.x - center.x;
  const dy = reference.y - center.y;
  const distanceSquared = dx * dx + dy * dy;
  const radiusSquared = radius * radius;
  if (!(radius > 0) || distanceSquared <= radiusSquared + 1e-9) return null;
  const baseScale = radiusSquared / distanceSquared;
  const tangentScale = radius * Math.sqrt(distanceSquared - radiusSquared) / distanceSquared;
  const base = { x: center.x + dx * baseScale, y: center.y + dy * baseScale };
  const offset = { x: -dy * tangentScale, y: dx * tangentScale };
  return [
    { x: base.x + offset.x, y: base.y + offset.y },
    { x: base.x - offset.x, y: base.y - offset.y },
  ];
}

export function getJointWorldTransform(
  rig: Rig,
  jointId: string,
  resolving = new Set<string>(),
): JointWorldTransform {
  const joint = rig.joints.find((candidate) => candidate.id === jointId);
  if (!joint) throw new Error(`Unknown joint: ${jointId}`);
  if (resolving.has(jointId)) throw new Error(`Parent cycle at joint: ${jointId}`);

  if (!joint.parentJointId) {
    return { x: joint.x, y: joint.y, rotation: joint.localRotation };
  }

  resolving.add(jointId);
  const parent = getJointWorldTransform(rig, joint.parentJointId, resolving);
  resolving.delete(jointId);
  const radians = (parent.rotation * Math.PI) / 180;
  return {
    x: parent.x + Math.cos(radians) * joint.x - Math.sin(radians) * joint.y,
    y: parent.y + Math.sin(radians) * joint.x + Math.cos(radians) * joint.y,
    rotation: normalizeAngle(parent.rotation + joint.localRotation),
  };
}

export function getJointWorldPoint(rig: Rig, jointId: string): Point {
  const { x, y } = getJointWorldTransform(rig, jointId);
  return { x, y };
}

export function getAxisWorldAngle(rig: Rig, joint: Joint, axis: JointAxis): number {
  return normalizeAngle(getJointWorldTransform(rig, joint.id).rotation + axis.angle);
}

export function getAxisPoint(
  rig: Rig,
  joint: Joint,
  axis: JointAxis,
  side: AxisPointSide,
): Point {
  const world = getJointWorldTransform(rig, joint.id);
  const radians = (getAxisWorldAngle(rig, joint, axis) * Math.PI) / 180;

  return {
    x: world.x + Math.cos(radians) * joint.radius * side,
    y: world.y + Math.sin(radians) * joint.radius * side,
  };
}

export function getJointPoint(rig: Rig, ref: JointPointRef): Point {
  const joint = rig.joints.find((candidate) => candidate.id === ref.jointId);
  if (!joint) {
    throw new Error(`Unknown joint: ${ref.jointId}`);
  }

  const axis = joint.axes.find((candidate) => candidate.id === ref.axisId);
  if (!axis) {
    throw new Error(`Unknown axis: ${ref.jointId}.${ref.axisId}`);
  }

  if (!axis.pointSides.includes(ref.side)) {
    throw new Error(
      `Inactive axis point: ${ref.jointId}.${ref.axisId}[${ref.side}]`,
    );
  }

  return getAxisPoint(rig, joint, axis, ref.side);
}

export function getFacePoints(rig: Rig, face: Face): Point[] {
  return face.vertices.map((vertex) => getJointPoint(rig, vertex));
}

export function getPeerGroupPivot(rig: Rig, peerGroupId: string): Point {
  const group = rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
  if (!group) throw new Error(`Unknown peer group: ${peerGroupId}`);
  if (group.centerJointId) return getJointWorldPoint(rig, group.centerJointId);
  return getPeerGroupCentroid(rig, peerGroupId);
}

export function getPeerGroupCentroid(rig: Rig, peerGroupId: string): Point {
  const group = rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
  if (!group) throw new Error(`Unknown peer group: ${peerGroupId}`);
  const points = group.jointIds.map((jointId) => getJointWorldPoint(rig, jointId));
  const total = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}
