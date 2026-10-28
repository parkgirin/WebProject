import { normalizeAngle } from "./geometry.ts";
import type { Rig } from "./types.ts";

/** Interpolate the shortest path between two degree values. */
export function interpolateAngle(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return normalizeAngle(from + delta * amount);
}

/** Build a temporary 2D pose between compatible rig snapshots. */
export function interpolatePoseRig(start: Rig, end: Rig, amount: number): Rig {
  const t = Math.min(1, Math.max(0, amount));
  const result = structuredClone(start);
  const endById = new Map(end.joints.map((joint) => [joint.id, joint]));

  for (const joint of result.joints) {
    const startJoint = start.joints.find((candidate) => candidate.id === joint.id)!;
    const endJoint = endById.get(joint.id);
    if (!endJoint || startJoint.axes.length !== endJoint.axes.length) {
      throw new Error("보간할 두 포즈의 관절 구조가 일치하지 않습니다.");
    }
    joint.x = lerp(startJoint.x, endJoint.x, t);
    joint.y = lerp(startJoint.y, endJoint.y, t);
    joint.localRotation = interpolateAngle(startJoint.localRotation, endJoint.localRotation, t);
    joint.radius = lerp(startJoint.radius, endJoint.radius, t);
    joint.bodyVisible = t < 1 ? startJoint.bodyVisible : endJoint.bodyVisible;

    for (const axis of joint.axes) {
      const startAxis = startJoint.axes.find((candidate) => candidate.id === axis.id);
      const endAxis = endJoint.axes.find((candidate) => candidate.id === axis.id);
      if (!startAxis || !endAxis) throw new Error("보간할 두 포즈의 축선 구조가 일치하지 않습니다.");
      axis.angle = interpolateAngle(startAxis.angle, endAxis.angle, t);
    }
  }
  return result;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
