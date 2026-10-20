import type { RigState } from "../rig/rig-state.ts";
import { getAxisWorldAngle, getJointWorldTransform, getPeerGroupPivot } from "../rig/geometry.ts";
import type { EditorSelection } from "./types.ts";

interface PointerInputOptions {
  state: RigState;
  getSelection: () => EditorSelection;
  getPreserveProportions: () => boolean;
  getPaintColor: () => string | null;
  getLayerToolActive: () => boolean;
  setSelection: (selection: EditorSelection) => void;
  setSelectedFace: (faceId: string) => void;
}

export interface ViewportController {
  zoomBy(factor: number): void;
  resetView(): void;
  fitSelection(): void;
  setPanMode(enabled: boolean): void;
  destroy(): void;
}

type ViewBox = { x: number; y: number; width: number; height: number };
type Interaction =
  | { type: "pending-shift-joint"; jointId: string; jointIds: string[]; startX: number; startY: number; clientX: number; clientY: number }
  | { type: "move-selection"; jointIds: string[]; lastX: number; lastY: number }
  | { type: "move-joint-constrained"; jointId: string; parentX: number; parentY: number; length: number; angleOffset: number }
  | { type: "move-selection-constrained"; jointIds: string[]; parentX: number; parentY: number; pointerOffsetX: number; pointerOffsetY: number; lastAngle: number; lastX: number; lastY: number }
  | { type: "rotate-axis"; jointId: string; axisId: string; angleOffset: number }
  | { type: "rotate-child"; jointId: string; angleOffset: number }
  | { type: "rotate-peer"; peerGroupId: string; pivotX: number; pivotY: number; angleOffset: number }
  | { type: "rotate-selection"; jointIds: string[]; pivotX: number; pivotY: number; lastAngle: number }
  | { type: "pan"; startClientX: number; startClientY: number; viewBox: ViewBox }
  | { type: "marquee"; startX: number; startY: number; additive: boolean; rectangle: SVGRectElement };

const DEFAULT_VIEW_BOX: ViewBox = { x: 0, y: 0, width: 600, height: 780 };

