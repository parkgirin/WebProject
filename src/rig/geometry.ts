import type {
  AxisPointSide,
  Face,
  Joint,
  JointAxis,
  JointPointRef,
  Rig,
} from "./types";

export interface Point {
  x: number;
  y: number;
}

export function getAxisPoint(
  joint: Joint,
  axis: JointAxis,
  side: AxisPointSide,
): Point {
  const radians = (axis.angle * Math.PI) / 180;

  return {
    x: joint.x + Math.cos(radians) * joint.radius * side,
    y: joint.y + Math.sin(radians) * joint.radius * side,
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

  return getAxisPoint(joint, axis, ref.side);
}

export function getFacePoints(rig: Rig, face: Face): Point[] {
  return face.vertices.map((vertex) => getJointPoint(rig, vertex));
}
