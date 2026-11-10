import type {
  AxisPointSide,
  ArtShapeVertex,
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

export interface Point3 extends Point {
  z: number;
}

export interface TubeSurfaceQuad {
  points: [Point3, Point3, Point3, Point3];
  /** Average camera-space Z, for painter's-order rendering. */
  cameraZ: number;
  sideIndex: number;
}

/** The two camera-aligned sphere-circle points at each end of a limb face. */
export interface CameraFacingLimbSurface {
  points: [Point3, Point3, Point3, Point3];
}

/**
 * Resolves a legacy axis endpoint as a fixed point on its joint sphere.
 * The point is part of the model, not a camera-facing billboard point: a
 * side view therefore collapses a zero-depth model exactly at 90 degrees.
 */
export function getCameraFacingJointPoint(rig: Rig, ref: JointPointRef): Point3 {
  const joint = rig.joints.find((candidate) => candidate.id === ref.jointId);
  const axis = joint?.axes.find((candidate) => candidate.id === ref.axisId);
  if (!joint || !axis) throw new Error(`Unknown face sphere point: ${ref.jointId}.${ref.axisId}`);
  const transform = getJointWorldTransform(rig, joint.id);
  const center: Point3 = { x: transform.x, y: transform.y, z: joint.z };
  const axisPoint = getAxisPoint(rig, joint, axis, ref.side);
  const dx = axisPoint.x - center.x;
  const dy = axisPoint.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  const radius = getJointViewRadius(rig, joint);
  return { x: center.x + radius * dx / length, y: center.y + radius * dy / length, z: center.z };
}

export function getCameraFacingFaceSurface(rig: Rig, face: Face): Point3[] {
  return face.vertices.map((vertex) => getCameraFacingJointPoint(rig, vertex));
}

export interface JointWorldTransform extends Point {
  rotation: number;
}

/** Resolve a peer-aligned capsule end without turning it into another joint. */
export function getJointCapsuleEndWorldPoint(
  rig: Rig,
  jointId: string,
  role: "inner" | "outer",
): Point {
  const joint = rig.joints.find((candidate) => candidate.id === jointId);
  if (!joint) throw new Error(`Unknown joint: ${jointId}`);
  const center = getJointWorldTransform(rig, joint.id);
  const group = rig.peerGroups.find((candidate) => candidate.jointIds.length === 2
    && candidate.jointIds.includes(joint.id));
  const otherId = group?.jointIds.find((candidate) => candidate !== joint.id);
  const other = otherId ? getJointWorldTransform(rig, otherId) : null;
  const axis = joint.capsuleFlatAxes?.length === 1 ? joint.capsuleFlatAxes[0] : null;
  const length = axis ? joint.capsuleFlatLengths?.[axis] ?? 0 : 0;
  if (!other || !length || (joint.capsuleFlatAlignment !== "peer-inward"
    && joint.capsuleFlatAlignment !== "peer-outward")) return center;
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return center;
  const derivedRole = joint.capsuleFlatAlignment === "peer-inward" ? "inner" : "outer";
  if (role !== derivedRole) return center;
  const direction = joint.capsuleFlatAlignment === "peer-inward" ? 1 : -1;
  return {
    x: center.x + dx / distance * length * direction,
    y: center.y + dy / distance * length * direction,
  };
}

/** The transform origin inherited by a child, including a derived parent end. */
export function getJointParentWorldTransform(rig: Rig, jointId: string): JointWorldTransform | null {
  const joint = rig.joints.find((candidate) => candidate.id === jointId);
  if (!joint?.parentJointId) return null;
  const parent = getJointWorldTransform(rig, joint.parentJointId);
  if (joint.parentAnchor?.type !== "capsule-end") return parent;
  const point = getJointCapsuleEndWorldPoint(rig, joint.parentJointId, joint.parentAnchor.role);
  return { ...point, rotation: parent.rotation };
}

export const PROJECTION_ORIGIN: Point = { x: 300, y: 390 };

function worldRotate(rig: Rig, point: Point, z: number): Point3 {
  const r = rig.worldRotation ?? { x: 0, y: 0, z: 0 };
  let x = point.x - PROJECTION_ORIGIN.x, y = point.y - PROJECTION_ORIGIN.y, depth = z;
  const rx = r.x * Math.PI / 180, ry = r.y * Math.PI / 180, rz = r.z * Math.PI / 180;
  [y, depth] = [y * Math.cos(rx) - depth * Math.sin(rx), y * Math.sin(rx) + depth * Math.cos(rx)];
  [x, depth] = [x * Math.cos(ry) + depth * Math.sin(ry), -x * Math.sin(ry) + depth * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return { x: PROJECTION_ORIGIN.x + x, y: PROJECTION_ORIGIN.y + y, z: depth };
}

/** Inverse of worldRotate, used to author camera-facing render points in model space. */
function worldUnrotate(rig: Rig, point: Point3): Point3 {
  const r = rig.worldRotation ?? { x: 0, y: 0, z: 0 };
  let x = point.x - PROJECTION_ORIGIN.x, y = point.y - PROJECTION_ORIGIN.y, depth = point.z;
  const rx = -r.x * Math.PI / 180, ry = -r.y * Math.PI / 180, rz = -r.z * Math.PI / 180;
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  [x, depth] = [x * Math.cos(ry) + depth * Math.sin(ry), -x * Math.sin(ry) + depth * Math.cos(ry)];
  [y, depth] = [y * Math.cos(rx) - depth * Math.sin(rx), y * Math.sin(rx) + depth * Math.cos(rx)];
  return { x: PROJECTION_ORIGIN.x + x, y: PROJECTION_ORIGIN.y + y, z: depth };
}

/**
 * Convert camera-space Z into a bounded 2.5D scale. Keeping this
 * separate from Joint.radius preserves the editable rig proportions.
 */
export function getProjectionScale(rig: Rig, cameraZ = 0): number {
  if (rig.perspectiveEnabled === false) return 1;
  const strength = Number.isFinite(rig.projectionStrength) ? rig.projectionStrength : 0;
  return Math.min(1.5, Math.max(0.5, 1 + cameraZ * strength / 10_000));
}

/** Camera-space Z after rotating the X/Z plane around the canvas vertical Y axis. */
export function getCameraZ(rig: Rig, point: Point, z = 0): number {
  const world = worldRotate(rig, point, z);
  const angle = (rig.viewYRotation * Math.PI) / 180;
  return world.z * Math.cos(angle) - (world.x - PROJECTION_ORIGIN.x) * Math.sin(angle);
}

/**
 * Interpolate radius corrections through front → side → back → side → front.
 * Legacy rigs are normalized with a scale of 1, preserving their silhouette.
 */
export function getJointViewRadius(rig: Rig, joint: Joint): number {
  const profiles = rig.bodyViewProfiles;
  const radiusFor = (view: "front" | "side" | "back") => {
    const base = view === "side" ? joint.sideRadius ?? joint.radius : joint.radius;
    return base * (profiles[view].jointRadiusScale[joint.id] ?? 1);
  };
  const front = radiusFor("front");
  const side = radiusFor("side");
  const back = radiusFor("back");
  const angle = (((rig.viewYRotation + (rig.worldRotation?.y ?? 0)) % 360) + 360) % 360;
  if (angle <= 90) return front + (side - front) * angle / 90;
  if (angle <= 180) return side + (back - side) * (angle - 90) / 90;
  if (angle <= 270) return back + (side - back) * (angle - 180) / 90;
  return side + (front - side) * (angle - 270) / 90;
}

/**
 * Builds the rendered boundary of a limb from the apparent circle of each
 * joint sphere. The circle is always perpendicular to the camera direction:
 * its basis is camera-right and screen-up, not an authored joint axis.
 */
export function getCameraFacingLimbSurface(
  rig: Rig,
  startJointId: string,
  endJointId: string,
): CameraFacingLimbSurface | null {
  const startJoint = rig.joints.find((joint) => joint.id === startJointId);
  const endJoint = rig.joints.find((joint) => joint.id === endJointId);
  if (!startJoint || !endJoint) return null;

  const startWorld = getJointWorldTransform(rig, startJointId);
  const endWorld = getJointWorldTransform(rig, endJointId);
  const attachedStart = endJoint.parentJointId === startJoint.id && endJoint.parentAnchor?.type === "capsule-end"
    ? getJointCapsuleEndWorldPoint(rig, startJoint.id, endJoint.parentAnchor.role)
    : startWorld;
  const startModel: Point3 = { x: attachedStart.x, y: attachedStart.y, z: startJoint.z };
  const endModel: Point3 = { x: endWorld.x, y: endWorld.y, z: endJoint.z };
  const start = worldRotate(rig, startModel, startModel.z);
  const end = worldRotate(rig, endModel, endModel.z);
  const tangent = normalizeVector3({ x: end.x - start.x, y: end.y - start.y, z: end.z - start.z });
  if (!tangent) return null;
  const yaw = rig.viewYRotation * Math.PI / 180;
  const cameraForward: Point3 = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  const radial = normalizeVector3(crossVector3(cameraForward, tangent))
    ?? normalizeVector3(crossVector3({ x: 0, y: 1, z: 0 }, tangent))
    ?? { x: 1, y: 0, z: 0 };
  const ringPoint = (center: Point3, radius: number, side: 1 | -1): Point3 => worldUnrotate(rig, {
    x: center.x + radial.x * radius * side,
    y: center.y + radial.y * radius * side,
    z: center.z + radial.z * radius * side,
  });
  const startRadius = getJointViewRadius(rig, startJoint);
  const endRadius = getJointViewRadius(rig, endJoint);
  return {
    points: [
      ringPoint(start, startRadius, 1),
      ringPoint(end, endRadius, 1),
      ringPoint(end, endRadius, -1),
      ringPoint(start, startRadius, -1),
    ],
  };
}

/** Project a world point away from the canvas centre as it comes forward. */
export function projectPoint(rig: Rig, point: Point, z = 0): Point {
  const world = worldRotate(rig, point, z);
  const angle = (rig.viewYRotation * Math.PI) / 180;
  const x = world.x - PROJECTION_ORIGIN.x;
  // A pure Y-axis rotation: do not retain a synthetic side-view silhouette.
  const rotatedX = x * Math.cos(angle) + world.z * Math.sin(angle);
  const scale = getProjectionScale(rig, getCameraZ(rig, point, z));
  return {
    x: PROJECTION_ORIGIN.x + rotatedX * scale,
    y: PROJECTION_ORIGIN.y + (world.y - PROJECTION_ORIGIN.y) * scale,
  };
}

/** Convert a rendered pointer coordinate back to its unprojected rig point. */
export function unprojectPoint(rig: Rig, point: Point, z = 0): Point {
  const angle = (rig.viewYRotation * Math.PI) / 180;
  const sine = Math.sin(angle);
  const screenX = point.x - PROJECTION_ORIGIN.x;
  let x = screenX;
  // The camera-Z-dependent scale makes the inverse nonlinear. The selected
  // joint's known Z coordinate keeps this one-dimensional Newton solve stable.
  for (let index = 0; index < 8; index += 1) {
    const rotatedX = x * Math.cos(angle) + z * sine;
    const cameraZ = z * Math.cos(angle) - x * sine;
    const scale = getProjectionScale(rig, cameraZ);
    const error = rotatedX * scale - screenX;
    const epsilon = 0.01;
    const nextX = x + epsilon;
    const nextScale = getProjectionScale(rig, z * Math.cos(angle) - nextX * sine);
    const derivative = ((nextX * Math.cos(angle) + z * sine) * nextScale - rotatedX * scale) / epsilon;
    if (Math.abs(derivative) < 1e-8) break;
    x -= error / derivative;
  }
  const cameraZ = z * Math.cos(angle) - x * sine;
  const scale = getProjectionScale(rig, cameraZ);
  return {
    x: PROJECTION_ORIGIN.x + x,
    y: PROJECTION_ORIGIN.y + (point.y - PROJECTION_ORIGIN.y) / scale,
  };
}

/**
 * Build the side quads of a circular tube between two existing joints. This
 * uses the current x/y hierarchy and the joints' z coordinates, so it is
 * compatible with the editor's existing 2.5D projection model.
 */
export function getJointTubeSurface(
  rig: Rig,
  startJointId: string,
  endJointId: string,
  sides = 8,
): TubeSurfaceQuad[] {
  const startJoint = rig.joints.find((joint) => joint.id === startJointId);
  const endJoint = rig.joints.find((joint) => joint.id === endJointId);
  if (!startJoint || !endJoint || sides < 3) return [];
  const startWorld = getJointWorldTransform(rig, startJointId);
  const endWorld = getJointWorldTransform(rig, endJointId);
  const start = { x: startWorld.x, y: startWorld.y, z: startJoint.z };
  const end = { x: endWorld.x, y: endWorld.y, z: endJoint.z };
  const axis = normalizeVector3({ x: end.x - start.x, y: end.y - start.y, z: end.z - start.z });
  if (!axis) return [];
  const reference = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const firstRadial = normalizeVector3(crossVector3(axis, reference));
  if (!firstRadial) return [];
  const secondRadial = crossVector3(axis, firstRadial);
  const startRing = createTubeRing(start, firstRadial, secondRadial, startJoint.radius, sides);
  const endRing = createTubeRing(end, firstRadial, secondRadial, endJoint.radius, sides);
  return startRing.map((point, sideIndex) => {
    const next = (sideIndex + 1) % sides;
    const points: [Point3, Point3, Point3, Point3] = [point, startRing[next], endRing[next], endRing[sideIndex]];
    return {
      points,
      cameraZ: points.reduce((sum, candidate) => sum + getCameraZ(rig, candidate, candidate.z), 0) / points.length,
      sideIndex,
    };
  });
}

function createTubeRing(
  center: Point3,
  firstRadial: Point3,
  secondRadial: Point3,
  radius: number,
  sides: number,
): Point3[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = Math.PI * 2 * index / sides;
    const firstAmount = Math.cos(angle) * radius;
    const secondAmount = Math.sin(angle) * radius;
    return {
      x: center.x + firstRadial.x * firstAmount + secondRadial.x * secondAmount,
      y: center.y + firstRadial.y * firstAmount + secondRadial.y * secondAmount,
      z: center.z + firstRadial.z * firstAmount + secondRadial.z * secondAmount,
    };
  });
}

