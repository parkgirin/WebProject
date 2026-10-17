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
