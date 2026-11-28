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

export interface ProjectedCircle {
  center: Point;
  radius: number;
}

export interface CameraBasis {
  right: Point3;
  up: Point3;
  forward: Point3;
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

export interface ProjectedTubeGeometry {
  axis: Point3;
  basisU: Point3;
  basisV: Point3;
  startSection: Point[];
  endSection: Point[];
  startSectionDepths: number[];
  endSectionDepths: number[];
  startCenter: Point;
  endCenter: Point;
  startCenterDepth: number;
  endCenterDepth: number;
  side: [Point, Point, Point, Point];
}

function getTubeSectionFrame(rig: Rig, start: Point3, end: Point3): {
  axis: Point3;
  basisU: Point3;
  basisV: Point3;
} | null {
  const axis = normalizeVector3({ x: end.x - start.x, y: end.y - start.y, z: end.z - start.z });
  if (!axis) return null;
  const camera = getCameraBasis(rig);
  const basisU = normalizeVector3(crossVector3(axis, camera.forward))
    ?? normalizeVector3(crossVector3(axis, camera.up));
  if (!basisU) return null;
  const basisV = normalizeVector3(crossVector3(axis, basisU));
  return basisV ? { axis, basisU, basisV } : null;
}

/**
 * Project two real circular tube sections and derive the two longitudinal
 * silhouette edges from their shared convex boundary. The returned side and
 * terminal section therefore use the exact same 3D ring samples.
 */
export function getProjectedTubeGeometry(
  rig: Rig,
  start: Point3,
  end: Point3,
  startRadius: number,
  endRadius: number,
  sides = 32,
): ProjectedTubeGeometry | null {
  const frame = getTubeSectionFrame(rig, start, end);
  if (!frame || sides < 8) return null;
  const { axis, basisU, basisV } = frame;
  const section = (center: Point3, radius: number) => {
    const modelPoints = Array.from({ length: sides }, (_, index) => {
      const angle = Math.PI * 2 * index / sides;
      const cosine = Math.cos(angle) * radius;
      const sine = Math.sin(angle) * radius;
      return {
        x: center.x + basisU.x * cosine + basisV.x * sine,
        y: center.y + basisU.y * cosine + basisV.y * sine,
        z: center.z + basisU.z * cosine + basisV.z * sine,
      };
    });
    return {
      points: modelPoints.map((point) => projectPoint(rig, point, point.z)),
      depths: modelPoints.map((point) => getCameraZ(rig, point, point.z)),
    };
  };
  const startRing = section(start, startRadius);
  const endRing = section(end, endRadius);
  const startSection = startRing.points;
  const endSection = endRing.points;
  type SectionPoint = { point: Point; section: 0 | 1 };
  const candidates: SectionPoint[] = [
    ...startSection.map((point): SectionPoint => ({ point, section: 0 })),
    ...endSection.map((point): SectionPoint => ({ point, section: 1 })),
  ].sort((first, second) => first.point.x - second.point.x || first.point.y - second.point.y);
  const turn = (first: SectionPoint, second: SectionPoint, third: SectionPoint) =>
    (second.point.x - first.point.x) * (third.point.y - first.point.y)
    - (second.point.y - first.point.y) * (third.point.x - first.point.x);
  const halfHull = (points: SectionPoint[]) => {
    const result: SectionPoint[] = [];
    for (const point of points) {
      while (result.length >= 2 && turn(result[result.length - 2], result[result.length - 1], point) <= 1e-9) {
        result.pop();
      }
      result.push(point);
    }
    return result;
  };
  const lower = halfHull(candidates);
  const upper = halfHull([...candidates].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const connections: Array<{ start: Point; end: Point }> = [];
  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index];
    const next = hull[(index + 1) % hull.length];
    if (current.section === next.section) continue;
    connections.push(current.section === 0
      ? { start: current.point, end: next.point }
      : { start: next.point, end: current.point });
  }
  if (connections.length !== 2) return null;
  return {
    axis,
    basisU,
    basisV,
    startSection,
    endSection,
    startSectionDepths: startRing.depths,
    endSectionDepths: endRing.depths,
    startCenter: projectPoint(rig, start, start.z),
    endCenter: projectPoint(rig, end, end.z),
    startCenterDepth: getCameraZ(rig, start, start.z),
    endCenterDepth: getCameraZ(rig, end, end.z),
    side: [connections[0].start, connections[0].end, connections[1].end, connections[1].start],
  };
}

/**
 * Join two already-projected circles along their common external tangents.
 * Equal radii reduce to points perpendicular to the centre line; unequal
 * radii shift both contact normals so the connecting edges remain tangent.
 */
export function getProjectedCircleConnectionSurface(
  start: Point,
  end: Point,
  startRadius: number,
  endRadius: number,
): [Point, Point, Point, Point] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const radiusRatio = (startRadius - endRadius) / length;
  if (Math.abs(radiusRatio) >= 1) return null;
  const direction = { x: dx / length, y: dy / length };
  const perpendicular = { x: -direction.y, y: direction.x };
  const perpendicularScale = Math.sqrt(1 - radiusRatio * radiusRatio);
  const normalA = {
    x: direction.x * radiusRatio + perpendicular.x * perpendicularScale,
    y: direction.y * radiusRatio + perpendicular.y * perpendicularScale,
  };
  const normalB = {
    x: direction.x * radiusRatio - perpendicular.x * perpendicularScale,
    y: direction.y * radiusRatio - perpendicular.y * perpendicularScale,
  };
  return [
    { x: start.x + normalA.x * startRadius, y: start.y + normalA.y * startRadius },
    { x: end.x + normalA.x * endRadius, y: end.y + normalA.y * endRadius },
    { x: end.x + normalB.x * endRadius, y: end.y + normalB.y * endRadius },
    { x: start.x + normalB.x * startRadius, y: start.y + normalB.y * startRadius },
  ];
}

