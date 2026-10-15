import type { Rig } from "../rig/types";
import { getAxisPoint, getAxisWorldAngle, getFacePoints, getJointWorldTransform, getPeerGroupPivot } from "../rig/geometry";
import type { EditorSelection, EditorViewState } from "./types";

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
          <circle class="body-joint" cx="${world.x}" cy="${world.y}" r="${joint.bodyRadius ?? joint.radius}" fill="${escapeXml(joint.color ?? rig.defaultColor)}" />
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
        if (viewState.hideSameJointEdges && sameJoint) return "";
        return `M ${point.x} ${point.y} L ${nextPoint.x} ${nextPoint.y}`;
      }).filter(Boolean).join(" ");
      return {
        id: `face:${face.id}`,
        groupId: face.groupId,
        order: getFaceOrder(rig, face),
        markup: `<g class="body-face-item">
          <polygon class="body-face${face.id === viewState.selectedFaceId ? " is-selected" : ""}" data-face-id="${escapeXml(face.id)}" points="${pointList}" fill="${escapeXml(face.color ?? rig.defaultColor)}" />
          <path class="body-face-outline" d="${outlinePath}" />
        </g>`,
      };
    });

  const jointOutlineMasks = visibleJoints.map((joint, index) => {
    const otherJoints = visibleJoints
      .filter((candidate) => candidate.id !== joint.id)
      .map((candidate) => {
        const world = getJointWorldTransform(rig, candidate.id);
        return `<circle cx="${world.x}" cy="${world.y}" r="${candidate.bodyRadius ?? candidate.radius}" fill="#000" stroke="#000" stroke-width="3" />`;
      })
      .join("");
    const faces = visibleFaces
      .map(({ points }) => `<polygon points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#000" stroke="#000" stroke-width="3" />`)
      .join("");
    return `<mask id="joint-outline-mask-${index}" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4600" height="4780" mask-type="luminance">
      <rect x="-2000" y="-2000" width="4600" height="4780" fill="#fff" />
      ${otherJoints}${faces}
    </mask>`;
  }).join("");

  const bodyItems = [...jointItems, ...faceItems];
  const renderGroupItems = (groupId: string | undefined) => bodyItems
    .filter((item) => item.groupId === groupId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((item) => item.markup)
    .join("");
  const ungroupedBody = renderGroupItems(undefined);
  const groupedBody = rig.groups
    .filter((group) => group.visible)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((group) => `<g class="render-group" data-render-group="${escapeXml(group.id)}">${renderGroupItems(group.id)}</g>`)
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
    return `<rect class="peer-pivot" x="${pivot.x - 6}" y="${pivot.y - 6}" width="12" height="12"
      data-peer-rotation data-peer-group-id="${escapeXml(group.id)}" />`;
  }).join("");

  const guides = rig.joints
    .filter((joint) => joint.guideVisible && isGroupVisible(rig, joint.groupId))
    .map((joint) => {
      const selectedJoint = selection.jointIds.includes(joint.id);
      const primaryJoint = selection.jointId === joint.id;
      const world = getJointWorldTransform(rig, joint.id);
      const axes = joint.axes
        .map((axis, axisIndex) => {
          const start = getAxisPoint(rig, joint, axis, -1);
          const end = getAxisPoint(rig, joint, axis, 1);
          const selectedAxis = primaryJoint && selection.axisId === axis.id;
          return `
            <g class="axis-guide axis-${axisIndex + 1}${selectedAxis ? " is-selected" : ""}">
              <line class="axis-hit" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"
                data-select-axis data-joint-id="${escapeXml(joint.id)}" data-axis-id="${escapeXml(axis.id)}" />
              <line class="axis-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />
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
              data-drag-joint data-joint-id="${escapeXml(joint.id)}" />
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
  if (selectedJoint && selectedAxis) {
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

  const waist = getJointWorldTransform(rig, "waist");
  const pelvisPivot = getJointWorldTransform(rig, "pelvis-pivot");
  const pelvisDx = pelvisPivot.x - waist.x;
  const pelvisDy = pelvisPivot.y - waist.y;
  const pelvisDistance = Math.hypot(pelvisDx, pelvisDy) || 1;
  const pelvisAngle = Math.atan2(pelvisDy, pelvisDx);
  const lowerBodyHandleAngle = pelvisAngle - 70 * Math.PI / 180;
  const lowerBodyHandleDistance = Math.max(120, pelvisDistance + 75);
  const lowerBodyHandleX = waist.x + Math.cos(lowerBodyHandleAngle) * lowerBodyHandleDistance;
  const lowerBodyHandleY = waist.y + Math.sin(lowerBodyHandleAngle) * lowerBodyHandleDistance;
  const lowerBodyRotationControl = isGroupVisible(rig, "torso")
    && (isGroupVisible(rig, "left-leg") || isGroupVisible(rig, "right-leg")) ? `
    <g class="lower-body-rotation-control">
      <line class="lower-body-rotation-guide" x1="${pelvisPivot.x}" y1="${pelvisPivot.y}" x2="${lowerBodyHandleX}" y2="${lowerBodyHandleY}" />
      <circle class="lower-body-rotation-handle" cx="${lowerBodyHandleX}" cy="${lowerBodyHandleY}" r="11"
        data-lower-body-rotation data-joint-id="pelvis-pivot" />
      <text class="lower-body-rotation-label" x="${lowerBodyHandleX + 16}" y="${lowerBodyHandleY + 4}">하체 회전</text>
    </g>` : "";

  host.innerHTML = `
    <defs data-export-defs>${jointOutlineMasks}</defs>
    <g data-layer="grid">
      ${[80, 200, 320, 440, 560, 680].map((y) => `<line x1="60" y1="${y}" x2="540" y2="${y}" />`).join("")}
      <line x1="300" y1="40" x2="300" y2="740" />
    </g>
    <g data-layer="body" class="${viewState.outlinesVisible ? "show-outlines" : ""}">
      <g class="render-group" data-render-group="default">${ungroupedBody}</g>
      ${groupedBody}
    </g>
    <g data-layer="editor-guides">${relationshipGuides}${peerLines}${guides}${rotationHandle}${selectionTransform}${peerHandles}${lowerBodyRotationControl}</g>`;
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

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}