function crossVector3(first: Point3, second: Point3): Point3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function normalizeVector3(value: Point3): Point3 | null {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 1e-9 ? { x: value.x / length, y: value.y / length, z: value.z / length } : null;
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
  const parentJoint = getJointWorldTransform(rig, joint.parentJointId, resolving);
  resolving.delete(jointId);
  const parent = joint.parentAnchor?.type === "capsule-end"
    ? { ...getJointCapsuleEndWorldPoint(rig, joint.parentJointId, joint.parentAnchor.role), rotation: parentJoint.rotation }
    : parentJoint;
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
  const attachedChild = axis.alignment === "child-perpendicular"
    ? rig.joints.find((candidate) => candidate.parentJointId === joint.id
      && candidate.parentAnchor?.type === "capsule-end")
    : undefined;
  const origin = attachedChild ? getJointParentWorldTransform(rig, attachedChild.id) ?? world : world;
  const radians = (getAxisWorldAngle(rig, joint, axis) * Math.PI) / 180;

  return {
    x: origin.x + Math.cos(radians) * (axis.length ?? joint.radius) * side,
    y: origin.y + Math.sin(radians) * (axis.length ?? joint.radius) * side,
  };
}

export function getArtShapeVertexPoint(rig: Rig, vertex: ArtShapeVertex): Point {
  if (vertex.source === "self") return { x: vertex.x, y: vertex.y };
  if (vertex.source === "root") {
    const root = getJointWorldTransform(rig, vertex.rootJointId);
    const radians = root.rotation * Math.PI / 180;
    return {
      x: root.x + Math.cos(radians) * vertex.x - Math.sin(radians) * vertex.y,
      y: root.y + Math.sin(radians) * vertex.x + Math.cos(radians) * vertex.y,
    };
  }
  if (vertex.source === "joint-center") {
    const joint = getJointWorldTransform(rig, vertex.jointId);
    const radians = joint.rotation * Math.PI / 180;
    return {
      x: joint.x + Math.cos(radians) * vertex.offsetX - Math.sin(radians) * vertex.offsetY,
      y: joint.y + Math.sin(radians) * vertex.offsetX + Math.cos(radians) * vertex.offsetY,
    };
  }
  const joint = rig.joints.find((candidate) => candidate.id === vertex.jointId);
  const axis = joint?.axes.find((candidate) => candidate.id === vertex.axisId);
  if (!joint || !axis) throw new Error(`Unknown art shape axis point: ${vertex.jointId}.${vertex.axisId}`);
  const endpoint = getAxisPoint(rig, joint, axis, vertex.side);
  const world = getJointWorldTransform(rig, joint.id);
  const radians = world.rotation * Math.PI / 180;
  return {
    x: endpoint.x + Math.cos(radians) * vertex.offsetX - Math.sin(radians) * vertex.offsetY,
    y: endpoint.y + Math.sin(radians) * vertex.offsetX + Math.cos(radians) * vertex.offsetY,
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
