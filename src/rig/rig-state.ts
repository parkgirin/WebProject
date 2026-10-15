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
  const groupIds = new Set<string>();

  if (!isHexColor(rig.defaultColor)) {
    errors.push(`Invalid default color: ${rig.defaultColor}`);
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
    if (joint.groupId && !groupIds.has(joint.groupId)) {
      errors.push(`Unknown joint layer group: ${joint.id}.${joint.groupId}`);
    }

    if (!(joint.radius > 0)) {
      errors.push(`Joint radius must be positive: ${joint.id}`);
    }
    if (joint.bodyRadius !== undefined && !(joint.bodyRadius > 0)) {
      errors.push(`Joint body radius must be positive: ${joint.id}`);
    }
    if (joint.color !== undefined && !isHexColor(joint.color)) {
      errors.push(`Invalid joint color: ${joint.id}.${joint.color}`);
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
    if (!Number.isFinite(face.orderOffset)) {
      errors.push(`Face order offset must be finite: ${face.id}`);
    }
    if (face.layerOrder !== undefined && !Number.isFinite(face.layerOrder)) {
      errors.push(`Face layer order must be finite: ${face.id}`);
    }
    if (face.groupId && !groupIds.has(face.groupId)) {
      errors.push(`Unknown face layer group: ${face.id}.${face.groupId}`);
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
    const errors = validateRig(rig, limits);
    if (errors.length > 0) {
      throw new Error(`Invalid rig:\n${errors.join("\n")}`);
    }
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

  public moveJoint(jointId: string, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const joint = this.getJoint(jointId);
    this.setJointWorldPosition(joint, x, y);
    this.alignDirectConnectionAxes(jointId);
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

  public getLowerBodyRotation(): number {
    const pivot = this.getJoint("pelvis-pivot");
    return normalizeSignedAngle(Math.atan2(pivot.y, pivot.x) * 180 / Math.PI - 90);
  }

  public setLowerBodyRotation(angle: number): void {
    if (!Number.isFinite(angle)) return;
    const pivot = this.getJoint("pelvis-pivot");
    if (!pivot.parentJointId) return;
    const parent = getJointWorldTransform(this.rig, pivot.parentJointId);
    this.rotateChildAroundParent(pivot.id, parent.rotation + 90 + angle);
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

  public setJointColor(jointId: string, color: string): void {
    if (!isHexColor(color)) return;
    this.getJoint(jointId).color = color;
    this.notify();
  }

  public clearJointColor(jointId: string): void {
    delete this.getJoint(jointId).color;
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
    return Math.round(total / Math.max(jointIds.length, 1) + face.orderOffset);
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
    const joint = this.getJoint(jointId);
    const axis = joint.axes.find(
      (candidate) => candidate.id === axisId,
    );
    if (!axis) {
      throw new Error(`Unknown axis: ${jointId}.${axisId}`);
    }
    const currentWorldAngle = normalizeAngle(
      getJointWorldTransform(this.rig, jointId).rotation + axis.angle,
    );
    const delta = normalizeSignedAngle(angle - currentWorldAngle);
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
    const parentWorld = getJointWorldTransform(this.rig, parent.id);
    const childWorld = getJointWorldTransform(this.rig, child.id);
    const crossSectionWorldAngle = Math.atan2(
      childWorld.y - parentWorld.y,
      childWorld.x - parentWorld.x,
    ) * 180 / Math.PI + 90;

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
