import type { Rig } from "../rig/types.ts";
import { getAxisPoint, getAxisWorldAngle, getFacePoints, getJointViewRadius, getJointWorldTransform, getPeerGroupPivot, getProjectedDepth, getProjectionScale, projectPoint, type Point } from "../rig/geometry.ts";
import type { EditorSelection, EditorViewState } from "./types.ts";

export function renderSvgEditor(
  host: SVGSVGElement,
  rig: Rig,
  selection: EditorSelection,
  viewState: EditorViewState,
): void {
  const depthOf = (jointId: string) => rig.joints.find((joint) => joint.id === jointId)?.depth ?? 0;
  const project = (point: Point, depth = 0) => projectPoint(rig, point, depth);
  const projectJoint = (jointId: string) => project(getJointWorldTransform(rig, jointId), depthOf(jointId));
  const scaleOf = (jointId: string) => {
    const world = getJointWorldTransform(rig, jointId);
    return getProjectionScale(rig, getProjectedDepth(rig, world, depthOf(jointId)));
  };
  const viewRadiusOf = (jointId: string) => getJointViewRadius(rig, rig.joints.find((joint) => joint.id === jointId)!);
  const bodyRadiusOf = (jointId: string) => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId)!;
    const bodyRadius = joint.bodyRadius ?? joint.radius;
    return bodyRadius * viewRadiusOf(jointId) / joint.radius;
  };
  const renderedDepthOf = (jointId: string) => {
    const world = getJointWorldTransform(rig, jointId);
    return getProjectedDepth(rig, world, depthOf(jointId));
  };
  // Project every axis endpoint with the same X/Z transform as its joint
  // centre. Keeping endpoints in screen space makes the connecting faces
  // appear to move independently while the view rotates.
  const projectedAxisPoint = (jointId: string, axisId: string, side: -1 | 1): Point => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId)!;
    const axis = joint.axes.find((candidate) => candidate.id === axisId)!;
    return project(getAxisPoint(rig, joint, axis, side), depthOf(jointId));
  };
  const visibleJoints = rig.joints
    .filter((joint) => joint.bodyVisible && isGroupVisible(rig, joint.groupId));
  const faceDefinitions = rig.faces.filter((face) => isGroupVisible(rig, face.groupId));
  const extension = viewState.extendHiddenJointFaces && rig.viewYRotation === 0
    ? getHiddenJointFaceExtensions(rig, faceDefinitions)
    : { points: new Map<string, Point>(), jointIds: new Set<string>(), fillOnlyJointIds: new Set<string>() };
  const visibleFaces = faceDefinitions.map((face) => ({
    face,
    points: face.vertices.map((vertex, index) => {
      const extended = extension.points.get(`${face.id}:${index}`);
      return extended
        ? project(extended, depthOf(vertex.jointId))
        : projectedAxisPoint(vertex.jointId, vertex.axisId, vertex.side);
    }),
  }));

  const jointItems = visibleJoints
    .map((joint, index) => {
      const world = projectJoint(joint.id);
      const radius = bodyRadiusOf(joint.id) * scaleOf(joint.id);
      return {
        id: `joint:${joint.id}`,
        groupId: joint.groupId,
        order: joint.renderOrder,
        markup: `<g class="body-joint-item">
          <circle class="body-joint" data-body-joint data-joint-id="${escapeXml(joint.id)}" cx="${world.x}" cy="${world.y}" r="${radius}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />
          <circle class="body-joint-outline" cx="${world.x}" cy="${world.y}" r="${radius}" mask="url(#joint-outline-mask-${index})" />
        </g>`,
      };
    });

  const faceItems = visibleFaces
    .map(({ face, points }) => {
      const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
      const outlinePath = points.map((point, index) => {
        const nextIndex = (index + 1) % points.length;
        const nextPoint = points[nextIndex];
        const sameJoint = face.vertices[index].jointId === face.vertices[nextIndex].jointId;
        const sharedGroupEdge = visibleFaces.some(({ face: candidate }) => (
          candidate.id !== face.id
          && candidate.groupId === face.groupId
          && hasMatchingEdge(candidate, face.vertices[index], face.vertices[nextIndex])
        ));
        if (sharedGroupEdge) return "";
        if (viewState.hideSameJointEdges && sameJoint) return "";
        return `M ${point.x} ${point.y} L ${nextPoint.x} ${nextPoint.y}`;
      }).filter(Boolean).join(" ");
      return {
        id: `face:${face.id}`,
        groupId: face.groupId,
        order: getFaceOrder(rig, face),
        markup: `<g class="body-face-item">
          <polygon class="body-face${viewState.selectedTarget === "face" && face.id === viewState.selectedFaceId ? " is-selected" : ""}" data-face-id="${escapeXml(face.id)}" points="${pointList}" fill="${escapeXml(resolveColor(rig, face.color, face.paletteId))}" />
          <path class="body-face-outline" d="${outlinePath}" />
        </g>`,
      };
    });

  const jointOutlineMasks = visibleJoints.map((joint, index) => {
    const otherJoints = visibleJoints
      .filter((candidate) => candidate.id !== joint.id && candidate.groupId === joint.groupId)
      .map((candidate) => {
        const world = projectJoint(candidate.id);
        return `<circle cx="${world.x}" cy="${world.y}" r="${bodyRadiusOf(candidate.id) * scaleOf(candidate.id)}" fill="#000" stroke="#000" stroke-width="3" />`;
      })
      .join("");
    const faces = visibleFaces
      .filter(({ face }) => face.groupId === joint.groupId)
      .map(({ points }) => `<polygon points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    return `<mask id="joint-outline-mask-${index}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${otherJoints}${faces}
    </mask>`;
  }).join("");

  // Complete the exposed boundary of a hidden joint using only endpoints
  // referenced by visible faces. The convex hull avoids self-intersections.
  const bridgeItems = rig.joints.flatMap((joint) => {
    if (joint.isVirtual || joint.bodyVisible || extension.jointIds.has(joint.id)
      || !isGroupVisible(rig, joint.groupId)) return [];
    const connected = visibleFaces.filter(({ face }) => face.vertices.some((vertex) => vertex.jointId === joint.id));
    const points = getOuterPoints(connected.flatMap(({ face }) => face.vertices
      .filter((vertex) => vertex.jointId === joint.id)
      .map((vertex) => projectedAxisPoint(vertex.jointId, vertex.axisId, vertex.side))));
    if (points.length < 2) return [];
    const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
    const groupOrder = joint.groupId ? rig.groups.find((group) => group.id === joint.groupId)?.order ?? 0 : 0;
    const order = Math.min(...connected.map(({ face }) => getItemStackOrder(rig, {
      groupId: face.groupId, order: getFaceOrder(rig, face),
    }))) - groupOrder - 0.001;
    const outline = extension.fillOnlyJointIds.has(joint.id) ? "" : points.length === 2
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
    return { ...item, depth: face.vertices.reduce((sum, vertex) => sum + renderedDepthOf(vertex.jointId), 0) / face.vertices.length };
  }), ...bridgeItems];
  const renderedBody = bodyItems
    .sort((a, b) => getItemStackOrder(rig, a) - getItemStackOrder(rig, b) || a.id.localeCompare(b.id))
    .map((item) => item.markup)
    .join("");

  const relationshipGuides = rig.joints
    .filter((joint) => joint.guideVisible && joint.parentJointId && isGroupVisible(rig, joint.groupId))
    .map((joint) => {
      const parent = projectJoint(joint.parentJointId!);
      const child = projectJoint(joint.id);
      return `<line class="hierarchy-line" x1="${parent.x}" y1="${parent.y}" x2="${child.x}" y2="${child.y}"
        data-child-rotation data-joint-id="${escapeXml(joint.id)}" />`;
    })
    .join("");
  const visiblePeerGroups = rig.peerGroups.filter((group) => group.jointIds.every((jointId) => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId);
    return joint ? isGroupVisible(rig, joint.groupId) : false;
  }));
  const peerLines = visiblePeerGroups.map((group) => {
    const pivotDepth = group.centerJointId ? depthOf(group.centerJointId)
      : group.jointIds.reduce((sum, jointId) => sum + depthOf(jointId), 0) / group.jointIds.length;
    const pivot = project(getPeerGroupPivot(rig, group.id), pivotDepth);
    return group.jointIds.map((jointId) => {
      const point = projectJoint(jointId);
      return `<line class="peer-line" x1="${pivot.x}" y1="${pivot.y}" x2="${point.x}" y2="${point.y}" />`;
    }).join("");
  }).join("");
  const peerHandles = visiblePeerGroups.map((group) => {
    const pivotDepth = group.centerJointId ? depthOf(group.centerJointId)
      : group.jointIds.reduce((sum, jointId) => sum + depthOf(jointId), 0) / group.jointIds.length;
    const pivot = project(getPeerGroupPivot(rig, group.id), pivotDepth);
    const reference = projectJoint(group.jointIds[0]);
    const dx = reference.x - pivot.x;
    const dy = reference.y - pivot.y;
    const distance = Math.hypot(dx, dy);
    const handleDistance = Math.max(55, Math.min(90, distance));
    const handleX = pivot.x + (distance > 1e-8 ? -dy / distance : 0) * handleDistance;
    const handleY = pivot.y + (distance > 1e-8 ? dx / distance : -1) * handleDistance;
    return `<line class="peer-handle-guide" x1="${pivot.x}" y1="${pivot.y}" x2="${handleX}" y2="${handleY}" />
      <circle class="peer-center" cx="${pivot.x}" cy="${pivot.y}" r="3" />
      <rect class="peer-pivot" x="${handleX - 6}" y="${handleY - 6}" width="12" height="12"
        data-peer-rotation data-peer-group-id="${escapeXml(group.id)}" />`;
  }).join("");

  const guides = rig.joints
    .filter((joint) => joint.guideVisible && isGroupVisible(rig, joint.groupId))
    .map((joint) => {
      const selectedJoint = viewState.selectedTarget === "joint" && selection.jointIds.includes(joint.id);
      const primaryJoint = viewState.selectedTarget === "joint" && selection.jointId === joint.id;
      const world = projectJoint(joint.id);
      const scale = scaleOf(joint.id);
      const axes = joint.axes
        .map((axis, axisIndex) => {
          const start = projectedAxisPoint(joint.id, axis.id, -1);
          const end = projectedAxisPoint(joint.id, axis.id, 1);
          const lineStart = axis.pointSides.includes(-1) ? start : world;
          const lineEnd = axis.pointSides.includes(1) ? end : world;
          const selectedAxis = primaryJoint && selection.axisId === axis.id;
          const axisMode = axis.alignment ? "is-derived" : "is-editable";
          return `
            <g class="axis-guide axis-${axisIndex + 1} ${axisMode}${selectedAxis ? " is-selected" : ""}">
              <line class="axis-hit" x1="${lineStart.x}" y1="${lineStart.y}" x2="${lineEnd.x}" y2="${lineEnd.y}"
                data-select-axis data-joint-id="${escapeXml(joint.id)}" data-axis-id="${escapeXml(axis.id)}" />
              <line class="axis-line" x1="${lineStart.x}" y1="${lineStart.y}" x2="${lineEnd.x}" y2="${lineEnd.y}" />
              ${axis.pointSides.includes(-1) ? `<circle class="axis-point" cx="${start.x}" cy="${start.y}" r="4" />` : ""}
              ${axis.pointSides.includes(1) ? `<circle class="axis-point" cx="${end.x}" cy="${end.y}" r="4" />` : ""}
            </g>`;
        })
        .join("");

      const jointControl = joint.isVirtual
        ? `<rect class="virtual-joint-hit" x="${world.x - viewRadiusOf(joint.id) * scale}" y="${world.y - viewRadiusOf(joint.id) * scale}" width="${viewRadiusOf(joint.id) * 2 * scale}" height="${viewRadiusOf(joint.id) * 2 * scale}"
              data-drag-joint data-joint-id="${escapeXml(joint.id)}" />
           <rect class="virtual-joint-outline" x="${world.x - 5}" y="${world.y - 5}" width="10" height="10" />`
        : `<circle class="joint-hit" cx="${world.x}" cy="${world.y}" r="${viewRadiusOf(joint.id) * scale}"
              data-drag-joint data-joint-id="${escapeXml(joint.id)}"${joint.bodyVisible ? "" : " data-hidden-joint"} />
           <circle class="joint-outline" cx="${world.x}" cy="${world.y}" r="${viewRadiusOf(joint.id) * scale}" />`;

      return `
        <g class="joint-guide${selectedJoint ? " is-selected" : ""}" data-guide-joint-id="${escapeXml(joint.id)}">
          ${jointControl}
          ${axes}
          <circle class="joint-center" cx="${world.x}" cy="${world.y}" r="3" />
          <text class="joint-label" x="${world.x}" y="${world.y - viewRadiusOf(joint.id) * scale - 8}">${escapeXml(joint.id)}</text>
        </g>`;
    })
    .join("");

  const selectedJoint = rig.joints.find((joint) => joint.id === selection.jointId);
  const selectedAxis = selectedJoint?.axes.find((axis) => axis.id === selection.axisId);
  let rotationHandle = "";
  if (selectedJoint && selectedAxis && !selectedAxis.alignment) {
    const world = projectJoint(selectedJoint.id);
    const radians = (getAxisWorldAngle(rig, selectedJoint, selectedAxis) * Math.PI) / 180;
    const distance = (viewRadiusOf(selectedJoint.id) + 34) * scaleOf(selectedJoint.id);
    const handle = { x: world.x + Math.cos(radians) * distance, y: world.y + Math.sin(radians) * distance };
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
  if (selectedJointBounds.length > 1) {
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

  host.innerHTML = `
    <defs data-export-defs>${jointOutlineMasks}</defs>
    <g data-layer="grid">
      ${[80, 200, 320, 440, 560, 680].map((y) => `<line x1="60" y1="${y}" x2="540" y2="${y}" />`).join("")}
      <line x1="300" y1="40" x2="300" y2="740" />
    </g>
    <g data-layer="body" class="${viewState.outlinesVisible ? "show-outlines" : ""}">
      ${renderedBody}
    </g>
    <g data-layer="editor-guides">${relationshipGuides}${peerLines}${guides}${rotationHandle}${selectionTransform}${peerHandles}</g>`;
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
    if (joint.isVirtual || joint.bodyVisible || !isGroupVisible(rig, joint.groupId)) continue;
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

function getItemStackOrder(
  rig: Rig,
  item: { groupId?: string; order: number; depth?: number },
): number {
  const groupOrder = item.groupId
    ? rig.groups.find((group) => group.id === item.groupId)?.order ?? 0
    : 0;
  // Depth complements the authored group/layer order; it does not replace it.
  return groupOrder + item.order + (item.depth ?? 0) / 10;
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
