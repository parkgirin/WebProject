import type { Rig } from "../rig/types";
import { getAxisPoint, getAxisWorldAngle, getFacePoints, getJointWorldTransform, getPeerGroupPivot } from "../rig/geometry";
import type { EditorSelection, EditorViewState } from "./types";
import referenceImageUrl from "../../Grid_Img.svg";

export function renderSvgEditor(
  host: SVGSVGElement,
  rig: Rig,
  selection: EditorSelection,
  viewState: EditorViewState,
): void {
  const jointItems = rig.joints
    .filter((joint) => joint.bodyVisible)
    .map((joint) => {
      const world = getJointWorldTransform(rig, joint.id);
      return {
        id: joint.id,
        order: joint.renderOrder,
        markup: `<circle class="body-joint" cx="${world.x}" cy="${world.y}" r="${joint.bodyRadius ?? joint.radius}" fill="${escapeXml(rig.defaultColor)}" />`,
      };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const faceItems = rig.faces
    .map((face) => ({
      id: face.id,
      order: getFaceOrder(rig, face),
      markup: `<polygon class="body-face${face.id === viewState.selectedFaceId ? " is-selected" : ""}" data-face-id="${escapeXml(face.id)}" points="${getFacePoints(rig, face)
        .map((point) => `${point.x},${point.y}`)
        .join(" ")}" fill="${escapeXml(face.color ?? rig.defaultColor)}" />`,
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const relationshipGuides = rig.joints
    .filter((joint) => joint.guideVisible && joint.parentJointId)
    .map((joint) => {
      const parent = getJointWorldTransform(rig, joint.parentJointId!);
      const child = getJointWorldTransform(rig, joint.id);
      return `<line class="hierarchy-line" x1="${parent.x}" y1="${parent.y}" x2="${child.x}" y2="${child.y}"
        data-child-rotation data-joint-id="${escapeXml(joint.id)}" />`;
    })
    .join("");
  const peerLines = rig.peerGroups.map((group) => {
    const pivot = getPeerGroupPivot(rig, group.id);
    return group.jointIds.map((jointId) => {
      const point = getJointWorldTransform(rig, jointId);
      return `<line class="peer-line" x1="${pivot.x}" y1="${pivot.y}" x2="${point.x}" y2="${point.y}" />`;
    }).join("");
  }).join("");
  const peerHandles = rig.peerGroups.map((group) => {
    const pivot = getPeerGroupPivot(rig, group.id);
    return `<rect class="peer-pivot" x="${pivot.x - 6}" y="${pivot.y - 6}" width="12" height="12"
      data-peer-rotation data-peer-group-id="${escapeXml(group.id)}" />`;
  }).join("");

  const guides = rig.joints
    .filter((joint) => joint.guideVisible)
    .map((joint) => {
      const selectedJoint = selection.jointId === joint.id;
      const world = getJointWorldTransform(rig, joint.id);
      const axes = joint.axes
        .map((axis, axisIndex) => {
          const start = getAxisPoint(rig, joint, axis, -1);
          const end = getAxisPoint(rig, joint, axis, 1);
          const selectedAxis = selectedJoint && selection.axisId === axis.id;
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
        <g class="joint-guide${selectedJoint ? " is-selected" : ""}">
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

  host.innerHTML = `
    <g data-layer="grid">
      ${[80, 200, 320, 440, 560, 680].map((y) => `<line x1="60" y1="${y}" x2="540" y2="${y}" />`).join("")}
      <line x1="300" y1="40" x2="300" y2="740" />
    </g>
    <g data-layer="reference" pointer-events="none">
      <image href="${escapeXml(referenceImageUrl)}" x="150" y="80" width="300" height="600" opacity="0.22" preserveAspectRatio="xMidYMid meet" />
    </g>
    <g data-layer="body" class="${viewState.outlinesVisible ? "show-outlines" : ""}">
      <g data-body-part="joints">${jointItems.map((item) => item.markup).join("")}</g>
      <g data-body-part="faces">${faceItems.map((item) => item.markup).join("")}</g>
    </g>
    <g data-layer="editor-guides">${relationshipGuides}${peerLines}${guides}${rotationHandle}${peerHandles}</g>`;
}

function getFaceOrder(rig: Rig, face: Rig["faces"][number]): number {
  const ids = [...new Set(face.vertices.map((vertex) => vertex.jointId))];
  const total = ids.reduce(
    (sum, id) => sum + (rig.joints.find((joint) => joint.id === id)?.renderOrder ?? 0),
    0,
  );
  return total / Math.max(ids.length, 1) + face.orderOffset;
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
