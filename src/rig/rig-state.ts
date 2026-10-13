import {
  DEFAULT_RIG_LIMITS,
  type AxisPointSide,
  type Rig,
  type RigLimits,
} from "./types";
import { getJointWorldTransform, getPeerGroupPivot, normalizeAngle } from "./geometry";

const VALID_SIDES = new Set<AxisPointSide>([-1, 1]);

export function validateRig(
  rig: Rig,
  limits: Readonly<RigLimits> = DEFAULT_RIG_LIMITS,
): string[] {
  const errors: string[] = [];
  const jointIds = new Set<string>();
  const faceIds = new Set<string>();

  if (!isHexColor(rig.defaultColor)) {
    errors.push(`Invalid default color: ${rig.defaultColor}`);
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

    if (!(joint.radius > 0)) {
      errors.push(`Joint radius must be positive: ${joint.id}`);
    }
    if (joint.bodyRadius !== undefined && !(joint.bodyRadius > 0)) {
      errors.push(`Joint body radius must be positive: ${joint.id}`);
    }
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
  }

  for (const face of rig.faces) {
    if (faceIds.has(face.id)) {
      errors.push(`Duplicate face id: ${face.id}`);
    }
    faceIds.add(face.id);

    if (face.color !== undefined && !isHexColor(face.color)) {
      errors.push(`Invalid face color: ${face.id}.${face.color}`);
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

  return errors;
}

export class RigState {
  private readonly listeners = new Set<() => void>();

  public constructor(
    public readonly rig: Rig,
    public readonly limits: Readonly<RigLimits> = DEFAULT_RIG_LIMITS,
  ) {
    const errors = validateRig(rig, limits);
    if (errors.length > 0) {
      throw new Error(`Invalid rig:\n${errors.join("\n")}`);
    }
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

  public moveJoint(jointId: string, x: number, y: number): void {
    const joint = this.getJoint(jointId);
    this.setJointWorldPosition(joint, x, y);
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
    this.notify();
  }

  public getValidParents(jointId: string): string[] {
    this.getJoint(jointId);
    return this.rig.joints
      .filter((candidate) => candidate.id !== jointId && !this.isDescendant(candidate.id, jointId))
      .map((candidate) => candidate.id);
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
    this.notify();
  }

  public rotatePeerGroup(peerGroupId: string, worldAngle: number): void {
    const group = this.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
    if (!group) throw new Error(`Unknown peer group: ${peerGroupId}`);
    const pivot = getPeerGroupPivot(this.rig, peerGroupId);
    const first = getJointWorldTransform(this.rig, group.jointIds[0]);
    const currentAngle = Math.atan2(first.y - pivot.y, first.x - pivot.x) * 180 / Math.PI;
    const delta = worldAngle - currentAngle;
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
    this.getJoint("scene-root").localRotation = normalizeAngle(angle);
    this.notify();
  }

  public setJointRadius(jointId: string, radius: number): void {
    if (!Number.isFinite(radius)) return;
    this.getJoint(jointId).radius = Math.min(80, Math.max(8, radius));
    this.notify();
  }

  public setJointBodyVisible(jointId: string, visible: boolean): void {
    this.getJoint(jointId).bodyVisible = visible;
    this.notify();
  }

  public setFaceColor(faceId: string, color: string): void {
    if (!isHexColor(color)) return;
    this.getFace(faceId).color = color;
    this.notify();
  }

  public clearFaceColor(faceId: string): void {
    delete this.getFace(faceId).color;
    this.notify();
  }

  public setDefaultColor(color: string): void {
    if (!isHexColor(color)) return;
    this.rig.defaultColor = color;
    this.notify();
  }

  public setAxisAngle(jointId: string, axisId: string, angle: number): void {
    if (!Number.isFinite(angle)) return;
    const axis = this.getJoint(jointId).axes.find(
      (candidate) => candidate.id === axisId,
    );
    if (!axis) {
      throw new Error(`Unknown axis: ${jointId}.${axisId}`);
    }
    axis.angle = normalizeAngle(angle);
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
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

  private getFaceRotationTarget(faceId: string):
    | { type: "child"; parentJointId: string; childJointId: string }
    | { type: "peer"; peerGroupId: string; referenceJointId: string }
    | null {
    this.getFace(faceId);
    if (faceId === "neck") return { type: "child", parentJointId: "chest", childJointId: "head" };
    if (faceId === "torso") return { type: "child", parentJointId: "waist", childJointId: "chest" };
    if (faceId === "shoulder-band") return { type: "peer", peerGroupId: "shoulder-band", referenceJointId: "left-shoulder" };
    if (faceId === "pelvis") return { type: "child", parentJointId: "waist", childJointId: "pelvis-pivot" };
    const match = /^(left|right)-(upper-arm|lower-arm|upper-leg|lower-leg)$/.exec(faceId);
    if (!match) return null;
    const [, side, segment] = match;
    const relation = {
      "upper-arm": ["shoulder", "elbow"],
      "lower-arm": ["elbow", "wrist"],
      "upper-leg": ["hip", "knee"],
      "lower-leg": ["knee", "ankle"],
    }[segment];
    return relation
      ? { type: "child", parentJointId: `${side}-${relation[0]}`, childJointId: `${side}-${relation[1]}` }
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
