import type { Rig } from "../rig/types.ts";
import { getAxisPoint, getAxisWorldAngle, getFacePoints, getJointWorldTransform, getPeerGroupPivot, type Point } from "../rig/geometry.ts";
import type { EditorSelection, EditorViewState } from "./types.ts";

export function renderSvgEditor(
  host: SVGSVGElement,
  rig: Rig,
  selection: EditorSelection,
  viewState: EditorViewState,
): void {
  const visibleJoints = rig.joints
    .filter((joint) => joint.bodyVisible && isGroupVisible(rig, joint.groupId));
  const visibleFaces = rig.faces
    .filter((face) => isGroupVisible(rig, face.groupId))
    .map((face) => ({ face, points: getFacePoints(rig, face) }));

  const jointItems = visibleJoints
    .map((joint, index) => {
      const world = getJointWorldTransform(rig, joint.id);
      return {
        id: `joint:${joint.id}`,
        groupId: joint.groupId,
        order: joint.renderOrder,
        markup: `<g class="body-joint-item">
          <circle class="body-joint" data-body-joint data-joint-id="${escapeXml(joint.id)}" cx="${world.x}" cy="${world.y}" r="${joint.bodyRadius ?? joint.radius}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />
          <circle class="body-joint-outline" cx="${world.x}" cy="${world.y}" r="${joint.bodyRadius ?? joint.radius}" mask="url(#joint-outline-mask-${index})" />
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
        const world = getJointWorldTransform(rig, candidate.id);
        return `<circle cx="${world.x}" cy="${world.y}" r="${candidate.bodyRadius ?? candidate.radius}" fill="#000" stroke="#000" stroke-width="3" />`;
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
    if (joint.isVirtual || joint.bodyVisible || !isGroupVisible(rig, joint.groupId)) return [];
    const connected = visibleFaces.filter(({ face }) => face.vertices.some((vertex) => vertex.jointId === joint.id));
    const points = getOuterPoints(connected.flatMap(({ face }) => face.vertices
      .filter((vertex) => vertex.jointId === joint.id)
      .map((vertex) => getAxisPoint(rig, joint, joint.axes.find((axis) => axis.id === vertex.axisId)!, vertex.side))));
    if (points.length < 2) return [];
    const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
    const groupOrder = joint.groupId ? rig.groups.find((group) => group.id === joint.groupId)?.order ?? 0 : 0;
    const order = Math.min(...connected.map(({ face }) => getItemStackOrder(rig, {
      groupId: face.groupId, order: getFaceOrder(rig, face),
    }))) - groupOrder - 0.001;
    const outline = points.length === 2
      ? `<polyline class="body-face-outline" points="${pointList}" />`
      : `<polygon class="body-face-outline" points="${pointList}" />`;
    const fill = points.length > 2
      ? `<polygon points="${pointList}" fill="${escapeXml(resolveColor(rig, joint.color, joint.paletteId))}" />`
      : "";
    return [{ id: `bridge:${joint.id}`, groupId: joint.groupId, order,
      markup: `<g class="joint-bridge" data-bridge-joint-id="${escapeXml(joint.id)}">${fill}${outline}</g>` }];
  });

  const bodyItems = [...jointItems, ...faceItems, ...bridgeItems];
  const renderedBody = bodyItems
    .sort((a, b) => getItemStackOrder(rig, a) - getItemStackOrder(rig, b) || a.id.localeCompare(b.id))
    .map((item) => item.markup)
    .join("");

  const relationshipGuides = rig.joints
    .filter((joint) => joint.guideVisible && joint.parentJointId && isGroupVisible(rig, joint.groupId))
    .map((joint) => {
      const parent = getJointWorldTransform(rig, joint.parentJointId!);
      const child = getJointWorldTransform(rig, joint.id);
      return `<line class="hierarchy-line" x1="${parent.x}" y1="${parent.y}" x2="${child.x}" y2="${child.y}"
        data-child-rotation data-joint-id="${escapeXml(joint.id)}" />`;
    })
    .join("");
  const visiblePeerGroups = rig.peerGroups.filter((group) => group.jointIds.every((jointId) => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId);
    return joint ? isGroupVisible(rig, joint.groupId) : false;
  }));
  const peerLines = visiblePeerGroups.map((group) => {
    const pivot = getPeerGroupPivot(rig, group.id);
    return group.jointIds.map((jointId) => {
      const point = getJointWorldTransform(rig, jointId);
      return `<line class="peer-line" x1="${pivot.x}" y1="${pivot.y}" x2="${point.x}" y2="${point.y}" />`;
    }).join("");
  }).join("");
  const peerHandles = visiblePeerGroups.map((group) => {
    const pivot = getPeerGroupPivot(rig, group.id);
    const reference = getJointWorldTransform(rig, group.jointIds[0]);
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
      const world = getJointWorldTransform(rig, joint.id);
      const axes = joint.axes
        .map((axis, axisIndex) => {
          const start = getAxisPoint(rig, joint, axis, -1);
          const end = getAxisPoint(rig, joint, axis, 1);
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
        ? `<rect class="virtual-joint-hit" x="${world.x - joint.radius}" y="${world.y - joint.radius}" width="${joint.radius * 2}" height="${joint.radius * 2}"
              data-drag-joint data-joint-id="${escapeXml(joint.id)}" />
           <rect class="virtual-joint-outline" x="${world.x - 5}" y="${world.y - 5}" width="10" height="10" />`
        : `<circle class="joint-hit" cx="${world.x}" cy="${world.y}" r="${joint.radius}"
              data-drag-joint data-joint-id="${escapeXml(joint.id)}"${joint.bodyVisible ? "" : " data-hidden-joint"} />
           <circle class="joint-outline" cx="${world.x}" cy="${world.y}" r="${joint.radius}" />`;

      return `
        <g class="joint-guide${selectedJoint ? " is-selected" : ""}" data-guide-joint-id="${escapeXml(joint.id)}">
          ${jointControl}
          ${axes}
          <circle class="joint-center" cx="${world.x}" cy="${world.y}" r="3" />
          <text class="joint-label" x="${world.x}" y="${world.y - joint.radius - 8}">${escapeXml(joint.id)}</text>
        </g>`;
    })
    .join("");

  const selectedJoint = rig.joints.find((joint) => joint.id === selection.jointId);
  const selectedAxis = selectedJoint?.axes.find((axis) => axis.id === selection.axisId);
  let rotationHandle = "";
  if (selectedJoint && selectedAxis && !selectedAxis.alignment) {
    const world = getJointWorldTransform(rig, selectedJoint.id);
    const radians = (getAxisWorldAngle(rig, selectedJoint, selectedAxis) * Math.PI) / 180;
    const distance = selectedJoint.radius + 34;
    const x = world.x + Math.cos(radians) * distance;
    const y = world.y + Math.sin(radians) * distance;
    rotationHandle = `
      <line class="rotation-guide" x1="${world.x}" y1="${world.y}" x2="${x}" y2="${y}" />
      <circle class="rotation-handle" cx="${x}" cy="${y}" r="9"
        data-rotation-handle data-joint-id="${escapeXml(selectedJoint.id)}" data-axis-id="${escapeXml(selectedAxis.id)}" />`;
  }

  const selectedJointBounds = selection.jointIds
    .map((jointId) => rig.joints.find((joint) => joint.id === jointId))
    .filter((joint): joint is Rig["joints"][number] => Boolean(joint))
    .map((joint) => ({ joint, world: getJointWorldTransform(rig, joint.id) }));
  let selectionTransform = "";
  if (selectedJointBounds.length > 1) {
    const left = Math.min(...selectedJointBounds.map(({ joint, world }) => world.x - joint.radius)) - 10;
    const right = Math.max(...selectedJointBounds.map(({ joint, world }) => world.x + joint.radius)) + 10;
    const top = Math.min(...selectedJointBounds.map(({ joint, world }) => world.y - joint.radius)) - 10;
    const bottom = Math.max(...selectedJointBounds.map(({ joint, world }) => world.y + joint.radius)) + 10;
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

function getItemStackOrder(
  rig: Rig,
  item: { groupId?: string; order: number },
): number {
  const groupOrder = item.groupId
    ? rig.groups.find((group) => group.id === item.groupId)?.order ?? 0
    : 0;
  return groupOrder + item.order;
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
