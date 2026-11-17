import type { RigState } from "./rig-state.ts";
import type { Rig } from "./types.ts";
import {
  quaternionFromEuler,
  quaternionToEuler,
  type Quaternion,
  type Vector3Tuple,
} from "../storage/project-document.ts";

export interface CapturedBodyRelativePose {
  rootId: string;
  rootOrientation: Quaternion;
  joints: Array<{
    jointId: string;
    /** Posed unit direction expressed in a deterministic frame attached to the rest vector. */
    directionInRestFrame: Vector3Tuple;
    lengthScale: number;
    orientation: Quaternion;
    axisAngles: Record<string, number>;
  }>;
}

/** Capture only pose parameters, independently from the current body's rest offsets. */
export function captureBodyRelativePose(rig: Rig): CapturedBodyRelativePose {
  const root = rig.joints.find((joint) => !joint.parentJointId) ?? rig.joints[0];
  if (!root) throw new Error("포즈를 저장할 관절이 없습니다.");
  return {
    rootId: root.id,
    rootOrientation: quaternionFromEuler(root.localRotationX ?? 0, root.localRotationY ?? 0, root.localRotation),
    joints: rig.joints.flatMap((joint) => {
      if (!joint.parentJointId) return [];
      const parent = rig.joints.find((candidate) => candidate.id === joint.parentJointId);
      const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: joint.z - (parent?.z ?? 0) };
      const restVector: Vector3Tuple = [rest.x, rest.y, rest.z];
      const posed: Vector3Tuple = [joint.x, joint.y, joint.z - (parent?.z ?? 0)];
      const restLength = Math.hypot(...restVector);
      const posedLength = Math.hypot(...posed);
      return [{
        jointId: joint.id,
        directionInRestFrame: restLength > 1e-9 && posedLength > 1e-9
          ? directionInFrame(posed, restVector) : [1, 0, 0],
        lengthScale: restLength > 1e-9 ? posedLength / restLength : 1,
        orientation: quaternionFromEuler(joint.localRotationX ?? 0, joint.localRotationY ?? 0, joint.localRotation),
        axisAngles: Object.fromEntries(joint.axes.map((axis) => [axis.id, axis.angle])),
      }];
    }),
  };
}

/** Reapply a captured pose once, using the body's newly installed rest offsets. */
export function restoreBodyRelativePose(state: RigState, pose: CapturedBodyRelativePose): void {
  const root = state.rig.joints.find((joint) => joint.id === pose.rootId)
    ?? state.rig.joints.find((joint) => !joint.parentJointId);
  if (!root) return;
  const rootOrientation = quaternionToEuler(pose.rootOrientation);
  state.applyJointPose(root.id, {
    x: root.x, y: root.y, z: root.z,
    localRotation: rootOrientation.z, localRotationX: rootOrientation.x, localRotationY: rootOrientation.y,
    axes: Object.fromEntries(root.axes.map((axis) => [axis.id, axis.angle])),
  });
  for (const value of pose.joints) {
    const joint = state.rig.joints.find((candidate) => candidate.id === value.jointId);
    const parent = joint?.parentJointId
      ? state.rig.joints.find((candidate) => candidate.id === joint.parentJointId) : undefined;
    if (!joint || !parent) continue;
    const rest = joint.baseOffset ?? { x: joint.x, y: joint.y, z: joint.z - parent.z };
    const restVector: Vector3Tuple = [rest.x, rest.y, rest.z];
    const offset = directionFromFrame(value.directionInRestFrame, restVector)
      .map((coordinate) => coordinate * Math.hypot(...restVector) * value.lengthScale) as Vector3Tuple;
    const orientation = quaternionToEuler(value.orientation);
    state.applyJointPose(joint.id, {
      x: offset[0], y: offset[1], z: parent.z + offset[2],
      localRotation: orientation.z, localRotationX: orientation.x, localRotationY: orientation.y,
      distancePercent: value.lengthScale * 100,
      axes: value.axisAngles,
    });
  }
}

function directionInFrame(vector: Vector3Tuple, rest: Vector3Tuple): Vector3Tuple {
  const [forward, tangent, bitangent] = restFrame(rest);
  const direction = normalize(vector);
  return [dot(direction, forward), dot(direction, tangent), dot(direction, bitangent)];
}

function directionFromFrame(value: Vector3Tuple, rest: Vector3Tuple): Vector3Tuple {
  const [forward, tangent, bitangent] = restFrame(rest);
  return normalize([
    forward[0] * value[0] + tangent[0] * value[1] + bitangent[0] * value[2],
    forward[1] * value[0] + tangent[1] * value[1] + bitangent[1] * value[2],
    forward[2] * value[0] + tangent[2] * value[1] + bitangent[2] * value[2],
  ]);
}

function restFrame(rest: Vector3Tuple): [Vector3Tuple, Vector3Tuple, Vector3Tuple] {
  const forward = normalize(rest);
  const reference: Vector3Tuple = Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize(cross(reference, forward));
  return [forward, tangent, cross(forward, tangent)];
}

function normalize(vector: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(...vector);
  return length > 1e-12 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [1, 0, 0];
}

function dot(a: Vector3Tuple, b: Vector3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