export function enablePointerInput(
  element: SVGSVGElement,
  options: PointerInputOptions,
): ViewportController {
  let interaction: Interaction | null = null;
  let jointDrag: { jointId: string; jointIds: string[]; constrained: boolean; lastX: number; lastY: number } | null = null;
  let spacePressed = false;
  let panMode = false;

  const readViewBox = (): ViewBox => {
    const box = element.viewBox.baseVal;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const applyViewBox = (box: ViewBox) => {
    element.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  };
  const zoomAt = (factor: number, center?: { x: number; y: number }) => {
    const box = readViewBox();
    const nextWidth = Math.min(2400, Math.max(120, box.width * factor));
    const nextHeight = Math.min(3120, Math.max(156, box.height * factor));
    const anchor = center ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const ratioX = (anchor.x - box.x) / box.width;
    const ratioY = (anchor.y - box.y) / box.height;
    applyViewBox({
      x: anchor.x - nextWidth * ratioX,
      y: anchor.y - nextHeight * ratioY,
      width: nextWidth,
      height: nextHeight,
    });
  };

  const startJointMove = (jointId: string, jointIds: string[], point: { x: number; y: number }, constrained: boolean) => {
    const joint = options.state.getJoint(jointId);
    jointDrag = { jointId, jointIds, constrained, lastX: point.x, lastY: point.y };
    if (constrained && jointIds.length > 1 && jointIds.some((id) => options.state.getJoint(id).parentJointId)) {
      const reference = joint.parentJointId ? joint : options.state.getJoint(jointIds.find((id) => options.state.getJoint(id).parentJointId)!);
      const parent = getJointWorldTransform(options.state.rig, reference.parentJointId!);
      const current = getJointWorldTransform(options.state.rig, reference.id);
      const pointerOffsetX = reference.id === jointId ? 0 : current.x - point.x;
      const pointerOffsetY = reference.id === jointId ? 0 : current.y - point.y;
      interaction = {
        type: "move-selection-constrained", jointIds, parentX: parent.x, parentY: parent.y,
        pointerOffsetX, pointerOffsetY,
        lastAngle: getAngle(parent.x, parent.y, point.x + pointerOffsetX, point.y + pointerOffsetY),
        lastX: point.x, lastY: point.y,
      };
    } else if (constrained && jointIds.length === 1 && joint.parentJointId) {
      const parent = getJointWorldTransform(options.state.rig, joint.parentJointId);
      const current = getJointWorldTransform(options.state.rig, jointId);
      interaction = {
        type: "move-joint-constrained", jointId, parentX: parent.x, parentY: parent.y,
        length: Math.hypot(current.x - parent.x, current.y - parent.y),
        angleOffset: getAngle(parent.x, parent.y, current.x, current.y) - getAngle(parent.x, parent.y, point.x, point.y),
      };
    } else {
      interaction = { type: "move-selection", jointIds, lastX: point.x, lastY: point.y };
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1 && !(event.button === 2 && options.getLayerToolActive())) return;
    const target = event.target as SVGElement;
    const point = toSvgPoint(element, event);
    const jointId = target.dataset.jointId;
    const axisId = target.dataset.axisId;
    const faceId = target.dataset.faceId;
    const peerGroupId = target.dataset.peerGroupId;

    if (event.button === 1 || (event.button === 0 && (spacePressed || panMode))) {
      interaction = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        viewBox: readViewBox(),
      };
    } else if (options.getLayerToolActive()) {
      const direction = event.button === 2 ? -1 : 1;
      if (jointId && (target.hasAttribute("data-drag-joint") || target.hasAttribute("data-body-joint"))) {
        const joint = options.state.getJoint(jointId);
        if (joint.bodyVisible && !joint.isVirtual) {
          options.setSelection({ jointId, axisId: joint.axes[0]?.id ?? null, jointIds: [jointId] });
          options.state.moveBodyItemInStack("joint", jointId, direction, event.shiftKey);
        }
      } else if (faceId) {
        options.setSelectedFace(faceId);
        options.state.moveBodyItemInStack("face", faceId, direction, event.shiftKey);
      }
      event.preventDefault();
      return;
    } else if (target.hasAttribute("data-drag-joint") && jointId && options.getPaintColor()) {
      const joint = options.state.getJoint(jointId);
      if (joint.bodyVisible && !joint.isVirtual) {
        options.state.paintJointWithColor(jointId, options.getPaintColor()!);
      }
    } else if (target.hasAttribute("data-selection-rotation")) {
      const selected = options.getSelection().jointIds;
      const pivotX = Number(target.dataset.pivotX);
      const pivotY = Number(target.dataset.pivotY);
      interaction = {
        type: "rotate-selection",
        jointIds: selected,
        pivotX,
        pivotY,
        lastAngle: getAngle(pivotX, pivotY, point.x, point.y),
      };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-rotation-handle") && jointId && axisId) {
      const joint = options.state.getJoint(jointId);
      const axis = joint.axes.find((candidate) => candidate.id === axisId);
      if (!axis) return;
      const world = getJointWorldTransform(options.state.rig, jointId);
      const pointerAngle = getAngle(world.x, world.y, point.x, point.y);
      interaction = {
        type: "rotate-axis",
        jointId,
        axisId,
        angleOffset: getAxisWorldAngle(options.state.rig, joint, axis) - pointerAngle,
      };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-child-rotation") && jointId) {
      interaction = { type: "rotate-child", jointId, angleOffset: 0 };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-peer-rotation") && peerGroupId) {
      const group = options.state.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
      if (!group?.jointIds.length) return;
      const pivot = getPeerGroupPivot(options.state.rig, peerGroupId);
      const reference = getJointWorldTransform(options.state.rig, group.jointIds[0]);
      interaction = {
        type: "rotate-peer", peerGroupId, pivotX: pivot.x, pivotY: pivot.y,
        angleOffset: getAngle(pivot.x, pivot.y, reference.x, reference.y) - getAngle(pivot.x, pivot.y, point.x, point.y),
      };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-select-axis") && jointId && axisId && !event.shiftKey) {
      options.setSelection({ jointId, axisId, jointIds: [jointId] });
    } else if ((target.hasAttribute("data-drag-joint") || (event.shiftKey && target.hasAttribute("data-select-axis"))) && jointId) {
      const joint = options.state.getJoint(jointId);
      const previous = options.getSelection();
      const selected = new Set(previous.jointIds);
      if (event.shiftKey && selected.has(jointId)) {
        interaction = { type: "pending-shift-joint", jointId, jointIds: [...selected], startX: point.x, startY: point.y,
          clientX: event.clientX, clientY: event.clientY };
      } else {
        if (!event.shiftKey && !selected.has(jointId)) selected.clear();
        selected.add(jointId);
        const jointIds = [...selected];
        options.setSelection({
          jointId,
          axisId: axisId ?? (previous.jointId === jointId ? previous.axisId : joint.axes[0]?.id ?? null),
          jointIds,
        });
        startJointMove(jointId, jointIds, point, options.getPreserveProportions() || event.altKey);
        options.state.beginHistoryTransaction();
      }
    } else if (faceId && options.getPaintColor()) {
      options.setSelectedFace(faceId);
      options.state.paintFaceWithColor(faceId, options.getPaintColor()!);
    } else if (faceId) {
      options.setSelectedFace(faceId);
      if (event.shiftKey) {
        const selected = new Set(options.getSelection().jointIds);
        for (const vertex of options.state.getFace(faceId).vertices) selected.add(vertex.jointId);
        const jointIds = [...selected];
        const primaryId = jointIds.at(-1) ?? null;
        options.setSelection({
          jointId: primaryId,
          axisId: primaryId ? options.state.getJoint(primaryId).axes[0]?.id ?? null : null,
          jointIds,
        });
      }
    } else {
      const rectangle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rectangle.setAttribute("class", "selection-marquee");
      rectangle.setAttribute("x", String(point.x));
      rectangle.setAttribute("y", String(point.y));
      rectangle.setAttribute("width", "0");
      rectangle.setAttribute("height", "0");
      element.append(rectangle);
      interaction = { type: "marquee", startX: point.x, startY: point.y, additive: event.shiftKey, rectangle };
    }

    if (interaction) {
      event.preventDefault();
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endInteraction, { once: true });
      window.addEventListener("pointercancel", endInteraction, { once: true });
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!interaction) return;
    if (interaction.type === "pending-shift-joint") {
      if (Math.hypot(event.clientX - interaction.clientX, event.clientY - interaction.clientY) < 3) return;
      const { jointId, jointIds, startX, startY } = interaction;
      const previous = options.getSelection();
      const joint = options.state.getJoint(jointId);
      options.setSelection({ jointId, jointIds, axisId: previous.jointId === jointId ? previous.axisId : joint.axes[0]?.id ?? null });
      startJointMove(jointId, jointIds, { x: startX, y: startY }, options.getPreserveProportions() || event.altKey);
      options.state.beginHistoryTransaction();
    }
    if (interaction.type === "pan") {
      const bounds = element.getBoundingClientRect();
      const dx = (event.clientX - interaction.startClientX) * interaction.viewBox.width / bounds.width;
      const dy = (event.clientY - interaction.startClientY) * interaction.viewBox.height / bounds.height;
      applyViewBox({ ...interaction.viewBox, x: interaction.viewBox.x - dx, y: interaction.viewBox.y - dy });
      return;
    }

    const point = toSvgPoint(element, event);
    if (jointDrag && jointDrag.constrained !== (options.getPreserveProportions() || event.altKey)) {
      startJointMove(jointDrag.jointId, jointDrag.jointIds, { x: jointDrag.lastX, y: jointDrag.lastY }, options.getPreserveProportions() || event.altKey);
    }
    if (interaction.type === "move-selection") {
      options.state.moveJointsBy(interaction.jointIds, point.x - interaction.lastX, point.y - interaction.lastY);
      interaction.lastX = point.x;
      interaction.lastY = point.y;
    } else if (interaction.type === "move-selection-constrained") {
      const angle = getAngle(interaction.parentX, interaction.parentY,
        point.x + interaction.pointerOffsetX, point.y + interaction.pointerOffsetY);
      const delta = ((angle - interaction.lastAngle + 540) % 360) - 180;
      options.state.moveJointsConstrainedBy(interaction.jointIds, delta, point.x - interaction.lastX, point.y - interaction.lastY);
      interaction.lastAngle = angle;
      interaction.lastX = point.x;
      interaction.lastY = point.y;
    } else if (interaction.type === "move-joint-constrained") {
      const angle = (getAngle(interaction.parentX, interaction.parentY, point.x, point.y)
        + interaction.angleOffset) * Math.PI / 180;
      options.state.moveJoint(
        interaction.jointId,
        interaction.parentX + Math.cos(angle) * interaction.length,
        interaction.parentY + Math.sin(angle) * interaction.length,
      );
    } else if (interaction.type === "rotate-axis") {
      const joint = options.state.getJoint(interaction.jointId);
      const world = getJointWorldTransform(options.state.rig, joint.id);
      const pointerAngle = getAngle(world.x, world.y, point.x, point.y);
      options.state.setAxisAngle(interaction.jointId, interaction.axisId, pointerAngle + interaction.angleOffset);
    } else if (interaction.type === "rotate-child") {
      const joint = options.state.getJoint(interaction.jointId);
      if (!joint.parentJointId) return;
      const parent = getJointWorldTransform(options.state.rig, joint.parentJointId);
      options.state.rotateChildAroundParent(
        interaction.jointId,
        getAngle(parent.x, parent.y, point.x, point.y) + interaction.angleOffset,
      );
    } else if (interaction.type === "rotate-peer") {
      if (Math.hypot(point.x - interaction.pivotX, point.y - interaction.pivotY) < 12) return;
      options.state.rotatePeerGroup(interaction.peerGroupId,
        getAngle(interaction.pivotX, interaction.pivotY, point.x, point.y) + interaction.angleOffset);
    } else if (interaction.type === "rotate-selection") {
      const angle = getAngle(interaction.pivotX, interaction.pivotY, point.x, point.y);
      let delta = angle - interaction.lastAngle;
      if (event.shiftKey) delta = Math.round(delta / 15) * 15;
      options.state.rotateJointsAround(interaction.jointIds, interaction.pivotX, interaction.pivotY, delta);
      interaction.lastAngle = angle;
    } else if (interaction.type === "marquee") {
      const x = Math.min(interaction.startX, point.x);
      const y = Math.min(interaction.startY, point.y);
      interaction.rectangle.setAttribute("x", String(x));
      interaction.rectangle.setAttribute("y", String(y));
      interaction.rectangle.setAttribute("width", String(Math.abs(point.x - interaction.startX)));
      interaction.rectangle.setAttribute("height", String(Math.abs(point.y - interaction.startY)));
    }
    if (jointDrag) { jointDrag.lastX = point.x; jointDrag.lastY = point.y; }
  };

  const endInteraction = (event?: PointerEvent) => {
    if (!interaction) return;
    if (interaction.type === "pending-shift-joint") {
      if (event?.type === "pointerup") {
        const removedId = interaction.jointId;
        const jointIds = interaction.jointIds.filter((id) => id !== removedId);
        const jointId = jointIds.at(-1) ?? null;
        options.setSelection({ jointId, jointIds, axisId: jointId ? options.state.getJoint(jointId).axes[0]?.id ?? null : null });
      }
    } else if (interaction.type === "marquee") {
      const point = event ? toSvgPoint(element, event) : { x: interaction.startX, y: interaction.startY };
      const left = Math.min(interaction.startX, point.x);
      const right = Math.max(interaction.startX, point.x);
      const top = Math.min(interaction.startY, point.y);
      const bottom = Math.max(interaction.startY, point.y);
      const selected = interaction.additive ? new Set(options.getSelection().jointIds) : new Set<string>();
      for (const joint of options.state.rig.joints) {
        if (joint.isVirtual || !joint.guideVisible) continue;
        const world = getJointWorldTransform(options.state.rig, joint.id);
        if (world.x >= left && world.x <= right && world.y >= top && world.y <= bottom) selected.add(joint.id);
      }
      interaction.rectangle.remove();
      const jointIds = [...selected];
      const jointId = jointIds.at(-1) ?? null;
      const axisId = jointId ? options.state.getJoint(jointId).axes[0]?.id ?? null : null;
      options.setSelection({ jointId, axisId, jointIds });
    } else if (interaction.type !== "pan") {
      options.state.endHistoryTransaction();
    }
    interaction = null;
    jointDrag = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endInteraction);
    window.removeEventListener("pointercancel", endInteraction);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 1.12 : 0.89, toSvgPoint(element, event));
  };
  const onContextMenu = (event: MouseEvent) => {
    if (options.getLayerToolActive()) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    const editingOrDialog = target instanceof HTMLElement
      && (target.matches("input, select, textarea, button, [contenteditable='true']") || !!target.closest("dialog"));
    if (event.code === "Space" && !editingOrDialog) {
      spacePressed = true;
      element.classList.add("is-pannable");
      event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") {
      spacePressed = false;
      element.classList.remove("is-pannable");
    }
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("contextmenu", onContextMenu);
  element.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    zoomBy: (factor) => zoomAt(factor),
    resetView: () => applyViewBox(DEFAULT_VIEW_BOX),
    fitSelection: () => {
      const selected = options.getSelection().jointIds;
      if (selected.length === 0) return applyViewBox(DEFAULT_VIEW_BOX);
      const points = selected.map((jointId) => {
        const joint = options.state.getJoint(jointId);
        return { ...getJointWorldTransform(options.state.rig, jointId), radius: joint.radius };
      });
      const left = Math.min(...points.map((point) => point.x - point.radius)) - 50;
      const right = Math.max(...points.map((point) => point.x + point.radius)) + 50;
      const top = Math.min(...points.map((point) => point.y - point.radius)) - 50;
      const bottom = Math.max(...points.map((point) => point.y + point.radius)) + 50;
      const bounds = element.getBoundingClientRect();
      let width = Math.max(120, right - left);
      let height = Math.max(156, bottom - top);
      const aspect = bounds.width / bounds.height;
      if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
      applyViewBox({ x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height });
    },
    setPanMode: (enabled) => {
      panMode = enabled;
      element.classList.toggle("is-pan-mode", enabled);
    },
    destroy: () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("contextmenu", onContextMenu);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      endInteraction();
    },
  };
}

function toSvgPoint(element: SVGSVGElement, event: MouseEvent | PointerEvent | WheelEvent) {
  const point = element.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = element.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : point;
}

function getAngle(centerX: number, centerY: number, x: number, y: number): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}