/**
 * Connect two sphere centres with circular end sections perpendicular to the
 * connection axis. Only the two silhouette points needed by the 2D renderer
 * are returned; they still come from the actual 3D section circles.
 */
export function getCameraFacingConnectionSurface(
  rig: Rig,
  startModel: Point3,
  endModel: Point3,
  startRadius: number,
  endRadius: number,
): CameraFacingLimbSurface | null {
  const frame = getTubeSectionFrame(rig, startModel, endModel);
  if (!frame) return null;
  const ringPoint = (center: Point3, radius: number, side: 1 | -1): Point3 => ({
    x: center.x + frame.basisU.x * radius * side,
    y: center.y + frame.basisU.y * radius * side,
    z: center.z + frame.basisU.z * radius * side,
  });
  return {
    points: [
      ringPoint(startModel, startRadius, 1),
      ringPoint(endModel, endRadius, 1),
      ringPoint(endModel, endRadius, -1),
      ringPoint(startModel, startRadius, -1),
    ],
  };
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
  const direction = joint.capsuleFlatAlignment === "peer-inward" ? 1 : -1;
  const rule = joint.capsuleAxisExpansionRules?.[axis!] ?? { mode: "directional" as const, fixedSide: -1 as const };
  const roleDirection = role === derivedRole ? 1 : -1;
  const axisDistance = rule.mode === "centered"
    ? length / 2 * roleDirection
    : (rule.fixedSide ?? -1) === -1
      ? role === derivedRole ? length : 0
      : role === derivedRole ? 0 : -length;
  return {
    x: center.x + dx / distance * axisDistance * direction,
    y: center.y + dy / distance * axisDistance * direction,
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

/** Model-space axes of the current camera plane after every world/view rotation. */
export function getCameraBasis(rig: Rig): CameraBasis {
  const viewY = rig.viewYRotation * Math.PI / 180;
  const world = rig.worldRotation ?? { x: 0, y: 0, z: 0 };
  const inverseWorld = (vector: Point3): Point3 => {
    let { x, y, z } = vector;
    const rz = -world.z * Math.PI / 180;
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    const ry = -world.y * Math.PI / 180;
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    const rx = -world.x * Math.PI / 180;
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    return { x, y, z };
  };
  const inverseViewY = (vector: Point3): Point3 => ({
    x: vector.x * Math.cos(viewY) - vector.z * Math.sin(viewY),
    y: vector.y,
    z: vector.x * Math.sin(viewY) + vector.z * Math.cos(viewY),
  });
  return {
    right: inverseWorld(inverseViewY({ x: 1, y: 0, z: 0 })),
    up: inverseWorld(inverseViewY({ x: 0, y: 1, z: 0 })),
    forward: inverseWorld(inverseViewY({ x: 0, y: 0, z: 1 })),
  };
}

export function rotateVectorAroundAxis(vector: Point3, axis: Point3, angle: number): Point3 {
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dot = vector.x * axis.x + vector.y * axis.y + vector.z * axis.z;
  const cross = {
    x: axis.y * vector.z - axis.z * vector.y,
    y: axis.z * vector.x - axis.x * vector.z,
    z: axis.x * vector.y - axis.y * vector.x,
  };
  return {
    x: vector.x * cosine + cross.x * sine + axis.x * dot * (1 - cosine),
    y: vector.y * cosine + cross.y * sine + axis.y * dot * (1 - cosine),
    z: vector.z * cosine + cross.z * sine + axis.z * dot * (1 - cosine),
  };
}

/**
 * Convert camera-space Z into a bounded 2.5D scale. Keeping this
 * separate from Joint.radius preserves the editable rig proportions.
 */
export function getProjectionScale(rig: Rig, cameraZ = 0): number {
  if (rig.perspectiveEnabled === false) return 1;
  const strength = Number.isFinite(rig.projectionStrength) ? rig.projectionStrength : 0;
  // Treat the UI strength as an inverse focal-length control. The previous
  // linear scale reached the 0.5/1.5 clamps for an ordinary T-pose turned near
  // side-on, pulling its two wrists far above and below the shoulders. A focal
  // projection keeps the same depth ordering while changing size gradually.
  const denominator = Math.max(0.01, 1 - cameraZ * strength / 100_000);
  return Math.min(1.5, Math.max(0.5, 1 / denominator));
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
  const startRadius = getJointViewRadius(rig, startJoint);
  const endRadius = getJointViewRadius(rig, endJoint);
  return getCameraFacingConnectionSurface(rig, startModel, endModel, startRadius, endRadius);
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

/** Project a camera-facing sphere silhouette from one shared centre-depth contract. */
export function projectSphereCircle(rig: Rig, center: Point, z: number, radius: number): ProjectedCircle {
  return {
    center: projectPoint(rig, center, z),
    radius: radius * getProjectionScale(rig, getCameraZ(rig, center, z)),
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
  const length = axis.length ?? joint.radius;
  const axisDistance = axis.expansionRule?.mode === "directional"
    ? side === (axis.expansionRule.fixedSide ?? -1) ? 0 : length * side
    : length * side;

  return {
    x: origin.x + Math.cos(radians) * axisDistance,
    y: origin.y + Math.sin(radians) * axisDistance,
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
