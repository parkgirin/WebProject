import type { ArtCompositeMode, ArtShape, ArtShapeVertex, Rig } from "../rig/types.ts";
import { getArtShapeVertexPoint, getAxisPoint, getAxisWorldAngle, getCameraBasis, getCameraFacingFaceSurface, getCameraZ, getFacePoints, getJointParentWorldTransform, getJointViewRadius, getJointWorldTransform, getPeerGroupPivot, getProjectedCircleConnectionSurface, getProjectionScale, projectPoint, projectSphereCircle, type Point, type Point3, type ProjectedCircle } from "../rig/geometry.ts";
import { boundsOf, boundsOverlap, sphereDepthAt, surfaceDepthRange, tubeCoordinatesAt, type RenderSurface, type SphereRenderSurface, type TubeRenderSurface } from "../rig/surface-geometry.ts";
import type { EditorSelection, EditorViewState } from "./types.ts";

export function renderSvgEditor(
  host: SVGSVGElement,
  rig: Rig,
  selection: EditorSelection,
  viewState: EditorViewState,
): void {
  const showJointLayer = rig.elementLayers?.joints !== false;
  const showAxisLayer = rig.elementLayers?.axes !== false;
  const showFaceLayer = rig.elementLayers?.faces !== false;
  const showShapeLayer = rig.elementLayers?.shapes !== false;
  const zOf = (jointId: string) => rig.joints.find((joint) => joint.id === jointId)?.z ?? 0;
  const vertexDepth = (vertex: ArtShapeVertex) => {
    const jointId = vertex.source === "axis-point" ? vertex.jointId
      : vertex.source === "root" ? vertex.rootJointId : vertex.source === "joint-center" ? vertex.jointId : null;
    return jointId ? zOf(jointId) : 0;
  };
  const project = (point: Point, depth = 0) => projectPoint(rig, point, depth);
  const projectJoint = (jointId: string) => project(getJointWorldTransform(rig, jointId), zOf(jointId));
  const scaleOf = (jointId: string) => {
    const world = getJointWorldTransform(rig, jointId);
    return getProjectionScale(rig, getCameraZ(rig, world, zOf(jointId)));
  };
  const viewRadiusOf = (jointId: string) => getJointViewRadius(rig, rig.joints.find((joint) => joint.id === jointId)!);
  const bodyRadiusOf = (jointId: string) => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId)!;
    const bodyRadius = joint.bodyRadius ?? joint.radius;
    return bodyRadius * viewRadiusOf(jointId) / joint.radius;
  };
  type CapsuleSphere = { center: Point3; radius: number };
  const jointCapsuleSpheres = (jointId: string): [CapsuleSphere, CapsuleSphere] | null => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId);
    const flatAxes = joint?.capsuleFlatAxes ?? [];
    if (!joint || flatAxes.length !== 1) return null;
    const surfaceScale = joint.surfaceScale ?? { x: 1, y: 1, z: 1 };
    if (Math.max(surfaceScale.x, surfaceScale.y, surfaceScale.z)
      - Math.min(surfaceScale.x, surfaceScale.y, surfaceScale.z) > 1e-9) return null;
    const axis = flatAxes[0];
    const flatLength = joint.capsuleFlatLengths?.[axis] ?? 0;
    const center = getJointWorldTransform(rig, joint.id);
    const sphere = (world: Point, depth: number): CapsuleSphere => ({
      center: { x: world.x, y: world.y, z: depth },
      radius: bodyRadiusOf(joint.id) * surfaceScale.x,
    });
    if (joint.capsuleFlatAlignment === "peer-inward" || joint.capsuleFlatAlignment === "peer-outward") {
      const peerGroup = rig.peerGroups.find((group) => group.jointIds.length === 2
        && group.jointIds.includes(joint.id));
      const otherId = peerGroup?.jointIds.find((candidate) => candidate !== joint.id);
      const other = otherId ? rig.joints.find((candidate) => candidate.id === otherId) : undefined;
      if (other) {
        const otherCenter = getJointWorldTransform(rig, other.id);
        const dx = otherCenter.x - center.x;
        const dy = otherCenter.y - center.y;
        const dz = other.z - joint.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > 1e-9) {
          const direction = joint.capsuleFlatAlignment === "peer-inward" ? 1 : -1;
          const inner = {
            x: center.x + dx / distance * flatLength * direction,
            y: center.y + dy / distance * flatLength * direction,
          };
          return [sphere(center, joint.z), sphere(inner, joint.z + dz / distance * flatLength * direction)];
        }
      }
    }
    const halfLength = flatLength / 2;
    const radiansX = (joint.localRotationX ?? 0) * Math.PI / 180;
    const radiansY = (joint.localRotationY ?? 0) * Math.PI / 180;
    const radiansZ = center.rotation * Math.PI / 180;
    const endpoint = (side: -1 | 1): CapsuleSphere => {
      let x = axis === "x" ? halfLength * side : 0;
      let y = axis === "y" ? halfLength * side : 0;
      let z = axis === "z" ? halfLength * side : 0;
      [y, z] = [y * Math.cos(radiansX) - z * Math.sin(radiansX), y * Math.sin(radiansX) + z * Math.cos(radiansX)];
      [x, z] = [x * Math.cos(radiansY) + z * Math.sin(radiansY), -x * Math.sin(radiansY) + z * Math.cos(radiansY)];
      [x, y] = [x * Math.cos(radiansZ) - y * Math.sin(radiansZ), x * Math.sin(radiansZ) + y * Math.cos(radiansZ)];
      const world = { x: center.x + x, y: center.y + y };
      const depth = joint.z + z;
      return sphere(world, depth);
    };
    return [endpoint(-1), endpoint(1)];
  };
  const projectedJointCapsuleCircles = (jointId: string): [ProjectedCircle, ProjectedCircle] | null => {
    const spheres = jointCapsuleSpheres(jointId);
    if (!spheres) return null;
    return spheres.map(({ center, radius }) => projectSphereCircle(rig, center, center.z, radius)) as [ProjectedCircle, ProjectedCircle];
  };
  const projectedJointCircle = (jointId: string): ProjectedCircle => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId);
    if (!joint) throw new Error(`Unknown joint: ${jointId}`);
    return projectSphereCircle(rig, getJointWorldTransform(rig, jointId), joint.z, bodyRadiusOf(jointId));
  };
  const projectedJointConnectionSurface = (startJointId: string, endJointId: string): Point[] | null => {
    const startJoint = rig.joints.find((joint) => joint.id === startJointId);
    const endJoint = rig.joints.find((joint) => joint.id === endJointId);
    if (!startJoint || !endJoint) return null;
    let startCircle = projectedJointCircle(startJoint.id);
    if (endJoint.parentJointId === startJoint.id && endJoint.parentAnchor?.type === "capsule-end") {
      const spheres = jointCapsuleSpheres(startJoint.id);
      const anchoredSphere = spheres?.[1];
      if (anchoredSphere) {
        startCircle = projectSphereCircle(rig, anchoredSphere.center, anchoredSphere.center.z, anchoredSphere.radius);
      }
    }
    const endCircle = projectedJointCircle(endJoint.id);
    return getProjectedCircleConnectionSurface(
      startCircle.center,
      endCircle.center,
      startCircle.radius,
      endCircle.radius,
    );
  };
  const sampleCircle = (circle: ProjectedCircle, sides = 24): Point[] => Array.from({ length: sides }, (_, index) => {
    const angle = Math.PI * 2 * index / sides;
    return {
      x: circle.center.x + Math.cos(angle) * circle.radius,
      y: circle.center.y + Math.sin(angle) * circle.radius,
    };
  });
  const connectionOutlinePath = (points: readonly Point[], layout: "limb" | "strip"): string => {
    if (points.length !== 4) return "";
    // Endpoint caps overlap their connected capsules. Keep only the two
    // longitudinal silhouette edges; the vertex winding differs by source.
    const edges = layout === "limb" ? [[0, 1], [2, 3]] : [[1, 2], [3, 0]];
    return edges.map(([start, end]) => `M ${points[start].x} ${points[start].y} L ${points[end].x} ${points[end].y}`).join(" ");
  };
  const outerConnectionEdge = (
    points: readonly Point[],
    sectionStart: Point,
    sectionEnd: Point,
  ): [Point, Point] | null => {
    if (points.length !== 4) return null;
    const centerDx = sectionEnd.x - sectionStart.x;
    const centerDy = sectionEnd.y - sectionStart.y;
    const centerLength = Math.hypot(centerDx, centerDy);
    const distanceFromCenterLine = (startIndex: number, endIndex: number) => {
      const midpoint = {
        x: (points[startIndex].x + points[endIndex].x) / 2,
        y: (points[startIndex].y + points[endIndex].y) / 2,
      };
      if (centerLength < 1e-9) return Math.hypot(midpoint.x - sectionStart.x, midpoint.y - sectionStart.y);
      return Math.abs(centerDx * (midpoint.y - sectionStart.y) - centerDy * (midpoint.x - sectionStart.x))
        / centerLength;
    };
    const edgeA: [number, number] = [0, 1];
    const edgeB: [number, number] = [2, 3];
    if (distanceFromCenterLine(...edgeA) >= distanceFromCenterLine(...edgeB)) {
      return [points[0], points[1]];
    }
    // The polygon's second tangent runs from capsule B back to capsule A.
    // Normalize it so both candidates are returned A -> B.
    return [points[3], points[2]];
  };
  // The shoulder band, torso loft, and waist-to-hip loft form one visual
  // torso group.  Their outlines are drawn as individual open silhouette
  // edges, then masked by their sibling surfaces so only the group's outer
  // contour survives.
  const torsoConnectionSurfaces: Array<{ id: string; points: Point[] }> = [];
  const torsoConnectionOutlineMaskId = (id: string) => `torso-connection-outline-mask-${id}`;
  const capsuleSupport = (circles: readonly ProjectedCircle[], normal: Point, direction: -1 | 1): Point => {
    const circle = circles.reduce((selected, candidate) => {
      const selectedScore = direction * (selected.center.x * normal.x + selected.center.y * normal.y) + selected.radius;
      const candidateScore = direction * (candidate.center.x * normal.x + candidate.center.y * normal.y) + candidate.radius;
      return candidateScore > selectedScore ? candidate : selected;
    });
    return {
      x: circle.center.x + normal.x * circle.radius * direction,
      y: circle.center.y + normal.y * circle.radius * direction,
    };
  };
  const renderedDepthOf = (jointId: string) => {
    const world = getJointWorldTransform(rig, jointId);
    return getCameraZ(rig, world, zOf(jointId));
  };
  // Project every axis endpoint with the same X/Z transform as its joint
  // centre. Keeping endpoints in screen space makes the connecting faces
  // appear to move independently while the view rotates.
  const projectedAxisPoint = (jointId: string, axisId: string, side: -1 | 1): Point => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId)!;
    const axis = joint.axes.find((candidate) => candidate.id === axisId)!;
    return project(getAxisPoint(rig, joint, axis, side), zOf(jointId));
  };
  const visibleJoints = rig.joints
    .filter((joint) => showJointLayer && joint.bodyVisible && isGroupVisible(rig, joint.groupId));
  const virtualCapsuleFaceIds = new Set(rig.peerGroups
    .filter((group) => group.virtualCapsule && group.jointIds.length === 2)
    .map((group) => group.id));
  const faceDefinitions = rig.faces.filter((face) => face.proceduralSurface !== "torso"
    && face.proceduralSurface !== "waist-hip"
    && !virtualCapsuleFaceIds.has(face.id)
    && showFaceLayer && isGroupVisible(rig, face.groupId));
  const visibleFaces = faceDefinitions.flatMap((face) => {
    if (face.cameraFacingLimb) {
      const points = projectedJointConnectionSurface(
        face.cameraFacingLimb.startJointId,
        face.cameraFacingLimb.endJointId,
      );
      return points ? [{ face, points }] : [];
    }
    return [{ face, points: getCameraFacingFaceSurface(rig, face).map((point) => project(point, point.z)) }];
  });
  const neckSurface = visibleFaces.find(({ face }) => face.id === "neck");
  if (neckSurface) torsoConnectionSurfaces.push({ id: "neck", points: neckSurface.points });
  const sphereSurfaces: SphereRenderSurface[] = [
    ...visibleJoints.map((joint): SphereRenderSurface => {
      const circle = projectedJointCircle(joint.id);
      const radius = bodyRadiusOf(joint.id);
      return {
        kind: "sphere",
        id: `joint:${joint.id}`,
        source: "joint",
        sourceId: joint.id,
        attachedJointId: joint.id,
        center: circle.center,
        projectedRadius: circle.radius,
        centerDepth: renderedDepthOf(joint.id),
        radius,
        groupId: joint.groupId,
        order: joint.renderOrder,
        bounds: {
          minX: circle.center.x - circle.radius,
          minY: circle.center.y - circle.radius,
          maxX: circle.center.x + circle.radius,
          maxY: circle.center.y + circle.radius,
        },
      };
    }),
    ...(rig.artShapes ?? []).flatMap((shape): SphereRenderSurface[] => {
      const vertex = shape.vertices[0];
      if (!showShapeLayer || shape.kind !== "sphere" || !vertex
        || (shape.compositeMode ?? "paint") !== "paint" || !isGroupVisible(rig, shape.groupId)) return [];
      const center = getArtShapeVertexPoint(rig, vertex);
      const depth = vertexDepth(vertex);
      const radius = shape.radius ?? 1;
      const circle = projectSphereCircle(rig, center, depth, radius);
      return [{
        kind: "sphere",
        id: `shape:${shape.id}`,
        source: "shape",
        sourceId: shape.id,
        attachedJointId: vertex.source === "joint-center" ? vertex.jointId : undefined,
        center: circle.center,
        projectedRadius: circle.radius,
        centerDepth: getCameraZ(rig, center, depth),
        radius,
        groupId: shape.groupId,
        order: shape.layerOrder,
        bounds: {
          minX: circle.center.x - circle.radius,
          minY: circle.center.y - circle.radius,
          maxX: circle.center.x + circle.radius,
          maxY: circle.center.y + circle.radius,
        },
      }];
    }),
  ];
  const surfaceOcclusionMaskIds = new Map<string, string>();
  const surfaceOcclusionMaskDefs: string[] = [];
  const surfaceIntersectionPaths = new Map<string, string>();
  const connectedSphereOutlineMaskIds = new Map<string, string>();
  const connectedSphereOutlineMaskDefs: string[] = [];
  const lerpPoint = (start: Point, end: Point, amount: number): Point => ({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  });
  const connectedSphereShapes = (jointIds: readonly string[]) => sphereSurfaces.filter((surface) =>
    surface.source === "shape" && surface.attachedJointId && jointIds.includes(surface.attachedJointId));
  for (const { face, points } of visibleFaces) {
    if (!face.cameraFacingLimb || points.length !== 4) continue;
    const { startJointId, endJointId } = face.cameraFacingLimb;
    const connectedSpheres = connectedSphereShapes([startJointId, endJointId]);
    if (!connectedSpheres.length) continue;
    const outlineMaskId = `connected-sphere-outline-mask-${face.id}`;
    connectedSphereOutlineMaskIds.set(face.id, outlineMaskId);
    connectedSphereOutlineMaskDefs.push(`<mask id="${escapeXml(outlineMaskId)}" data-connected-sphere-outline-face-id="${escapeXml(face.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${connectedSpheres.map((surface) => `<circle cx="${surface.center.x}" cy="${surface.center.y}" r="${surface.projectedRadius}" fill="#000" />`).join("")}
    </mask>`);
    const startDepth = renderedDepthOf(startJointId);
    const endDepth = renderedDepthOf(endJointId);
    const startRadius = bodyRadiusOf(startJointId);
    const endRadius = bodyRadiusOf(endJointId);
    const slices: Array<{ left: Point; right: Point } | null> = [];
    const longitudinalSteps = 36;
    const crossSteps = 28;
    const isSphereInFront = (point: Point, t: number, cross: number) => {
      const tubeRadius = startRadius + (endRadius - startRadius) * t;
      const radial = Math.abs(cross * 2 - 1);
      const tubeDepth = startDepth + (endDepth - startDepth) * t
        + tubeRadius * Math.sqrt(Math.max(0, 1 - radial * radial));
      return connectedSpheres.some((surface) => (sphereDepthAt(surface, point) ?? Number.NEGATIVE_INFINITY)
        > tubeDepth + 1e-5);
    };
    for (let step = 0; step <= longitudinalSteps; step += 1) {
      const t = step / longitudinalSteps;
      const edgeA = lerpPoint(points[0], points[1], t);
      const edgeB = lerpPoint(points[3], points[2], t);
      const samples = Array.from({ length: crossSteps + 1 }, (_, index) => {
        const cross = index / crossSteps;
        const point = lerpPoint(edgeA, edgeB, cross);
        return { cross, point, hidden: isSphereInFront(point, t, cross) };
      });
      const hiddenIndexes = samples.flatMap((sample, index) => sample.hidden ? [index] : []);
      if (!hiddenIndexes.length) {
        slices.push(null);
        continue;
      }
      const refineBoundary = (outside: number, inside: number) => {
        let outsideCross = samples[outside]?.cross ?? samples[inside].cross;
        let insideCross = samples[inside].cross;
        for (let iteration = 0; iteration < 8; iteration += 1) {
          const middle = (outsideCross + insideCross) / 2;
          const point = lerpPoint(edgeA, edgeB, middle);
          if (isSphereInFront(point, t, middle)) insideCross = middle;
          else outsideCross = middle;
        }
        return lerpPoint(edgeA, edgeB, insideCross);
      };
      const first = hiddenIndexes[0];
      const last = hiddenIndexes[hiddenIndexes.length - 1];
      const left = first === 0 ? samples[first].point : refineBoundary(first - 1, first);
      const right = last === crossSteps ? samples[last].point : refineBoundary(last + 1, last);
      slices.push({ left, right });
    }
    const preferEnd = connectedSpheres.some((surface) => surface.attachedJointId === endJointId);
    const intersectionPoints: Point[] = [];
    for (let crossStep = 0; crossStep <= crossSteps; crossStep += 1) {
      const cross = crossStep / crossSteps;
      const samples = Array.from({ length: longitudinalSteps + 1 }, (_, index) => {
        const t = index / longitudinalSteps;
        const edgeA = lerpPoint(points[0], points[1], t);
        const edgeB = lerpPoint(points[3], points[2], t);
        const point = lerpPoint(edgeA, edgeB, cross);
        return { t, hidden: isSphereInFront(point, t, cross) };
      });
      const transitions = samples.slice(1).flatMap((sample, index) =>
        sample.hidden !== samples[index].hidden ? [[samples[index], sample] as const] : []);
      const transition = preferEnd ? transitions.at(-1) : transitions[0];
      if (!transition) continue;
      let [outside, inside] = transition[0].hidden ? [transition[1].t, transition[0].t]
        : [transition[0].t, transition[1].t];
      for (let iteration = 0; iteration < 9; iteration += 1) {
        const middle = (outside + inside) / 2;
        const edgeA = lerpPoint(points[0], points[1], middle);
        const edgeB = lerpPoint(points[3], points[2], middle);
        const point = lerpPoint(edgeA, edgeB, cross);
        if (isSphereInFront(point, middle, cross)) inside = middle;
        else outside = middle;
      }
      const edgeA = lerpPoint(points[0], points[1], inside);
      const edgeB = lerpPoint(points[3], points[2], inside);
      intersectionPoints.push(lerpPoint(edgeA, edgeB, cross));
    }
    if (intersectionPoints.length >= 2) {
      const start = intersectionPoints[0];
      const middle = intersectionPoints[Math.floor(intersectionPoints.length / 2)];
      const end = intersectionPoints[intersectionPoints.length - 1];
      // Fit one quadratic curve through the sampled midpoint. This preserves
      // the calculated surface intersection without exposing sampling kinks
      // or tiny self-crossing loops in the exported outline.
      const control = {
        x: middle.x * 2 - (start.x + end.x) / 2,
        y: middle.y * 2 - (start.y + end.y) / 2,
      };
      surfaceIntersectionPaths.set(face.id,
        `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`);
    }
    const polygons: Point[][] = [];
    let segment: Array<{ left: Point; right: Point }> = [];
    for (const slice of [...slices, null]) {
      if (slice) {
        segment.push(slice);
        continue;
      }
      if (segment.length >= 2) polygons.push([
        ...segment.map(({ left }) => left),
        ...segment.map(({ right }) => right).reverse(),
      ]);
      segment = [];
    }
    if (!polygons.length) continue;
    const maskId = `surface-occlusion-mask-${face.id}`;
    surfaceOcclusionMaskIds.set(face.id, maskId);
    surfaceOcclusionMaskDefs.push(`<mask id="${escapeXml(maskId)}" data-surface-occlusion-face-id="${escapeXml(face.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${polygons.map((polygon) => `<polygon data-surface-depth-occluder points="${polygon.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" />`).join("")}
    </mask>`);
  }
  type FaceTubeSurface = TubeRenderSurface & { face: (typeof visibleFaces)[number]["face"] };
  const limbSurfaces: FaceTubeSurface[] = visibleFaces.flatMap(({ face, points }) => {
    if (!face.cameraFacingLimb || points.length !== 4) return [];
    const jointIds: [string, string] = [face.cameraFacingLimb.startJointId, face.cameraFacingLimb.endJointId];
    return [{
      kind: "tube" as const,
      id: `face:${face.id}`,
      face, points: points as [Point, Point, Point, Point], jointIds,
      groupId: face.groupId,
      order: getFaceOrder(rig, face),
      startDepth: renderedDepthOf(jointIds[0]),
      endDepth: renderedDepthOf(jointIds[1]),
      startRadius: bodyRadiusOf(jointIds[0]),
      endRadius: bodyRadiusOf(jointIds[1]),
      bounds: boundsOf(points),
    }];
  });
  const canOcclude = (target: RenderSurface, candidate: RenderSurface) => (
    boundsOverlap(target.bounds, candidate.bounds)
    && surfaceDepthRange(candidate).max > surfaceDepthRange(target).min + 1e-5
  );
  const tubeOcclusionMaskIds = new Map<string, string>();
  const tubeOcclusionMaskDefs: string[] = [];
  for (const target of limbSurfaces) {
    const occlusionPolygons: Array<{ faceId: string; points: Point[] }> = [];
    const tubeCandidates = limbSurfaces.filter((candidate) => candidate !== target
      && canOcclude(target, candidate)
      && !candidate.jointIds.some((jointId) => target.jointIds.includes(jointId)))
      .map((candidate) => ({
        id: candidate.face.id,
        groupId: candidate.face.groupId,
        order: getFaceOrder(rig, candidate.face),
        depthAt: (point: Point) => tubeCoordinatesAt(candidate, point)?.depth ?? null,
      }));
    const sphereCandidates = sphereSurfaces
      .filter((surface) => !surface.attachedJointId || !target.jointIds.includes(surface.attachedJointId))
      .filter((surface) => canOcclude(target, surface))
      .map((surface) => ({
        id: surface.id,
        groupId: surface.groupId,
        order: surface.order,
        depthAt: (point: Point) => sphereDepthAt(surface, point),
      }));
    const candidates = [...tubeCandidates, ...sphereCandidates];
    for (const candidate of candidates) {
      const slices: Array<{ left: Point; right: Point } | null> = [];
      const isCandidateInFront = (point: Point, t: number, cross: number) => {
        const candidateDepth = candidate.depthAt(point);
        if (candidateDepth === null) return false;
        const targetRadius = target.startRadius + (target.endRadius - target.startRadius) * t;
        const radial = Math.abs(cross * 2 - 1);
        const targetDepth = target.startDepth + (target.endDepth - target.startDepth) * t
          + targetRadius * Math.sqrt(Math.max(0, 1 - radial * radial));
        const difference = candidateDepth - targetDepth;
        if (Math.abs(difference) > 1e-5) return difference > 0;
        return compareItemStackOrder(rig, {
          groupId: target.face.groupId, order: getFaceOrder(rig, target.face), depth: targetDepth,
        }, {
          groupId: candidate.groupId, order: candidate.order, depth: candidateDepth,
        }) < 0;
      };
      const longitudinalSteps = 28;
      const crossSteps = 20;
      for (let step = 0; step <= longitudinalSteps; step += 1) {
        const t = step / longitudinalSteps;
        const edgeA = lerpPoint(target.points[0], target.points[1], t);
        const edgeB = lerpPoint(target.points[3], target.points[2], t);
        const samples = Array.from({ length: crossSteps + 1 }, (_, index) => {
          const cross = index / crossSteps;
          const point = lerpPoint(edgeA, edgeB, cross);
          return { cross, point, hidden: isCandidateInFront(point, t, cross) };
        });
        const hiddenIndexes = samples.flatMap((sample, index) => sample.hidden ? [index] : []);
        if (!hiddenIndexes.length) {
          slices.push(null);
          continue;
        }
        const boundary = (outside: number, inside: number) => {
          let outsideCross = samples[outside]?.cross ?? samples[inside].cross;
          let insideCross = samples[inside].cross;
          for (let iteration = 0; iteration < 7; iteration += 1) {
            const middle = (outsideCross + insideCross) / 2;
            const point = lerpPoint(edgeA, edgeB, middle);
            if (isCandidateInFront(point, t, middle)) insideCross = middle;
            else outsideCross = middle;
          }
          return lerpPoint(edgeA, edgeB, insideCross);
        };
        const first = hiddenIndexes[0];
        const last = hiddenIndexes[hiddenIndexes.length - 1];
        slices.push({
          left: first === 0 ? samples[first].point : boundary(first - 1, first),
          right: last === crossSteps ? samples[last].point : boundary(last + 1, last),
        });
      }
      let segment: Array<{ left: Point; right: Point }> = [];
      for (const slice of [...slices, null]) {
        if (slice) {
          segment.push(slice);
          continue;
        }
        if (segment.length >= 2) occlusionPolygons.push({
          faceId: candidate.id,
          points: [...segment.map(({ left }) => left), ...segment.map(({ right }) => right).reverse()],
        });
        segment = [];
      }
    }
    if (!occlusionPolygons.length) continue;
    const maskId = `tube-surface-occlusion-mask-${target.face.id}`;
    tubeOcclusionMaskIds.set(target.face.id, maskId);
    tubeOcclusionMaskDefs.push(`<mask id="${escapeXml(maskId)}" data-tube-occlusion-face-id="${escapeXml(target.face.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${occlusionPolygons.map((polygon) => `<polygon data-tube-depth-occluder="${escapeXml(polygon.faceId)}" points="${polygon.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" />`).join("")}
    </mask>`);
  }
  const sphereSurfaceOcclusionMaskIds = new Map<string, string>();
  const sphereSurfaceOcclusionMaskDefs: string[] = [];
  for (const sphere of sphereSurfaces) {
    const candidates = limbSurfaces.filter((surface) =>
      (!sphere.attachedJointId || !surface.jointIds.includes(sphere.attachedJointId))
      && canOcclude(sphere, surface));
    const polygons: Array<{ id: string; points: Point[] }> = [];
    for (const candidate of candidates) {
      const slices: Array<{ left: Point; right: Point } | null> = [];
      const isTubeInFront = (point: Point) => {
        const tube = tubeCoordinatesAt(candidate, point);
        if (!tube) return false;
        const depth = sphereDepthAt(sphere, point);
        return depth !== null && tube.depth > depth + 1e-5;
      };
      const steps = 24;
      for (let yStep = 0; yStep <= steps; yStep += 1) {
        const normalizedY = yStep / steps * 2 - 1;
        const y = sphere.center.y + normalizedY * sphere.projectedRadius;
        const halfWidth = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)) * sphere.projectedRadius;
        const samples = Array.from({ length: steps + 1 }, (_, index) => {
          const amount = index / steps;
          const point = { x: sphere.center.x - halfWidth + halfWidth * 2 * amount, y };
          return { amount, point, hidden: isTubeInFront(point) };
        });
        const hiddenIndexes = samples.flatMap((sample, index) => sample.hidden ? [index] : []);
        if (!hiddenIndexes.length) {
          slices.push(null);
          continue;
        }
        const boundary = (outside: number, inside: number) => {
          let outsideAmount = samples[outside]?.amount ?? samples[inside].amount;
          let insideAmount = samples[inside].amount;
          for (let iteration = 0; iteration < 7; iteration += 1) {
            const middle = (outsideAmount + insideAmount) / 2;
            const point = { x: sphere.center.x - halfWidth + halfWidth * 2 * middle, y };
            if (isTubeInFront(point)) insideAmount = middle;
            else outsideAmount = middle;
          }
          return { x: sphere.center.x - halfWidth + halfWidth * 2 * insideAmount, y };
        };
        const first = hiddenIndexes[0];
        const last = hiddenIndexes[hiddenIndexes.length - 1];
        slices.push({
          left: first === 0 ? samples[first].point : boundary(first - 1, first),
          right: last === steps ? samples[last].point : boundary(last + 1, last),
        });
      }
      let segment: Array<{ left: Point; right: Point }> = [];
      for (const slice of [...slices, null]) {
        if (slice) {
          segment.push(slice);
          continue;
        }
        if (segment.length >= 2) polygons.push({
          id: candidate.face.id,
          points: [...segment.map(({ left }) => left), ...segment.map(({ right }) => right).reverse()],
        });
        segment = [];
      }
    }
    if (!polygons.length) continue;
    const maskId = `sphere-surface-occlusion-mask-${sphere.sourceId}`;
    sphereSurfaceOcclusionMaskIds.set(sphere.id, maskId);
    sphereSurfaceOcclusionMaskDefs.push(`<mask id="${escapeXml(maskId)}" data-sphere-surface-occlusion-id="${escapeXml(sphere.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${polygons.map((polygon) => `<polygon data-sphere-tube-occluder="${escapeXml(polygon.id)}" points="${polygon.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" />`).join("")}
    </mask>`);
  }
  const bendCreasePaths = new Map<string, string>();
  const positiveAngle = (angle: number) => (angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  for (const joint of visibleJoints) {
    const center = projectedJointCircle(joint.id);
    const connections = visibleFaces.flatMap(({ face, points }) => {
      if (!face.cameraFacingLimb || points.length !== 4) return [];
      const isStart = face.cameraFacingLimb.startJointId === joint.id;
      const isEnd = face.cameraFacingLimb.endJointId === joint.id;
      if (!isStart && !isEnd) return [];
      const otherJointId = isStart ? face.cameraFacingLimb.endJointId : face.cameraFacingLimb.startJointId;
      const other = projectJoint(otherJointId);
      const length = Math.hypot(other.x - center.center.x, other.y - center.center.y);
      if (length < 1e-7) return [];
      return [{
        direction: { x: (other.x - center.center.x) / length, y: (other.y - center.center.y) / length },
        attachments: isStart ? [points[0], points[3]] : [points[1], points[2]],
      }];
    });
    if (connections.length !== 2) continue;
    const directionDot = Math.min(1, Math.max(-1,
      connections[0].direction.x * connections[1].direction.x
      + connections[0].direction.y * connections[1].direction.y));
    const bend = Math.PI - Math.acos(directionDot);
    if (bend < 3 * Math.PI / 180) continue;
    const inner = {
      x: connections[0].direction.x + connections[1].direction.x,
      y: connections[0].direction.y + connections[1].direction.y,
    };
    const innerLength = Math.hypot(inner.x, inner.y);
    if (innerLength < 1e-7) continue;
    inner.x /= innerLength;
    inner.y /= innerLength;
    const innerAttachment = (connection: (typeof connections)[number]) => connection.attachments.reduce((selected, point) => {
      const selectedScore = (selected.x - center.center.x) * inner.x + (selected.y - center.center.y) * inner.y;
      const pointScore = (point.x - center.center.x) * inner.x + (point.y - center.center.y) * inner.y;
      return pointScore > selectedScore ? point : selected;
    });
    const start = innerAttachment(connections[0]);
    const end = innerAttachment(connections[1]);
    const startAngle = Math.atan2(start.y - center.center.y, start.x - center.center.x);
    const endAngle = Math.atan2(end.y - center.center.y, end.x - center.center.x);
    const innerAngle = Math.atan2(inner.y, inner.x);
    const counterClockwiseSpan = positiveAngle(endAngle - startAngle);
    const innerCounterClockwiseSpan = positiveAngle(innerAngle - startAngle);
    const delta = innerCounterClockwiseSpan <= counterClockwiseSpan
      ? counterClockwiseSpan : counterClockwiseSpan - Math.PI * 2;
    const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 18)));
    const arc = Array.from({ length: steps + 1 }, (_, index) => {
      if (index === 0) return start;
      if (index === steps) return end;
      const angle = startAngle + delta * index / steps;
      return {
        x: center.center.x + Math.cos(angle) * center.radius,
        y: center.center.y + Math.sin(angle) * center.radius,
      };
    });
    bendCreasePaths.set(joint.id, arc.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "));
  }
  const jointMaskGeometry = new Map<string, string>();
  const connectionSurfaceOccluders: {
    points: Point[];
    jointIds: string[];
    groupId?: string;
    order: number;
    depth: number;
    id: string;
  }[] = [];

  const jointItems = visibleJoints
    .map((joint, index) => {
      const world = projectJoint(joint.id);
      const radius = bodyRadiusOf(joint.id) * scaleOf(joint.id);
      const profile = joint.surfaceProfileId ? rig.surfaceProfiles?.find((candidate) => candidate.id === joint.surfaceProfileId) : undefined;
      const profileMarkup = profile
        ? (() => {
          const capsuleCircles = projectedJointCapsuleCircles(joint.id);
          if (capsuleCircles) {
            const silhouette = getOuterPoints(capsuleCircles.flatMap((circle) => sampleCircle(circle)));
            const points = silhouette.map((point) => `${point.x},${point.y}`).join(" ");
            jointMaskGeometry.set(joint.id, `<polygon points="${points}" fill="#000" stroke="#000" stroke-width="3" />`);
            return `<polygon class="body-joint" data-body-joint data-joint-capsule data-joint-id="${escapeXml(joint.id)}" points="${points}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />
              ${joint.outlineVisible !== false ? `<polygon class="body-joint-outline" data-joint-outline data-joint-id="${escapeXml(joint.id)}" points="${points}" mask="url(#joint-outline-mask-${index})" />` : ""}`;
          }
          const center = getJointWorldTransform(rig, joint.id);
          const surfaceScale = joint.surfaceScale ?? { x: 1, y: 1, z: 1 };
          const flatAxes = new Set(joint.capsuleFlatAxes ?? []);
          const flatLength = (axis: "x" | "y" | "z") => flatAxes.has(axis) ? joint.capsuleFlatLengths?.[axis] ?? 0 : 0;
          const depth = bodyRadiusOf(joint.id) * profile.depthScale * surfaceScale.z + flatLength("z") / 2;
          const radiansX = (joint.localRotationX ?? 0) * Math.PI / 180;
          const radiansY = (joint.localRotationY ?? 0) * Math.PI / 180;
          const radiansZ = center.rotation * Math.PI / 180;
          const rotateProfilePoint = (vertex: { x: number; y: number }, side: number) => {
            let x = vertex.x * bodyRadiusOf(joint.id) * surfaceScale.x + Math.sign(vertex.x) * flatLength("x") / 2;
            let y = vertex.y * bodyRadiusOf(joint.id) * surfaceScale.y + Math.sign(vertex.y) * flatLength("y") / 2;
            let z = side * depth;
            [y, z] = [y * Math.cos(radiansX) - z * Math.sin(radiansX), y * Math.sin(radiansX) + z * Math.cos(radiansX)];
            [x, z] = [x * Math.cos(radiansY) + z * Math.sin(radiansY), -x * Math.sin(radiansY) + z * Math.cos(radiansY)];
            [x, y] = [x * Math.cos(radiansZ) - y * Math.sin(radiansZ), x * Math.sin(radiansZ) + y * Math.cos(radiansZ)];
            return { x: center.x + x, y: center.y + y, z: zOf(joint.id) + z };
          };
          const rings = [-1, 1].map((side) => profile.outline.map((vertex) => rotateProfilePoint(vertex, side)));
          // The model retains every front/back/side face. The 2D editor uses
          // only their projected outer hull, matching the clean flat output
          // style while still changing silhouette as the 3D profile rotates.
          const silhouette = getOuterPoints(rings.flat().map((point) => project(point, point.z)));
          const points = silhouette.map((point) => `${point.x},${point.y}`).join(" ");
          jointMaskGeometry.set(joint.id, `<polygon points="${points}" fill="#000" stroke="#000" stroke-width="3" />`);
          return `<polygon class="body-joint" data-body-joint data-joint-id="${escapeXml(joint.id)}" points="${points}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />
            ${joint.outlineVisible !== false ? `<polygon class="body-joint-outline" data-joint-outline data-joint-id="${escapeXml(joint.id)}" points="${points}" mask="url(#joint-outline-mask-${index})" />` : ""}`;
        })()
        : `<circle class="body-joint" data-body-joint data-joint-id="${escapeXml(joint.id)}" cx="${world.x}" cy="${world.y}" r="${radius}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />`;
      if (!profile) jointMaskGeometry.set(joint.id, `<circle cx="${world.x}" cy="${world.y}" r="${radius}" fill="#000" stroke="#000" stroke-width="3" />`);
      return {
        id: `joint:${joint.id}`,
        groupId: joint.groupId,
        order: joint.renderOrder,
        markup: `<g class="body-joint-item"${sphereSurfaceOcclusionMaskIds.has(`joint:${joint.id}`) ? ` mask="url(#${sphereSurfaceOcclusionMaskIds.get(`joint:${joint.id}`)})"` : ""}>
          ${profileMarkup}
          ${joint.outlineVisible !== false && !profile ? `<circle class="body-joint-outline" cx="${world.x}" cy="${world.y}" r="${radius}" mask="url(#joint-outline-mask-${index})" />` : ""}
          ${joint.outlineVisible !== false && bendCreasePaths.has(joint.id) ? `<path class="body-joint-outline body-bend-crease" data-bend-crease-joint-id="${escapeXml(joint.id)}" d="${bendCreasePaths.get(joint.id)}" mask="url(#joint-bend-mask-${index})" />` : ""}
        </g>`,
      };
    });

  const faceItems = visibleFaces
    .map(({ face, points }) => {
      const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
      const outlinePath = points.map((point, index) => {
        const nextIndex = (index + 1) % points.length;
        const nextPoint = points[nextIndex];
        const sameJoint = face.cameraFacingLimb
          ? index === 1 || index === 3
          : face.vertices[index]?.jointId === face.vertices[nextIndex]?.jointId;
        const sharedGroupEdge = face.vertices.length === points.length && visibleFaces.some(({ face: candidate }) => (
          candidate.id !== face.id
          && candidate.groupId === face.groupId
          && hasMatchingEdge(candidate, face.vertices[index], face.vertices[nextIndex])
        ));
        if (sharedGroupEdge) return "";
        if (viewState.hideSameJointEdges && sameJoint) return "";
        return `M ${point.x} ${point.y} L ${nextPoint.x} ${nextPoint.y}`;
      }).filter(Boolean).join(" ");
      const outlineMarkup = `<path class="body-face-outline" data-face-outline-id="${escapeXml(face.id)}" d="${outlinePath}"${connectedSphereOutlineMaskIds.has(face.id) ? ` mask="url(#${connectedSphereOutlineMaskIds.get(face.id)})"` : ""} />`;
      const connectedOutline = face.id === "neck"
        ? `<g mask="url(#${torsoConnectionOutlineMaskId("neck")})">${outlineMarkup}</g>`
        : outlineMarkup;
      return {
        id: `face:${face.id}`,
        groupId: face.groupId,
        order: getFaceOrder(rig, face),
        markup: `<g class="body-face-item"${surfaceOcclusionMaskIds.has(face.id) ? ` mask="url(#${surfaceOcclusionMaskIds.get(face.id)})"` : ""}>
          <g${tubeOcclusionMaskIds.has(face.id) ? ` mask="url(#${tubeOcclusionMaskIds.get(face.id)})"` : ""}>
            <polygon class="body-face${viewState.selectedTarget === "face" && face.id === viewState.selectedFaceId ? " is-selected" : ""}" data-face-id="${escapeXml(face.id)}" points="${pointList}" fill="${escapeXml(resolveColor(rig, face.color, face.paletteId))}" />
            ${connectedOutline}
          </g>
        </g>`,
      };
    });

  const cameraBasis = getCameraBasis(rig);
  const cross3 = (first: Point3, second: Point3): Point3 => ({
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  });
  const normalize3 = (vector: Point3): Point3 | null => {
    const length = Math.hypot(vector.x, vector.y, vector.z);
    return length > 1e-8 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : null;
  };
  const tubeSectionJointIds = new Set<string>();
  const tubeSectionItems = visibleFaces.flatMap(({ face }) => {
    if (!face.cameraFacingLimb) return [];
    const { startJointId, endJointId } = face.cameraFacingLimb;
    const outgoing = visibleFaces.some(({ face: candidate }) => candidate !== face
      && candidate.cameraFacingLimb?.startJointId === endJointId);
    if (outgoing) return [];
    const startJoint = rig.joints.find((joint) => joint.id === startJointId);
    const endJoint = rig.joints.find((joint) => joint.id === endJointId);
    if (!startJoint || !endJoint) return [];
    // A visible endpoint joint is a closed sphere/capsule in front of the
    // section plane. Its exposed joint arc already owns the terminal contour.
    if (showJointLayer && endJoint.bodyVisible && isGroupVisible(rig, endJoint.groupId)) return [];
    const startWorld = getJointWorldTransform(rig, startJointId);
    const endWorld = getJointWorldTransform(rig, endJointId);
    const axis = normalize3({
      x: endWorld.x - startWorld.x,
      y: endWorld.y - startWorld.y,
      z: endJoint.z - startJoint.z,
    });
    if (!axis) return [];
    const facing = axis.x * cameraBasis.forward.x + axis.y * cameraBasis.forward.y + axis.z * cameraBasis.forward.z;
    const radius = bodyRadiusOf(endJointId);
    const color = escapeXml(resolveColor(rig, face.color, face.paletteId));
    const selected = viewState.selectedTarget === "face" && viewState.selectedFaceId === face.id ? " is-selected" : "";
    const basisU = normalize3(cross3(axis, cameraBasis.forward))
      ?? normalize3(cross3(axis, cameraBasis.up));
    if (!basisU) return [];
    const basisV = normalize3(cross3(axis, basisU));
    if (!basisV) return [];
    const center: Point3 = { x: endWorld.x, y: endWorld.y, z: endJoint.z };
    const sectionPoints = Array.from({ length: 32 }, (_, index) => {
      const angle = Math.PI * 2 * index / 32;
      const cosine = Math.cos(angle) * radius;
      const sine = Math.sin(angle) * radius;
      const point = {
        x: center.x + basisU.x * cosine + basisV.x * sine,
        y: center.y + basisU.y * cosine + basisV.y * sine,
        z: center.z + basisU.z * cosine + basisV.z * sine,
      };
      return project(point, point.z);
    });
    const pointList = sectionPoints.map((point) => `${point.x},${point.y}`).join(" ");
    if (facing <= 0.06) {
      const basisVFacing = basisV.x * cameraBasis.forward.x
        + basisV.y * cameraBasis.forward.y + basisV.z * cameraBasis.forward.z;
      const startIndex = basisVFacing >= 0 ? 0 : 16;
      const curve = Array.from({ length: 17 }, (_, index) =>
        sectionPoints[(startIndex + index) % sectionPoints.length]);
      const arcPath = curve.map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
      tubeSectionJointIds.add(endJointId);
      return [{
        id: `tube-side-end:${face.id}`,
        groupId: face.groupId,
        order: getFaceOrder(rig, face) + 0.01,
        depth: renderedDepthOf(endJointId) + radius,
        markup: `<g class="body-tube-section-item body-tube-side-end" data-tube-section-face-id="${escapeXml(face.id)}" data-tube-end-curvature data-tube-side-end${tubeOcclusionMaskIds.has(face.id) ? ` mask="url(#${tubeOcclusionMaskIds.get(face.id)})"` : ""}>
          <path class="body-face${selected}" data-face-id="${escapeXml(face.id)}" d="${arcPath} Z" fill="${color}" />
          <path class="body-face-outline tube-end-curvature-outline" d="${arcPath}" />
        </g>`,
      }];
    }
    const sectionMarkup = `<polygon class="body-face${selected}" data-face-id="${escapeXml(face.id)}" data-tube-section-cap points="${pointList}" fill="${color}" />
      <polygon class="body-face-outline tube-section-outline" points="${pointList}" />`;
    tubeSectionJointIds.add(endJointId);
    return [{
      id: `tube-section:${face.id}`,
      groupId: face.groupId,
      order: getFaceOrder(rig, face) + 0.01,
      depth: renderedDepthOf(endJointId) + Math.max(0, facing) * radius,
      markup: `<g class="body-tube-section-item" data-tube-section-face-id="${escapeXml(face.id)}"${tubeOcclusionMaskIds.has(face.id) ? ` mask="url(#${tubeOcclusionMaskIds.get(face.id)})"` : ""}>${sectionMarkup}</g>`,
    }];
  });
  const surfaceIntersectionItems = visibleFaces.flatMap(({ face }) => {
    const path = surfaceIntersectionPaths.get(face.id);
    if (!path || !face.cameraFacingLimb) return [];
    const { startJointId, endJointId } = face.cameraFacingLimb;
    const depth = Math.max(
      renderedDepthOf(startJointId) + bodyRadiusOf(startJointId),
      renderedDepthOf(endJointId) + bodyRadiusOf(endJointId),
    ) + 1e-4;
    return [{
      id: `surface-intersection:${face.id}`,
      groupId: face.groupId,
      order: getFaceOrder(rig, face) + 0.02,
      depth,
      markup: `<path class="body-face-outline surface-intersection-curve" data-surface-intersection-face-id="${escapeXml(face.id)}" d="${path}"${tubeOcclusionMaskIds.has(face.id) ? ` mask="url(#${tubeOcclusionMaskIds.get(face.id)})"` : ""} />`,
    }];
  });

  const peerCapsuleItems = showFaceLayer ? rig.peerGroups.flatMap((group) => {
    if (!group.virtualCapsule || group.jointIds.length !== 2) return [];
    const [startJointId, endJointId] = group.jointIds;
    const startJoint = rig.joints.find((joint) => joint.id === startJointId);
    const endJoint = rig.joints.find((joint) => joint.id === endJointId);
    if (!startJoint || !endJoint) return [];
    const sourceFace = rig.faces.find((face) => face.id === group.id);
    const groupId = sourceFace?.groupId
      ?? (startJoint.groupId === endJoint.groupId ? startJoint.groupId : undefined);
    if (!isGroupVisible(rig, groupId)) return [];
    const startCircle = projectedJointCircle(startJointId);
    const endCircle = projectedJointCircle(endJointId);
    const points = getProjectedCircleConnectionSurface(
      startCircle.center,
      endCircle.center,
      startCircle.radius,
      endCircle.radius,
    );
    if (!points) return [];
    const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
    const selected = sourceFace && viewState.selectedTarget === "face" && viewState.selectedFaceId === sourceFace.id
      ? " is-selected" : "";
    const color = resolveColor(rig, sourceFace?.color ?? startJoint.color, sourceFace?.paletteId ?? startJoint.paletteId);
    const depth = (renderedDepthOf(startJointId) + renderedDepthOf(endJointId)) / 2;
    connectionSurfaceOccluders.push({
      points, jointIds: [startJointId, endJointId], groupId,
      order: sourceFace ? getFaceOrder(rig, sourceFace) : 20,
      depth, id: `peer-capsule:${group.id}`,
    });
    if (groupId === "torso") torsoConnectionSurfaces.push({ id: group.id, points });
    const outlinePath = group.id === "hip-band" ? "" : connectionOutlinePath(points, "limb");
    return [{
      id: `peer-capsule:${group.id}`,
      groupId,
      order: sourceFace ? getFaceOrder(rig, sourceFace) : 20,
      depth,
      markup: `<g class="body-face-item peer-capsule-item">
        <polygon class="body-face${selected}" data-peer-capsule data-peer-group-id="${escapeXml(group.id)}"${sourceFace ? ` data-face-id="${escapeXml(sourceFace.id)}"` : ""} points="${pointList}" fill="${escapeXml(color)}" />
        ${outlinePath ? `<path class="body-face-outline" data-face-outline data-peer-group-id="${escapeXml(group.id)}" d="${outlinePath}"${groupId === "torso" ? ` mask="url(#${torsoConnectionOutlineMaskId(group.id)})"` : ""} />` : ""}
      </g>`,
    }];
  }) : [];

  const torsoStripItems = showFaceLayer && isGroupVisible(rig, "torso") ? (() => {
    const waist = rig.joints.find((joint) => joint.id === "waist");
    const left = rig.joints.find((joint) => joint.id === "left-shoulder");
    const right = rig.joints.find((joint) => joint.id === "right-shoulder");
    const torsoFace = rig.faces.find((face) => face.id === "torso");
    if (!waist || !left || !right || !torsoFace) return [];
    const waistCenter = getJointWorldTransform(rig, waist.id);
    const leftCenter = getJointWorldTransform(rig, left.id);
    const rightCenter = getJointWorldTransform(rig, right.id);
    const waistCircles = projectedJointCapsuleCircles(waist.id);
    if (!waistCircles) return [];
    const shoulderMidpoint = {
      x: (leftCenter.x + rightCenter.x) / 2,
      y: (leftCenter.y + rightCenter.y) / 2,
      z: (left.z + right.z) / 2,
    };
    const shoulderProjected = project(shoulderMidpoint, shoulderMidpoint.z);
    const waistProjected = project(waistCenter, waist.z);
    const connectionX = waistProjected.x - shoulderProjected.x;
    const connectionY = waistProjected.y - shoulderProjected.y;
    const connectionLength = Math.hypot(connectionX, connectionY);
    const screenNormal = connectionLength > 1e-9
      ? { x: -connectionY / connectionLength, y: connectionX / connectionLength }
      : { x: 1, y: 0 };
    // The torso meets the inner edge of each outward shoulder capsule. Those
    // two inset sphere centres form the upper capsule for the connection.
    const shoulderDx = rightCenter.x - leftCenter.x;
    const shoulderDy = rightCenter.y - leftCenter.y;
    const shoulderDz = right.z - left.z;
    const shoulderDistance = Math.hypot(shoulderDx, shoulderDy, shoulderDz);
    if (shoulderDistance < 1e-9) return [];
    const shoulderCapsuleCircles = ([left, right] as const).map((joint, index) => {
      const direction = index === 0 ? 1 : -1;
      const inset = Math.min(bodyRadiusOf(joint.id), shoulderDistance / 2);
      const center = index === 0 ? leftCenter : rightCenter;
      const depth = joint.z + shoulderDz / shoulderDistance * inset * direction;
      return projectSphereCircle(rig, {
        x: center.x + shoulderDx / shoulderDistance * inset * direction,
        y: center.y + shoulderDy / shoulderDistance * inset * direction,
      }, depth, bodyRadiusOf(joint.id));
    });
    const points = [
      capsuleSupport(shoulderCapsuleCircles, screenNormal, -1), capsuleSupport(shoulderCapsuleCircles, screenNormal, 1),
      capsuleSupport(waistCircles, screenNormal, 1), capsuleSupport(waistCircles, screenNormal, -1),
    ];
    const color = escapeXml(resolveColor(rig, torsoFace.color, torsoFace.paletteId));
    const selected = viewState.selectedTarget === "face" && viewState.selectedFaceId === torsoFace.id ? " is-selected" : "";
    const depth = (renderedDepthOf(left.id) + renderedDepthOf(right.id) + renderedDepthOf(waist.id)) / 3;
    connectionSurfaceOccluders.push({
      points, jointIds: [left.id, right.id, waist.id],
      groupId: "torso", order: 20, depth, id: "torso-surface",
    });
    torsoConnectionSurfaces.push({ id: "torso", points });
    return [{
      id: "torso-surface", groupId: "torso", order: 20,
      depth,
      markup: `<g class="body-face-item procedural-surface-item">
        <polygon class="body-face${selected}" data-face-id="torso" data-torso-surface points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="${color}" />
        <path class="body-face-outline" data-face-outline data-face-id="torso" d="${connectionOutlinePath(points, "strip")}" mask="url(#${torsoConnectionOutlineMaskId("torso")})" />
      </g>`,
    }];
  })() : [];

  const waistHipStripItems = showFaceLayer && isGroupVisible(rig, "torso") ? (() => {
    const face = rig.faces.find((candidate) => candidate.proceduralSurface === "waist-hip");
    const waist = rig.joints.find((joint) => joint.id === "waist");
    const hipGroup = rig.peerGroups.find((group) => group.id === "hip-band" && group.virtualCapsule);
    const leftHip = rig.joints.find((joint) => joint.id === "left-hip");
    const rightHip = rig.joints.find((joint) => joint.id === "right-hip");
    if (!face || !waist || !hipGroup || !leftHip || !rightHip
      || !hipGroup.jointIds.includes(leftHip.id) || !hipGroup.jointIds.includes(rightHip.id)) return [];
    const leftCenter = getJointWorldTransform(rig, leftHip.id);
    const rightCenter = getJointWorldTransform(rig, rightHip.id);
    const waistSpheres = jointCapsuleSpheres(waist.id);
    if (!waistSpheres) return [];
    const hipSpheres: [CapsuleSphere, CapsuleSphere] = [
      { center: { x: leftCenter.x, y: leftCenter.y, z: leftHip.z }, radius: bodyRadiusOf(leftHip.id) },
      { center: { x: rightCenter.x, y: rightCenter.y, z: rightHip.z }, radius: bodyRadiusOf(rightHip.id) },
    ];
    const waistCircles = waistSpheres.map(({ center, radius }) => projectSphereCircle(rig, center, center.z, radius)) as [ProjectedCircle, ProjectedCircle];
    const hipCircles = hipSpheres.map(({ center, radius }) => projectSphereCircle(rig, center, center.z, radius)) as [ProjectedCircle, ProjectedCircle];
    const sectionStart = {
      x: (waistCircles[0].center.x + waistCircles[1].center.x) / 2,
      y: (waistCircles[0].center.y + waistCircles[1].center.y) / 2,
    };
    const sectionEnd = {
      x: (hipCircles[0].center.x + hipCircles[1].center.x) / 2,
      y: (hipCircles[0].center.y + hipCircles[1].center.y) / 2,
    };
    const connections = waistSpheres.flatMap((waistSphere, index) => {
      // Endpoint -X/+X roles remain paired with left/right hips. Re-evaluating
      // the shortest pair every frame would flip topology near a side view.
      const hipSphere = hipSpheres[index];
      const waistCircle = waistCircles[index];
      const hipCircle = hipCircles[index];
      const points = getProjectedCircleConnectionSurface(
        waistCircle.center,
        hipCircle.center,
        waistCircle.radius,
        hipCircle.radius,
      );
      if (!points) return [];
      const outerEdge = outerConnectionEdge(points, sectionStart, sectionEnd);
      return outerEdge ? [{ points, outerEdge }] : [];
    });
    if (connections.length !== 2) return [];
    const outerHull = [
      connections[0].outerEdge[0],
      connections[1].outerEdge[0],
      connections[1].outerEdge[1],
      connections[0].outerEdge[1],
    ];
    // These projected centres represent the camera-facing points of the four
    // spheres: their screen X/Y matches each sphere centre while their depth
    // lies on the front surface. The two side tubes provide the rounded sides.
    const centerTrapezoid = [
      waistCircles[0].center,
      waistCircles[1].center,
      hipCircles[1].center,
      hipCircles[0].center,
    ];
    const color = escapeXml(resolveColor(rig, face.color, face.paletteId));
    const selected = viewState.selectedTarget === "face" && viewState.selectedFaceId === face.id ? " is-selected" : "";
    const frontDepth = [...waistSpheres, ...hipSpheres].reduce((sum, sphere) =>
      sum + getCameraZ(rig, sphere.center, sphere.center.z) + sphere.radius, 0) / 4;
    connectionSurfaceOccluders.push(
      { points: centerTrapezoid, jointIds: [waist.id, leftHip.id, rightHip.id],
        groupId: face.groupId, order: getFaceOrder(rig, face), depth: frontDepth,
        id: "waist-hip-center" },
      ...connections.map((connection, index) => ({
        points: connection.points, jointIds: [waist.id, index === 0 ? leftHip.id : rightHip.id],
        groupId: face.groupId, order: getFaceOrder(rig, face), depth: frontDepth,
        id: `waist-hip-tube:${index}`,
      })),
    );
    torsoConnectionSurfaces.push({ id: "waist-hip", points: outerHull });
    const outlinePath = connections.map(({ outerEdge }) =>
      `M ${outerEdge[0].x} ${outerEdge[0].y} L ${outerEdge[1].x} ${outerEdge[1].y}`).join(" ");
    const polygonPoints = (surface: readonly Point[]) => surface.map((point) => `${point.x},${point.y}`).join(" ");
    return [{
      id: "waist-hip-surface", groupId: face.groupId, order: getFaceOrder(rig, face),
      depth: frontDepth,
      markup: `<g class="body-face-item procedural-surface-item">
        <polygon class="body-face${selected}" data-face-id="${escapeXml(face.id)}" data-waist-hip-surface data-waist-hip-center points="${polygonPoints(centerTrapezoid)}" fill="${color}" />
        ${connections.map(({ points }, index) => `<polygon class="body-face${selected}" data-face-id="${escapeXml(face.id)}" data-waist-hip-tube="${index}" points="${polygonPoints(points)}" fill="${color}" />`).join("")}
        <path class="body-face-outline" data-face-outline data-face-id="${escapeXml(face.id)}" data-waist-hip-outline d="${outlinePath}" mask="url(#${torsoConnectionOutlineMaskId("waist-hip")})" />
      </g>`,
    }];
  })() : [];

  const shapeRecords = (rig.artShapes ?? []).filter((shape) => showShapeLayer && isGroupVisible(rig, shape.groupId)).map((shape) => ({
    shape,
    points: shape.vertices.map((vertex) => project(getArtShapeVertexPoint(rig, vertex), vertexDepth(vertex))),
    sphereRadius: shape.kind === "sphere" && shape.vertices[0]
      ? (shape.radius ?? 1) * getProjectionScale(rig, getCameraZ(rig, getArtShapeVertexPoint(rig, shape.vertices[0]), vertexDepth(shape.vertices[0])))
      : 0,
    compositeMode: shape.compositeMode ?? "paint",
    compositeGroupId: shape.compositeGroupId ?? `composite-${shape.id}`,
    stackOrder: (shape.groupId ? rig.groups.find((group) => group.id === shape.groupId)?.order ?? 0 : 0) + shape.layerOrder,
  }));
  const compositeGeometry = (record: (typeof shapeRecords)[number], color: string) => record.shape.kind === "circle"
    ? `<ellipse cx="${record.points[0].x}" cy="${record.points[0].y}" rx="${record.shape.radiusX}" ry="${record.shape.radiusY}" fill="${color}" />`
    : record.shape.kind === "sphere"
      ? `<circle cx="${record.points[0].x}" cy="${record.points[0].y}" r="${record.sphereRadius}" fill="${color}" />`
    : record.shape.kind === "line"
      ? `<line x1="${record.points[0].x}" y1="${record.points[0].y}" x2="${record.points[1].x}" y2="${record.points[1].y}" fill="none" stroke="${color}" stroke-width="${record.shape.strokeWidth ?? 1}" stroke-linecap="round" />`
      : `<polygon points="${record.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="${color}" />`;
  const compositeMaskDefs: string[] = [];
  const maskBounds = `x="-2000" y="-2000" width="4600" height="4780"`;
  const selectedShapeIds = new Set(viewState.selectedShapeIds ?? [viewState.selectedShapeId].filter(Boolean) as string[]);
  const shapeActualMarkup = (record: (typeof shapeRecords)[number]) => {
    const { shape, points, sphereRadius } = record;
    const color = escapeXml(resolveColor(rig, shape.color, shape.paletteId));
    const selectedClass = selectedShapeIds.has(shape.id) ? " is-selected" : "";
    return shape.kind === "line"
      ? `<g class="body-art-shape-item"><line class="body-art-line-outline" x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke-width="${(shape.strokeWidth ?? 1) + 3}" /><line class="body-art-line${selectedClass}" data-shape-id="${escapeXml(shape.id)}" x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke="${color}" stroke-width="${shape.strokeWidth ?? 1}" /></g>`
      : shape.kind === "circle"
        ? `<g class="body-art-shape-item"><ellipse class="body-art-shape${selectedClass}" data-shape-id="${escapeXml(shape.id)}" cx="${points[0].x}" cy="${points[0].y}" rx="${shape.radiusX}" ry="${shape.radiusY}" fill="${color}" /><ellipse class="body-art-shape-outline" cx="${points[0].x}" cy="${points[0].y}" rx="${shape.radiusX}" ry="${shape.radiusY}" /></g>`
        : shape.kind === "sphere"
          ? `<g class="body-art-shape-item"${sphereSurfaceOcclusionMaskIds.has(`shape:${shape.id}`) ? ` mask="url(#${sphereSurfaceOcclusionMaskIds.get(`shape:${shape.id}`)})"` : ""}><circle class="body-art-shape body-art-sphere${selectedClass}" data-shape-id="${escapeXml(shape.id)}" data-art-sphere cx="${points[0].x}" cy="${points[0].y}" r="${sphereRadius}" fill="${color}" /><circle class="body-art-shape-outline" cx="${points[0].x}" cy="${points[0].y}" r="${sphereRadius}" /></g>`
        : `<g class="body-art-shape-item"><polygon class="body-art-shape${selectedClass}" data-shape-id="${escapeXml(shape.id)}" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="${color}" /><polygon class="body-art-shape-outline" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" /></g>`;
  };
  const shapeDepth = (record: (typeof shapeRecords)[number]) => {
    if (record.shape.kind === "sphere" && record.shape.vertices[0]) {
      const center = record.shape.vertices[0];
      return getCameraZ(rig, getArtShapeVertexPoint(rig, center), vertexDepth(center));
    }
    return record.shape.vertices
      .reduce((sum, vertex) => sum + vertexDepth(vertex), 0) / record.shape.vertices.length;
  };
  const shapeMaskIds = new Map<string, string>();
  for (const [index, record] of shapeRecords.entries()) {
    const maskId = `art-shape-mask-${index}`;
    shapeMaskIds.set(record.shape.id, maskId);
    compositeMaskDefs.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse" ${maskBounds} mask-type="luminance"><rect ${maskBounds} fill="#000" />${compositeGeometry(record, "#fff")}</mask>`);
  }
  const groupDefinitions = new Map((rig.artCompositeGroups ?? []).map((group) => [group.id, group]));
  const directGroupId = (record: (typeof shapeRecords)[number]) => record.compositeGroupId;
  const allGroupIds = new Set([
    ...shapeRecords.map(directGroupId),
    ...(rig.artCompositeGroups ?? []).map((group) => group.id),
  ]);
  const groupIndexes = new Map([...allGroupIds].map((id, index) => [id, index]));
  type CompositeResult = { actual: string; maskId: string; order: number; depth: number; outputGroupId?: string };
  const renderedGroups = new Map<string, CompositeResult | null>();
  const renderGroup = (groupId: string, visiting = new Set<string>()): CompositeResult | null => {
    if (renderedGroups.has(groupId)) return renderedGroups.get(groupId)!;
    if (visiting.has(groupId)) return null;
    const nextVisiting = new Set(visiting).add(groupId);
    const operands: Array<CompositeResult & { id: string; mode: ArtCompositeMode }> = [];
    for (const record of shapeRecords.filter((candidate) => directGroupId(candidate) === groupId)) {
      operands.push({ id: `shape:${record.shape.id}`, mode: record.compositeMode,
        actual: shapeActualMarkup(record), maskId: shapeMaskIds.get(record.shape.id)!,
        order: record.stackOrder, depth: shapeDepth(record), outputGroupId: record.shape.groupId });
    }
    for (const child of (rig.artCompositeGroups ?? []).filter((group) => group.parentGroupId === groupId)) {
      const result = renderGroup(child.id, nextVisiting);
      if (result) operands.push({ ...result, id: `group:${child.id}`, mode: child.compositeMode ?? "paint" });
    }
    operands.sort((first, second) => first.order - second.order || first.id.localeCompare(second.id));
    const baseIndex = operands.findIndex((operand) => operand.mode === "paint");
    if (baseIndex < 0) {
      renderedGroups.set(groupId, null);
      return null;
    }
    const base = operands[baseIndex];
    let actual = base.actual;
    let resultMaskContent = `<rect ${maskBounds} fill="#fff" mask="url(#${base.maskId})" />`;
    const groupIndex = groupIndexes.get(groupId) ?? renderedGroups.size;
    for (const [operationIndex, operand] of operands.slice(baseIndex + 1).entries()) {
      if (operand.mode === "overlay") {
        const overlayClipId = `art-composite-overlay-clip-${groupIndex}-${operationIndex}`;
        compositeMaskDefs.push(`<mask id="${overlayClipId}" maskUnits="userSpaceOnUse" ${maskBounds} mask-type="luminance"><rect ${maskBounds} fill="#000" />${resultMaskContent}</mask>`);
        actual = `<g>${actual}<g mask="url(#${overlayClipId})">${operand.actual}</g></g>`;
        continue;
      }
      let operationMaskId = operand.maskId;
      if (operand.mode === "cutout") {
        operationMaskId = `art-composite-subtract-${groupIndex}-${operationIndex}`;
        compositeMaskDefs.push(`<mask id="${operationMaskId}" maskUnits="userSpaceOnUse" ${maskBounds} mask-type="luminance"><rect ${maskBounds} fill="#fff" /><rect ${maskBounds} fill="#000" mask="url(#${operand.maskId})" /></mask>`);
      }
      actual = `<g mask="url(#${operationMaskId})">${actual}</g>`;
      resultMaskContent = `<g mask="url(#${operationMaskId})">${resultMaskContent}</g>`;
    }
    const resultMaskId = `art-composite-result-${groupIndex}`;
    compositeMaskDefs.push(`<mask id="${resultMaskId}" maskUnits="userSpaceOnUse" ${maskBounds} mask-type="luminance"><rect ${maskBounds} fill="#000" />${resultMaskContent}</mask>`);
    const result = { actual, maskId: resultMaskId, order: base.order, depth: base.depth, outputGroupId: base.outputGroupId };
    renderedGroups.set(groupId, result);
    return result;
  };
  const rootGroupIds = [...allGroupIds].filter((groupId) => !groupDefinitions.get(groupId)?.parentGroupId);
  const compositeItems = rootGroupIds.flatMap((groupId) => {
    const result = renderGroup(groupId);
    return result ? [{ id: `composite:${groupId}`, groupId: result.outputGroupId,
      order: result.order - (result.outputGroupId ? rig.groups.find((group) => group.id === result.outputGroupId)?.order ?? 0 : 0),
      depth: result.depth, markup: result.actual }] : [];
  });
  const shapeHitItems = shapeRecords.map((record) => {
    const { shape, points, sphereRadius } = record;
    const selected = selectedShapeIds.has(shape.id);
    const className = record.compositeMode === "cutout" ? `body-art-cutout-guide${selected ? " is-selected" : ""}`
      : selected ? "body-art-composite-guide is-selected" : "body-art-shape-hit";
    const geometry = shape.kind === "circle"
      ? `<ellipse class="${className}" data-shape-id="${escapeXml(shape.id)}" cx="${points[0].x}" cy="${points[0].y}" rx="${shape.radiusX}" ry="${shape.radiusY}" />`
      : shape.kind === "sphere"
        ? `<circle class="${className}" data-shape-id="${escapeXml(shape.id)}" cx="${points[0].x}" cy="${points[0].y}" r="${sphereRadius}" />`
      : shape.kind === "line"
        ? `<line class="${className}" data-shape-id="${escapeXml(shape.id)}" x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke-width="${Math.max(8, shape.strokeWidth ?? 1)}" />`
        : `<polygon class="${className}" data-shape-id="${escapeXml(shape.id)}" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" />`;
    return { id: `shape-hit:${shape.id}`, groupId: shape.groupId, order: shape.layerOrder,
      depth: shapeDepth(record), markup: `<g class="body-art-shape-hit-item">${geometry}</g>` };
  });
  const shapeItems = [...compositeItems, ...shapeHitItems];

  const torsoConnectionOutlineMasks = torsoConnectionSurfaces.map((surface) => {
    const siblingSurfaces = torsoConnectionSurfaces
      .filter((candidate) => candidate !== surface)
      .map((candidate) => `<polygon points="${candidate.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    return `<mask id="${torsoConnectionOutlineMaskId(surface.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${siblingSurfaces}
    </mask>`;
  }).join("");

  const jointOutlineMasks = visibleJoints.map((joint, index) => {
    const jointStack = {
      groupId: joint.groupId,
      order: joint.renderOrder,
      depth: renderedDepthOf(joint.id),
    };
    const otherJoints = visibleJoints
      .filter((candidate) => candidate.id !== joint.id)
      .filter((candidate) => compareItemStackOrder(rig, jointStack, {
        groupId: candidate.groupId,
        order: candidate.renderOrder,
        depth: renderedDepthOf(candidate.id),
      }) < 0)
      .map((candidate) => `<g data-mask-joint-id="${escapeXml(candidate.id)}">${jointMaskGeometry.get(candidate.id) ?? ""}</g>`)
      .join("");
    const faces = visibleFaces
      .filter(({ face }) => {
        const jointIds = face.cameraFacingLimb
          ? [face.cameraFacingLimb.startJointId, face.cameraFacingLimb.endJointId]
          : [...new Set(face.vertices.map((vertex) => vertex.jointId))];
        // A tube joined to this sphere owns their shared interior boundary.
        // It must erase the overlapping joint arc even when its averaged
        // camera depth or authored layer places the fill behind the centre.
        if (jointIds.includes(joint.id)) return true;
        const depth = jointIds.reduce((sum, jointId) => sum + renderedDepthOf(jointId), 0)
          / Math.max(1, jointIds.length);
        return compareItemStackOrder(rig, jointStack, {
          groupId: face.groupId,
          order: getFaceOrder(rig, face),
          depth,
        }) < 0;
      })
      .map(({ face, points }) => `<polygon data-mask-face-id="${escapeXml(face.id)}" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    const connections = connectionSurfaceOccluders
      .filter((candidate) => candidate.jointIds.includes(joint.id)
        || compareItemStackOrder(rig, jointStack, candidate) < 0)
      .map((candidate) => `<polygon data-mask-surface-id="${escapeXml(candidate.id)}" points="${candidate.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    return `<mask id="joint-outline-mask-${index}" data-outline-mask-joint-id="${escapeXml(joint.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${otherJoints}${faces}${connections}
    </mask>`;
  }).join("");
  const jointBendMasks = visibleJoints.map((joint, index) => {
    if (!bendCreasePaths.has(joint.id)) return "";
    const jointStack = {
      groupId: joint.groupId,
      order: joint.renderOrder,
      depth: renderedDepthOf(joint.id),
    };
    const otherJoints = visibleJoints
      .filter((candidate) => candidate.id !== joint.id)
      .filter((candidate) => compareItemStackOrder(rig, jointStack, {
        groupId: candidate.groupId,
        order: candidate.renderOrder,
        depth: renderedDepthOf(candidate.id),
      }) < 0)
      .map((candidate) => jointMaskGeometry.get(candidate.id) ?? "")
      .join("");
    const faces = visibleFaces
      .filter(({ face }) => {
        const jointIds = face.cameraFacingLimb
          ? [face.cameraFacingLimb.startJointId, face.cameraFacingLimb.endJointId]
          : [...new Set(face.vertices.map((vertex) => vertex.jointId))];
        if (jointIds.includes(joint.id)) return false;
        const depth = jointIds.reduce((sum, jointId) => sum + renderedDepthOf(jointId), 0)
          / Math.max(1, jointIds.length);
        return compareItemStackOrder(rig, jointStack, {
          groupId: face.groupId,
          order: getFaceOrder(rig, face),
          depth,
        }) < 0;
      })
      .map(({ points }) => `<polygon points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    const connections = connectionSurfaceOccluders
      .filter((candidate) => !candidate.jointIds.includes(joint.id)
        && compareItemStackOrder(rig, jointStack, candidate) < 0)
      .map((candidate) => `<polygon points="${candidate.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    return `<mask id="joint-bend-mask-${index}" data-bend-mask-joint-id="${escapeXml(joint.id)}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${otherJoints}${faces}${connections}
    </mask>`;
  }).join("");

  // Complete the exposed boundary of a hidden joint using only endpoints
  // referenced by visible faces. The convex hull avoids self-intersections.
  const bridgeItems = rig.joints.flatMap((joint) => {
    if (joint.isVirtual || joint.bodyVisible
      || tubeSectionJointIds.has(joint.id)
      || !isGroupVisible(rig, joint.groupId)) return [];
    const connected = visibleFaces.filter(({ face }) => face.cameraFacingLimb
      ? face.cameraFacingLimb.startJointId === joint.id || face.cameraFacingLimb.endJointId === joint.id
      : face.vertices.some((vertex) => vertex.jointId === joint.id));
    const points = getOuterPoints(connected.flatMap(({ face, points: facePoints }) => {
      if (face.cameraFacingLimb?.startJointId === joint.id) return [facePoints[0], facePoints[3]];
      if (face.cameraFacingLimb?.endJointId === joint.id) return [facePoints[1], facePoints[2]];
      return face.vertices.flatMap((vertex, index) => vertex.jointId === joint.id ? [facePoints[index]] : []);
    }));
    if (points.length < 2) return [];
    const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
    const order = Math.min(...connected.map(({ face }) => getFaceOrder(rig, face))) - 0.001;
    const outline = joint.outlineVisible === false ? "" : points.length === 2
      ? `<polyline class="body-face-outline" points="${pointList}" />`
      : `<polygon class="body-face-outline" points="${pointList}" />`;
    const fill = points.length > 2
      ? `<polygon points="${pointList}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />`
      : "";
    return [{ id: `bridge:${joint.id}`, groupId: joint.groupId, order, depth: renderedDepthOf(joint.id),
      markup: `<g class="joint-bridge" data-bridge-joint-id="${escapeXml(joint.id)}">${fill}${outline}</g>` }];
  });

  const bodyItems = [...jointItems.map((item) => ({ ...item, depth: renderedDepthOf(item.id.slice(6)) })), ...faceItems.map((item) => {
    const face = rig.faces.find((candidate) => `face:${candidate.id}` === item.id)!;
    const jointIds = face.cameraFacingLimb
      ? [face.cameraFacingLimb.startJointId, face.cameraFacingLimb.endJointId]
      : [...new Set(face.vertices.map((vertex) => vertex.jointId))];
    return { ...item, depth: jointIds.reduce((sum, jointId) => sum + renderedDepthOf(jointId), 0) / Math.max(1, jointIds.length) };
  }), ...peerCapsuleItems, ...torsoStripItems, ...waistHipStripItems,
  ...tubeSectionItems, ...surfaceIntersectionItems, ...shapeItems, ...bridgeItems];
  const renderedBody = bodyItems
    .sort((a, b) => compareItemStackOrder(rig, a, b) || a.id.localeCompare(b.id))
    .map((item) => item.markup)
    .join("");

  const relationshipGuides = showJointLayer ? rig.joints
    .filter((joint) => joint.guideVisible && joint.parentJointId && isGroupVisible(rig, joint.groupId))
    .map((joint) => {
      const parentWorld = getJointParentWorldTransform(rig, joint.id)
        ?? getJointWorldTransform(rig, joint.parentJointId!);
      const parent = project(parentWorld, zOf(joint.parentJointId!));
      const child = projectJoint(joint.id);
      return `<line class="hierarchy-line" x1="${parent.x}" y1="${parent.y}" x2="${child.x}" y2="${child.y}"
        data-child-rotation data-joint-id="${escapeXml(joint.id)}" />`;
    })
    .join("") : "";
  const visiblePeerGroups = rig.peerGroups.filter((group) => group.jointIds.every((jointId) => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId);
    return joint ? isGroupVisible(rig, joint.groupId) : false;
  }));
  const peerLines = showJointLayer ? visiblePeerGroups.map((group) => {
    const pivotDepth = group.jointIds.reduce((sum, jointId) => sum + zOf(jointId), 0) / group.jointIds.length;
    const pivot = project(getPeerGroupPivot(rig, group.id), pivotDepth);
    return group.jointIds.map((jointId) => {
      const point = projectJoint(jointId);
      return `<line class="peer-line" x1="${pivot.x}" y1="${pivot.y}" x2="${point.x}" y2="${point.y}" />`;
    }).join("");
  }).join("") : "";
  const peerHandles = showJointLayer ? visiblePeerGroups.map((group) => {
    const pivotDepth = group.jointIds.reduce((sum, jointId) => sum + zOf(jointId), 0) / group.jointIds.length;
    const pivot = project(getPeerGroupPivot(rig, group.id), pivotDepth);
    const reference = projectJoint(group.jointIds[0]);
    const dx = reference.x - pivot.x;
    const dy = reference.y - pivot.y;
    const distance = Math.hypot(dx, dy);
    const handleDistance = Math.max(55, Math.min(90, distance));
    const handleX = pivot.x + (distance > 1e-8 ? -dy / distance : 0) * handleDistance;
    const handleY = pivot.y + (distance > 1e-8 ? dx / distance : -1) * handleDistance;
    return `<line class="peer-handle-guide" x1="${pivot.x}" y1="${pivot.y}" x2="${handleX}" y2="${handleY}" />
      <rect class="peer-pivot" x="${handleX - 6}" y="${handleY - 6}" width="12" height="12"
        data-peer-rotation data-peer-group-id="${escapeXml(group.id)}" />`;
  }).join("") : "";

  // Peer capsules are derived joints rather than replacements for their
  // member joints. Draw the complete derived capsule faintly behind the
  // regular joint controls so both structures remain visible at once.
  const virtualCapsuleGuides = showJointLayer ? visiblePeerGroups.flatMap((group) => {
    if (!group.virtualCapsule || group.jointIds.length !== 2) return [];
    const circles = group.jointIds.map(projectedJointCircle);
    const silhouette = getOuterPoints(circles.flatMap((circle) => sampleCircle(circle)));
    if (silhouette.length < 3) return [];
    const points = silhouette.map((point) => `${point.x},${point.y}`).join(" ");
    return [`<polygon class="virtual-capsule-guide" data-virtual-capsule-guide
      data-peer-group-id="${escapeXml(group.id)}" points="${points}" />`];
  }).join("") : "";

  const selectedPeerCapsule = viewState.selectedTarget === "joint"
    ? visiblePeerGroups.find((group) => group.virtualCapsule
      && group.jointIds.length === selection.jointIds.length
      && group.jointIds.every((jointId) => selection.jointIds.includes(jointId)))
    : undefined;
  const selectedCapsuleCircles: Array<{
    capsuleId: string;
    circle: ProjectedCircle;
    resize?: { kind: "joint" | "peer"; id: string; axis?: "x" | "y" | "z" };
  }> = [];
  if (showJointLayer && selectedPeerCapsule) {
    for (const jointId of selectedPeerCapsule.jointIds) {
      selectedCapsuleCircles.push({
        capsuleId: selectedPeerCapsule.id,
        circle: projectedJointCircle(jointId),
        resize: { kind: "peer", id: selectedPeerCapsule.id },
      });
    }
  } else if (showJointLayer && viewState.selectedTarget === "joint") {
    for (const jointId of selection.jointIds) {
      const joint = rig.joints.find((candidate) => candidate.id === jointId);
      const center = joint ? projectJoint(joint.id) : null;
      const axis = joint?.capsuleFlatAxes?.length === 1 ? joint.capsuleFlatAxes[0] : undefined;
      for (const circle of projectedJointCapsuleCircles(jointId) ?? []) {
        const derived = center && Math.hypot(circle.center.x - center.x, circle.center.y - center.y) > 1;
        selectedCapsuleCircles.push({
          capsuleId: jointId,
          circle,
          ...(derived && axis ? { resize: { kind: "joint" as const, id: jointId, axis } } : {}),
        });
      }
    }
  }
  const selectedCapsuleInternals = selectedCapsuleCircles.map(({ capsuleId, circle, resize }) => `
    <g class="capsule-internal-joint" data-capsule-internal-joint data-capsule-id="${escapeXml(capsuleId)}">
      <circle class="capsule-internal-sphere" cx="${circle.center.x}" cy="${circle.center.y}" r="${circle.radius}" />
      <circle class="capsule-internal-center${resize ? " is-resizable" : ""}" cx="${circle.center.x}" cy="${circle.center.y}" r="${resize ? 6 : 3.5}"
        ${resize ? `data-capsule-resize data-capsule-kind="${resize.kind}" ${resize.kind === "peer"
          ? `data-peer-group-id="${escapeXml(resize.id)}"`
          : `data-joint-id="${escapeXml(resize.id)}" data-capsule-axis="${resize.axis}"`}` : ""} />
    </g>`).join("");

  const guides = rig.joints
    .filter((joint) => (showJointLayer || showAxisLayer) && !joint.isVirtual
      && joint.guideVisible && isGroupVisible(rig, joint.groupId))
    .map((joint) => {
      const selectedJoint = viewState.selectedTarget === "joint" && selection.jointIds.includes(joint.id);
      const primaryJoint = viewState.selectedTarget === "joint" && selection.jointId === joint.id;
      const world = projectJoint(joint.id);
      const scale = scaleOf(joint.id);
      const axes = showAxisLayer ? joint.axes
        .map((axis, axisIndex) => {
          const start = projectedAxisPoint(joint.id, axis.id, -1);
          const end = projectedAxisPoint(joint.id, axis.id, 1);
          const lineStart = axis.pointSides.includes(-1) ? start : world;
          const lineEnd = axis.pointSides.includes(1) ? end : world;
          const selectedAxis = primaryJoint && selection.axisId === axis.id;
          const axisMode = !axis.alignment || axis.alignment === "child-perpendicular" ? "is-editable" : "is-derived";
          return `
            <g class="axis-guide axis-${axisIndex + 1} ${axisMode}${selectedAxis ? " is-selected" : ""}">
              <line class="axis-hit" x1="${lineStart.x}" y1="${lineStart.y}" x2="${lineEnd.x}" y2="${lineEnd.y}"
                data-select-axis data-joint-id="${escapeXml(joint.id)}" data-axis-id="${escapeXml(axis.id)}" />
              <line class="axis-line" x1="${lineStart.x}" y1="${lineStart.y}" x2="${lineEnd.x}" y2="${lineEnd.y}" />
              ${axis.pointSides.includes(-1) ? `<circle class="axis-point" data-axis-point data-joint-id="${escapeXml(joint.id)}" data-axis-id="${escapeXml(axis.id)}" data-axis-side="-1" cx="${start.x}" cy="${start.y}" r="4" />` : ""}
              ${axis.pointSides.includes(1) ? `<circle class="axis-point" data-axis-point data-joint-id="${escapeXml(joint.id)}" data-axis-id="${escapeXml(axis.id)}" data-axis-side="1" cx="${end.x}" cy="${end.y}" r="4" />` : ""}
            </g>`;
        })
        .join("") : "";

      const capsuleCircles = joint.isVirtual ? null : projectedJointCapsuleCircles(joint.id);
      const capsulePoints = capsuleCircles
        ? getOuterPoints(capsuleCircles.flatMap((circle) => sampleCircle(circle)))
            .map((point) => `${point.x},${point.y}`).join(" ")
        : "";
      const jointControl = !showJointLayer ? "" : capsulePoints
          ? `<polygon class="joint-hit joint-capsule-hit" points="${capsulePoints}"
                data-drag-joint data-joint-id="${escapeXml(joint.id)}"${joint.bodyVisible ? "" : " data-hidden-joint"} />
             <polygon class="joint-outline joint-capsule-outline" data-joint-capsule-guide
                data-joint-id="${escapeXml(joint.id)}" points="${capsulePoints}" />`
          : `<circle class="joint-hit" cx="${world.x}" cy="${world.y}" r="${viewRadiusOf(joint.id) * scale}"
                data-drag-joint data-joint-id="${escapeXml(joint.id)}"${joint.bodyVisible ? "" : " data-hidden-joint"} />
             <circle class="joint-outline" cx="${world.x}" cy="${world.y}" r="${viewRadiusOf(joint.id) * scale}" />`;

      return `
        <g class="joint-guide${selectedJoint ? " is-selected" : ""}" data-guide-joint-id="${escapeXml(joint.id)}">
          ${jointControl}
          ${axes}
          ${showJointLayer ? `<circle class="joint-center" cx="${world.x}" cy="${world.y}" r="3" /><text class="joint-label" x="${world.x}" y="${world.y - viewRadiusOf(joint.id) * scale - 8}">${escapeXml(joint.id)}</text>` : ""}
        </g>`;
    })
    .join("");

  const selectedJoint = rig.joints.find((joint) => joint.id === selection.jointId);
  const selectedAxis = showAxisLayer ? selectedJoint?.axes.find((axis) => axis.id === selection.axisId) : undefined;
  let rotationHandle = "";
  if (selectedJoint && selectedAxis && (!selectedAxis.alignment || selectedAxis.alignment === "child-perpendicular")) {
    const axisStart = projectedAxisPoint(selectedJoint.id, selectedAxis.id, -1);
    const axisEnd = projectedAxisPoint(selectedJoint.id, selectedAxis.id, 1);
    const world = { x: (axisStart.x + axisEnd.x) / 2, y: (axisStart.y + axisEnd.y) / 2 };
    const directionX = axisEnd.x - axisStart.x;
    const directionY = axisEnd.y - axisStart.y;
    const directionLength = Math.hypot(directionX, directionY) || 1;
    const distance = (viewRadiusOf(selectedJoint.id) + 34) * scaleOf(selectedJoint.id);
    const handle = { x: world.x + directionX / directionLength * distance, y: world.y + directionY / directionLength * distance };
    rotationHandle = `
      <line class="rotation-guide" x1="${world.x}" y1="${world.y}" x2="${handle.x}" y2="${handle.y}" />
      <circle class="rotation-handle" cx="${handle.x}" cy="${handle.y}" r="9"
        data-rotation-handle data-joint-id="${escapeXml(selectedJoint.id)}" data-axis-id="${escapeXml(selectedAxis.id)}" />`;
  }

  const selectedJointBounds = selection.jointIds
    .map((jointId) => rig.joints.find((joint) => joint.id === jointId))
    .filter((joint): joint is Rig["joints"][number] => Boolean(joint))
    .map((joint) => ({ joint, world: projectJoint(joint.id) }));
  let selectionTransform = "";
  if (showJointLayer && selectedJointBounds.length > 1) {
    const left = Math.min(...selectedJointBounds.map(({ joint, world }) => world.x - viewRadiusOf(joint.id) * scaleOf(joint.id))) - 10;
    const right = Math.max(...selectedJointBounds.map(({ joint, world }) => world.x + viewRadiusOf(joint.id) * scaleOf(joint.id))) + 10;
    const top = Math.min(...selectedJointBounds.map(({ joint, world }) => world.y - viewRadiusOf(joint.id) * scaleOf(joint.id))) - 10;
    const bottom = Math.max(...selectedJointBounds.map(({ joint, world }) => world.y + viewRadiusOf(joint.id) * scaleOf(joint.id))) + 10;
    const pivotX = (left + right) / 2;
    const pivotY = (top + bottom) / 2;
    const handleY = top - 34;
    selectionTransform = `
      <g class="selection-transform">
        <rect class="selection-bounds" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" />
        <line class="selection-rotation-guide" x1="${pivotX}" y1="${top}" x2="${pivotX}" y2="${handleY}" />
        <circle class="selection-rotation-handle" cx="${pivotX}" cy="${handleY}" r="9"
          data-selection-rotation data-pivot-x="${pivotX}" data-pivot-y="${pivotY}" />
        <circle class="selection-pivot" cx="${pivotX}" cy="${pivotY}" r="4" />
      </g>`;
  }

  const shapeGuides = viewState.selectedShapeId ? (() => {
    const shape = rig.artShapes?.find((candidate) => candidate.id === viewState.selectedShapeId);
    if (!showShapeLayer || !shape || !isGroupVisible(rig, shape.groupId)) return "";
    const points = shape.vertices.map((vertex) => project(getArtShapeVertexPoint(rig, vertex), vertexDepth(vertex)));
    const edgeVertices = shape.kind === "polygon" ? shape.vertices : [];
    const edges = edgeVertices.map((vertex, index) => {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      return `<line class="art-shape-edge-hit" data-shape-edge data-shape-id="${escapeXml(shape.id)}" data-after-vertex-id="${escapeXml(vertex.id)}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`;
    }).join("");
    const vertices = shape.vertices.map((vertex, index) => {
      const point = points[index];
      return `<circle class="art-shape-vertex${vertex.id === viewState.selectedShapeVertexId ? " is-selected" : ""}" data-shape-vertex data-shape-id="${escapeXml(shape.id)}" data-vertex-id="${escapeXml(vertex.id)}" cx="${point.x}" cy="${point.y}" r="7" />`;
    }).join("");
    return edges + vertices;
  })() : "";
  const draftPoints = (viewState.polygonDraft ?? []).map((point) => project(point, point.axisPoint ? zOf(point.axisPoint.jointId) : 0));
  const polygonDraft = draftPoints.length ? `<g class="polygon-draft"><polyline points="${draftPoints.map((point) => `${point.x},${point.y}`).join(" ")}" />${draftPoints.map((point, index) => `<circle data-polygon-draft-point${index === 0 ? " data-polygon-draft-start" : ""} cx="${point.x}" cy="${point.y}" r="${index === 0 ? 8 : 5}" />`).join("")}</g>` : "";
  const lineDraftPoints = (viewState.lineDraft ?? []).map((point) => project(point, point.axisPoint ? zOf(point.axisPoint.jointId) : 0));
  const lineDraft = lineDraftPoints.length ? `<g class="line-draft"><polyline points="${lineDraftPoints.map((point) => `${point.x},${point.y}`).join(" ")}" />${lineDraftPoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="6" />`).join("")}</g>` : "";
  const outputPivotPoint = rig.outputPivot?.mode === "manual"
    ? rig.outputPivot.jointId && rig.joints.some((joint) => joint.id === rig.outputPivot!.jointId)
      ? projectJoint(rig.outputPivot.jointId)
      : { x: rig.outputPivot.x, y: rig.outputPivot.y }
    : null;
  const outputPivotGuide = outputPivotPoint ? `
    <g class="output-pivot-guide" aria-label="수동 출력 피벗">
      <line x1="${outputPivotPoint.x - 16}" y1="${outputPivotPoint.y}" x2="${outputPivotPoint.x + 16}" y2="${outputPivotPoint.y}" />
      <line x1="${outputPivotPoint.x}" y1="${outputPivotPoint.y - 16}" x2="${outputPivotPoint.x}" y2="${outputPivotPoint.y + 16}" />
      <circle class="output-pivot-hit" data-output-pivot cx="${outputPivotPoint.x}" cy="${outputPivotPoint.y}" r="13" />
      <circle class="output-pivot-center" cx="${outputPivotPoint.x}" cy="${outputPivotPoint.y}" r="4" />
    </g>` : "";

  host.innerHTML = `
    <defs data-export-defs>${jointOutlineMasks}${jointBendMasks}${torsoConnectionOutlineMasks}${surfaceOcclusionMaskDefs.join("")}${connectedSphereOutlineMaskDefs.join("")}${tubeOcclusionMaskDefs.join("")}${sphereSurfaceOcclusionMaskDefs.join("")}${compositeMaskDefs.join("")}</defs>
    <g data-layer="grid">
      ${[80, 200, 320, 440, 560, 680].map((y) => `<line x1="60" y1="${y}" x2="540" y2="${y}" />`).join("")}
      <line x1="300" y1="40" x2="300" y2="740" />
    </g>
    <g data-layer="body" class="${viewState.outlinesVisible ? "show-outlines" : ""}">
      ${renderedBody}
    </g>
    <g data-layer="editor-guides">${relationshipGuides}${peerLines}${virtualCapsuleGuides}${guides}${selectedCapsuleInternals}${rotationHandle}${selectionTransform}${peerHandles}${shapeGuides}${polygonDraft}${lineDraft}${outputPivotGuide}</g>`;
}

function getOuterPoints(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((point, index) => index === 0
    || Math.hypot(point.x - sorted[index - 1].x, point.y - sorted[index - 1].y) > 1e-7);
  if (unique.length <= 2) return unique;
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (values: Point[]) => {
    const result: Point[] = [];
    for (const point of values) {
      while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 1e-7) result.pop();
      result.push(point);
    }
    return result;
  };
  const lower = half(unique);
  const upper = half([...unique].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Join each side of a two-face hidden joint from one selected outline pair. */
function getHiddenJointFaceExtensions(
  rig: Rig,
  faces: Rig["faces"],
): { points: Map<string, Point>; jointIds: Set<string>; fillOnlyJointIds: Set<string> } {
  const points = new Map<string, Point>();
  const jointIds = new Set<string>();
  const fillOnlyJointIds = new Set<string>();
  for (const joint of rig.joints) {
    if (joint.isVirtual || joint.bodyVisible || joint.faceExtensionEnabled === false || !isGroupVisible(rig, joint.groupId)) continue;
    const allConnected = faces.filter((face) => face.vertices.some((vertex) => vertex.jointId === joint.id));

    // Hips cross the torso/leg group boundary. Join both silhouette pairs:
    // outer pelvis tangent -> outer thigh, central pelvis bottom -> inner thigh.
    const outerPelvisFace = allConnected.find((face) => face.vertices.some((vertex) => (
      vertex.jointId === joint.id && vertex.axisId === "pelvis-horizontal"
    )));
    const centerPelvisFace = allConnected.find((face) => (
      face.vertices.some((vertex) => vertex.jointId === joint.id && vertex.axisId === "pelvis-vertical")
      && face.vertices.some((vertex) => vertex.jointId !== joint.id && vertex.axisId === "pelvis-vertical")
    ));
    const upperLegFace = allConnected.find((face) => face.vertices.some((vertex) => (
      vertex.jointId === joint.id && vertex.axisId === "upper-leg"
    )));
    if (outerPelvisFace && centerPelvisFace && upperLegFace) {
      const outerPelvisPoints = getFacePoints(rig, outerPelvisFace);
      const centerPelvisPoints = getFacePoints(rig, centerPelvisFace);
      const upperLegPoints = getFacePoints(rig, upperLegFace);
      const outerPelvisIndex = outerPelvisFace.vertices.findIndex((vertex) => (
        vertex.jointId === joint.id && vertex.axisId === "pelvis-horizontal"
      ));
      const outerPelvisRemoteIndex = [-1, 1]
        .map((offset) => (outerPelvisIndex + offset + outerPelvisFace.vertices.length) % outerPelvisFace.vertices.length)
        .find((index) => outerPelvisFace.vertices[index].jointId !== joint.id);
      const innerPelvisIndex = centerPelvisFace.vertices.findIndex((vertex) => (
        vertex.jointId === joint.id && vertex.axisId === "pelvis-vertical"
      ));
      const innerPelvisRemoteIndex = [-1, 1]
        .map((offset) => (innerPelvisIndex + offset + centerPelvisFace.vertices.length) % centerPelvisFace.vertices.length)
        .find((index) => centerPelvisFace.vertices[index].jointId !== joint.id
          && centerPelvisFace.vertices[index].axisId === "pelvis-vertical");
      const upperLegEdges = upperLegFace.vertices.flatMap((vertex, index) => {
        if (vertex.jointId !== joint.id || vertex.axisId !== "upper-leg") return [];
        const remoteIndex = [-1, 1]
          .map((offset) => (index + offset + upperLegFace.vertices.length) % upperLegFace.vertices.length)
          .find((candidate) => upperLegFace.vertices[candidate].jointId !== joint.id);
        return remoteIndex === undefined ? [] : [{
          face: upperLegFace,
          index,
          vertex,
          endpoint: upperLegPoints[index],
          remote: upperLegPoints[remoteIndex],
        }];
      });
      const center = getJointWorldTransform(rig, joint.id);
      if (outerPelvisRemoteIndex !== undefined && innerPelvisRemoteIndex !== undefined
        && upperLegEdges.length === 2) {
        const pelvisEdges = [
          {
            side: "outer" as const,
            pelvisFace: outerPelvisFace,
            pelvisPoints: outerPelvisPoints,
            pelvisIndex: outerPelvisIndex,
            pelvisRemoteIndex: outerPelvisRemoteIndex,
          },
          {
            side: "inner" as const,
            pelvisFace: centerPelvisFace,
            pelvisPoints: centerPelvisPoints,
            pelvisIndex: innerPelvisIndex,
            pelvisRemoteIndex: innerPelvisRemoteIndex,
          },
        ];
        const resolvePair = (pelvisEdge: (typeof pelvisEdges)[number], legEdge: (typeof upperLegEdges)[number]) => {
          const pelvisEndpoint = pelvisEdge.pelvisPoints[pelvisEdge.pelvisIndex];
          const intersection = getLineIntersection(
            pelvisEdge.pelvisPoints[pelvisEdge.pelvisRemoteIndex], pelvisEndpoint,
            legEdge.remote, legEdge.endpoint,
          ) ?? (Math.hypot(
            pelvisEndpoint.x - legEdge.endpoint.x,
            pelvisEndpoint.y - legEdge.endpoint.y,
          ) < 1e-7 ? pelvisEndpoint : null);
          return intersection ? {
            side: pelvisEdge.side,
            pelvisVertex: pelvisEdge.pelvisFace.vertices[pelvisEdge.pelvisIndex],
            legVertex: legEdge.vertex,
            intersection,
            pelvisScale: getLineScale(
              pelvisEdge.pelvisPoints[pelvisEdge.pelvisRemoteIndex], pelvisEndpoint, intersection,
            ),
            legScale: getLineScale(legEdge.remote, legEdge.endpoint, intersection),
          } : null;
        };
        const matchings = [upperLegEdges, [...upperLegEdges].reverse()];
        const candidates = matchings.flatMap((legEdges) => {
          const pairs = pelvisEdges.map((pelvisEdge, index) => resolvePair(pelvisEdge, legEdges[index]));
          if (pairs.some((pair) => pair === null)) return [];
          const outerPair = pairs[0]!;
          const innerPair = pairs[1]!;
          const outerDistance = Math.hypot(
            outerPair.intersection.x - center.x, outerPair.intersection.y - center.y,
          );
          const innerDistance = Math.hypot(
            innerPair.intersection.x - center.x, innerPair.intersection.y - center.y,
          );
          if (innerPair.pelvisScale < -1e-7
            || outerDistance > joint.radius * 6 || innerDistance > joint.radius * 4) return [];
          const extensionPenalty = [outerPair, innerPair].reduce((total, pair) => total
            + (pair.pelvisScale >= 1 - 1e-7 ? 0 : 1)
            + (pair.legScale >= 1 - 1e-7 ? 0 : 1), 0);
          return [{ pairs: [outerPair, innerPair], extensionPenalty,
            cost: outerDistance ** 2 + innerDistance ** 2 }];
        }).sort((first, second) => first.extensionPenalty - second.extensionPenalty || first.cost - second.cost);
        const outerCandidates = upperLegEdges.flatMap((legEdge) => {
          const pair = resolvePair(pelvisEdges[0], legEdge);
          if (!pair) return [];
          const distance = Math.hypot(pair.intersection.x - center.x, pair.intersection.y - center.y);
          const extensionPenalty = (pair.pelvisScale >= 1 - 1e-7 ? 0 : 1)
            + (pair.legScale >= 1 - 1e-7 ? 0 : 1);
          return distance <= joint.radius * 6 ? [{ pair, distance, extensionPenalty }] : [];
        }).sort((first, second) => first.extensionPenalty - second.extensionPenalty || first.distance - second.distance);
        const idealOuter = outerCandidates.find((candidate) => candidate.extensionPenalty === 0);
        // A true two-ray outer extension has priority. Use a complete pairing
        // only when its outer leg edge is the same; otherwise retain that outer
        // miter and bridge the unresolved inner side. Without an ideal outer
        // ray, prefer the best complete pairing so a valid inner join is kept.
        const selected = idealOuter
          ? candidates.find((candidate) => samePointRef(candidate.pairs[0].legVertex, idealOuter.pair.legVertex))
          : candidates[0];
        if (selected) {
          for (const pair of selected.pairs) {
            for (const face of allConnected) {
              face.vertices.forEach((vertex, index) => {
                if (samePointRef(vertex, pair.pelvisVertex) || samePointRef(vertex, pair.legVertex)) {
                  points.set(`${face.id}:${index}`, pair.intersection);
                }
              });
            }
          }
          jointIds.add(joint.id);
          continue;
        }

        // If no compatible complete pairing is usable, retain the best outer
        // miter and let a fill-only bridge close the inner gap.
        const outerFallback = (idealOuter ?? outerCandidates[0])?.pair;
        if (outerFallback) {
          for (const face of allConnected) {
            face.vertices.forEach((vertex, index) => {
              if (samePointRef(vertex, outerFallback.pelvisVertex)
                || samePointRef(vertex, outerFallback.legVertex)) {
                points.set(`${face.id}:${index}`, outerFallback.intersection);
              }
            });
          }
          fillOnlyJointIds.add(joint.id);
          continue;
        }
      }
    }

    // Two ordinary axes define two cross-sections even when one section belongs
    // to a compound surface spanning several faces/groups (shoulder band +
    // torso, for example). Collapse that compound side after shared edges are
    // removed, and pair it with the single outgoing child face.
    if (joint.axes.filter((axis) => !axis.alignment).length !== 2) continue;
    const connected = allConnected;
    const outgoingFaces = connected.filter((face) => {
      const target = face.rotationTarget;
      if (target.type !== "child") return false;
      return rig.joints.find((candidate) => candidate.id === target.childJointId)
        ?.parentJointId === joint.id;
    });
    if (outgoingFaces.length !== 1) continue;
    const outgoingFace = outgoingFaces[0];
    const edges = connected.flatMap((face) => {
      const facePoints = getFacePoints(rig, face);
      return face.vertices.flatMap((vertex, index) => {
        if (vertex.jointId !== joint.id) return [];
        const endpoint = facePoints[index];
        return [-1, 1].flatMap((offset) => {
          const remoteIndex = (index + offset + face.vertices.length) % face.vertices.length;
          const remoteVertex = face.vertices[remoteIndex];
          if (remoteVertex.jointId === joint.id) return [];
          // An edge referenced by another face in the same group is internal,
          // so only unshared silhouette edges are candidates for extension.
          if (connected.some((candidate) => candidate.id !== face.id
            && hasMatchingEdge(candidate, vertex, remoteVertex))) return [];
          return [{ face, index, vertex, endpoint, remote: facePoints[remoteIndex] }];
        });
      });
    });
    if (edges.length !== 4) continue;
    const firstEdges = edges.filter((edge) => edge.face.id !== outgoingFace.id);
    const secondEdges = edges.filter((edge) => edge.face.id === outgoingFace.id);
    if (firstEdges.length !== 2 || secondEdges.length !== 2) continue;

    const center = getJointWorldTransform(rig, joint.id);
    const averageRemote = (faceEdges: typeof edges): Point => ({
      x: faceEdges.reduce((total, edge) => total + edge.remote.x, 0) / faceEdges.length,
      y: faceEdges.reduce((total, edge) => total + edge.remote.y, 0) / faceEdges.length,
    });
    const firstRemote = averageRemote(firstEdges);
    const secondRemote = averageRemote(secondEdges);
    // Traverse through the joint: the first face enters it and the second
    // leaves it. Equal cross-product signs are the same silhouette side.
    const firstDirection = { x: center.x - firstRemote.x, y: center.y - firstRemote.y };
    const secondDirection = { x: secondRemote.x - center.x, y: secondRemote.y - center.y };
    const side = (edge: (typeof edges)[number], direction: Point): number => {
      const cross = direction.x * (edge.endpoint.y - center.y)
        - direction.y * (edge.endpoint.x - center.x);
      return Math.abs(cross) < 1e-7 ? 0 : Math.sign(cross);
    };
    const matchings = [
      [[firstEdges[0], secondEdges[0]], [firstEdges[1], secondEdges[1]]],
      [[firstEdges[0], secondEdges[1]], [firstEdges[1], secondEdges[0]]],
    ];
    const candidates = matchings.flatMap((matching) => {
      const pairs = matching.map(([first, second]) => {
        const intersection = getLineIntersection(first.remote, first.endpoint, second.remote, second.endpoint)
          ?? (Math.hypot(first.endpoint.x - second.endpoint.x, first.endpoint.y - second.endpoint.y) < 1e-7
            ? first.endpoint : null);
        return intersection ? { first, second, intersection } : null;
      });
      if (pairs.some((pair) => !pair)) return [];
      const sideMismatch = matching.reduce((total, [first, second]) => {
        const firstSide = side(first, firstDirection);
        const secondSide = side(second, secondDirection);
        return total + (firstSide !== 0 && secondSide !== 0 && firstSide === secondSide ? 0 : 1);
      }, 0);
      const cost = pairs.reduce((total, pair) => total
        + (pair!.first.endpoint.x - pair!.second.endpoint.x) ** 2
        + (pair!.first.endpoint.y - pair!.second.endpoint.y) ** 2, 0);
      return [{ pairs: pairs as Array<NonNullable<(typeof pairs)[number]>>, sideMismatch, cost }];
    }).sort((first, second) => first.sideMismatch - second.sideMismatch || first.cost - second.cost);
    const selected = candidates[0];
    if (!selected) continue;
    for (const { first, second, intersection } of selected.pairs) {
      for (const face of connected) {
        face.vertices.forEach((vertex, index) => {
          if (samePointRef(vertex, first.vertex) || samePointRef(vertex, second.vertex)) {
            points.set(`${face.id}:${index}`, intersection);
          }
        });
      }
    }
    jointIds.add(joint.id);
  }
  return { points, jointIds, fillOnlyJointIds };
}

function getLineScale(start: Point, end: Point, point: Point): number {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const lengthSquared = x * x + y * y;
  if (lengthSquared < 1e-12) return Number.NEGATIVE_INFINITY;
  return ((point.x - start.x) * x + (point.y - start.y) * y) / lengthSquared;
}

function getLineIntersection(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): Point | null {
  const firstX = firstEnd.x - firstStart.x;
  const firstY = firstEnd.y - firstStart.y;
  const secondX = secondEnd.x - secondStart.x;
  const secondY = secondEnd.y - secondStart.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) < 1e-9) return null;
  const offsetX = secondStart.x - firstStart.x;
  const offsetY = secondStart.y - firstStart.y;
  const scale = (offsetX * secondY - offsetY * secondX) / denominator;
  return { x: firstStart.x + firstX * scale, y: firstStart.y + firstY * scale };
}

function compareItemStackOrder(
  rig: Rig,
  first: { groupId?: string; order: number; depth?: number },
  second: { groupId?: string; order: number; depth?: number },
): number {
  const groupOrderOf = (item: { groupId?: string }) => item.groupId
    ? rig.groups.find((group) => group.id === item.groupId)?.order ?? 0 : 0;
  // SVG uses painter's order: draw the camera-farther item first, then let
  // nearer items cover it. This must apply across groups as well: group order
  // only resolves elements at the same camera distance.
  const depthDifference = (first.depth ?? 0) - (second.depth ?? 0);
  if (Math.abs(depthDifference) > 1e-7) return depthDifference;
  const groupDifference = groupOrderOf(first) - groupOrderOf(second);
  if (groupDifference !== 0) return groupDifference;
  // Authored item layers still resolve coplanar items deterministically.
  return first.order - second.order;
}

function hasMatchingEdge(
  face: Rig["faces"][number],
  start: Rig["faces"][number]["vertices"][number],
  end: Rig["faces"][number]["vertices"][number],
): boolean {
  return face.vertices.some((candidateStart, index) => {
    const candidateEnd = face.vertices[(index + 1) % face.vertices.length];
    return (samePointRef(candidateStart, start) && samePointRef(candidateEnd, end))
      || (samePointRef(candidateStart, end) && samePointRef(candidateEnd, start));
  });
}

function samePointRef(
  first: Rig["faces"][number]["vertices"][number],
  second: Rig["faces"][number]["vertices"][number],
): boolean {
  return first.jointId === second.jointId
    && first.axisId === second.axisId
    && first.side === second.side;
}

function getFaceOrder(rig: Rig, face: Rig["faces"][number]): number {
  if (face.layerOrder !== undefined) return face.layerOrder;
  const ids = [...new Set(face.vertices.map((vertex) => vertex.jointId))];
  const total = ids.reduce(
    (sum, id) => sum + (rig.joints.find((joint) => joint.id === id)?.renderOrder ?? 0),
    0,
  );
  return total / Math.max(ids.length, 1) + face.orderOffset;
}

function isGroupVisible(rig: Rig, groupId: string | undefined): boolean {
  if (!groupId) return true;
  return rig.groups.find((group) => group.id === groupId)?.visible ?? true;
}

function resolveColor(rig: Rig, color: string | undefined, paletteId: string | undefined): string {
  return paletteId ? rig.palette.find((entry) => entry.id === paletteId)?.color ?? color ?? rig.defaultColor : color ?? rig.defaultColor;
}


function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}
