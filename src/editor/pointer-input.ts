import type { PolygonDraftPoint, RigState } from "../rig/rig-state.ts";
import { getArtShapeVertexPoint, getAxisPoint, getCameraZ, getJointParentWorldTransform, getJointWorldTransform, getPeerGroupPivot, getProjectionScale, projectPoint, unprojectPoint } from "../rig/geometry.ts";
import type { EditorSelection } from "./types.ts";

interface PointerInputOptions {
  state: RigState;
  getSelection: () => EditorSelection;
  getEditBodyProportions: () => boolean;
  getMoveSelectedIndividually?: () => boolean;
  getPaintColor: () => string | null;
  getLayerToolActive: () => boolean;
  getPolygonToolActive?: () => boolean;
  getCircleToolActive?: () => boolean;
  getSphereToolActive?: () => boolean;
  getLineToolActive?: () => boolean;
  getVertexAddToolActive?: () => boolean;
  getVertexBindToolActive?: () => boolean;
  addPolygonPoint?: (point: PolygonDraftPoint) => void;
  addLinePoint?: (point: PolygonDraftPoint) => void;
  finishPolygon?: () => void;
  cancelPolygon?: () => void;
  removeLastPolygonPoint?: () => void;
  addCircle?: (point: { x: number; y: number }) => void;
  addSphere?: (point: { x: number; y: number }) => void;
  cancelLine?: () => void;
  removeLastLinePoint?: () => void;
  insertShapeVertex?: (shapeId: string, afterVertexId: string, point: { x: number; y: number }) => void;
  bindSelectedShapeVertex?: (jointId: string, axisId: string, side: -1 | 1, snap: boolean) => void;
  deleteSelectedShapeVertex?: () => boolean;
  getSelectedShapeIds?: () => string[];
  duplicateSelectedShapes?: (clickedShapeId: string) => string[];
  setSelection: (selection: EditorSelection) => void;
  setSelectedFace: (faceId: string) => void;
  setSelectedShape?: (shapeId: string, vertexId?: string, additive?: boolean) => void;
  setSelectedShapes?: (shapeIds: string[]) => void;
}

export interface ViewportController {
  zoomBy(factor: number): void;
  resetView(): void;
  fitSelection(): void;
  setScreenMode(enabled: boolean): void;
  destroy(): void;
}

type ViewBox = { x: number; y: number; width: number; height: number };
type Interaction =
  | { type: "pending-shift-joint"; jointId: string; jointIds: string[]; startX: number; startY: number; clientX: number; clientY: number }
  | { type: "move-selection"; jointIds: string[]; lastX: number; lastY: number }
  | { type: "move-joint-constrained"; jointId: string; parentX: number; parentY: number; lastAngle: number }
  | { type: "move-selection-constrained"; jointIds: string[]; parentX: number; parentY: number; pointerOffsetX: number; pointerOffsetY: number; lastAngle: number; lastX: number; lastY: number }
  | { type: "rotate-axis"; jointId: string; axisId: string; lastAngle: number }
  | { type: "rotate-child"; jointId: string; lastAngle: number }
  | { type: "rotate-peer"; peerGroupId: string; pivotX: number; pivotY: number; lastAngle: number }
  | { type: "rotate-selection"; jointIds: string[]; pivotX: number; pivotY: number; lastAngle: number }
  | { type: "pending-shift-shape"; shapeId: string; wasSelected: boolean; startX: number; startY: number; clientX: number; clientY: number }
  | { type: "move-shapes"; shapeIds: string[]; startX: number; startY: number; appliedX: number; appliedY: number; axis: "x" | "y" | null; constrained: boolean }
  | { type: "move-shape-vertex"; shapeId: string; vertexId: string }
  | { type: "move-joint-z"; jointId: string; startClientY: number; startZ: number }
  | { type: "rotate-view"; startClientX: number; startClientY: number; startWorldX: number; startWorldY: number; startWorldZ: number; axis: "x" | "y" | "z" | null; free?: boolean }
  | { type: "pan"; startClientX: number; startClientY: number; viewBox: ViewBox }
  | { type: "marquee"; startX: number; startY: number; additive: boolean; rectangle: SVGRectElement };

const DEFAULT_VIEW_BOX: ViewBox = { x: 0, y: 0, width: 600, height: 780 };

export function enablePointerInput(
  element: SVGSVGElement,
  options: PointerInputOptions,
): ViewportController {
  let interaction: Interaction | null = null;
  let jointDrag: {
    jointId: string;
    jointIds: string[];
    constrained: boolean;
    lastX: number;
    lastY: number;
    axisLocked: boolean;
    startX: number;
    startY: number;
    axis: "x" | "y" | null;
  } | null = null;
  let spacePressed = false;
  let screenMode = false;
  let interactionDepth = 0;
  const screenTouches = new Map<number, { x: number; y: number }>();
  let screenGesture:
    | { type: "rotate"; pointerId: number; startX: number; startY: number; worldX: number; worldY: number }
    | { type: "transform"; pointerIds: [number, number]; centroidX: number; centroidY: number; distance: number; angle: number; viewBox: ViewBox; worldZ: number }
    | null = null;
  const shouldConstrainJointDistance = (altKey: boolean) => !(options.getEditBodyProportions() || altKey);

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

  const beginScreenGesture = () => {
    const touches = [...screenTouches.entries()];
    if (touches.length === 1) {
      const [pointerId, point] = touches[0];
      screenGesture = { type: "rotate", pointerId, startX: point.x, startY: point.y,
        worldX: options.state.getGlobalAxisRotation("x"), worldY: options.state.getGlobalAxisRotation("y") };
      return;
    }
    if (touches.length >= 2) {
      const [[firstId, first], [secondId, second]] = touches;
      screenGesture = {
        type: "transform", pointerIds: [firstId, secondId],
        centroidX: (first.x + second.x) / 2, centroidY: (first.y + second.y) / 2,
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        angle: Math.atan2(second.y - first.y, second.x - first.x),
        viewBox: readViewBox(), worldZ: options.state.getGlobalAxisRotation("z"),
      };
    }
  };

  const onScreenTouchMove = (event: PointerEvent) => {
    if (!screenMode || event.pointerType !== "touch" || !screenTouches.has(event.pointerId)) return;
    screenTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!screenGesture) beginScreenGesture();
    if (screenGesture?.type === "rotate") {
      const point = screenTouches.get(screenGesture.pointerId);
      if (!point) return;
      options.state.setGlobalAxisRotation("x", screenGesture.worldX - (point.y - screenGesture.startY) * 0.5);
      options.state.setGlobalAxisRotation("y", screenGesture.worldY + (point.x - screenGesture.startX) * 0.5);
    } else if (screenGesture?.type === "transform") {
      const [firstId, secondId] = screenGesture.pointerIds;
      const first = screenTouches.get(firstId);
      const second = screenTouches.get(secondId);
      if (!first || !second) return;
      const bounds = element.getBoundingClientRect();
      const centroidX = (first.x + second.x) / 2;
      const centroidY = (first.y + second.y) / 2;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const requestedScale = screenGesture.distance / distance;
      const minimumScale = Math.max(120 / screenGesture.viewBox.width, 156 / screenGesture.viewBox.height);
      const maximumScale = Math.min(2400 / screenGesture.viewBox.width, 3120 / screenGesture.viewBox.height);
      const scale = Math.min(maximumScale, Math.max(minimumScale, requestedScale));
      const width = screenGesture.viewBox.width * scale;
      const height = screenGesture.viewBox.height * scale;
      const anchorX = screenGesture.viewBox.x + (screenGesture.centroidX - bounds.left) / bounds.width * screenGesture.viewBox.width;
      const anchorY = screenGesture.viewBox.y + (screenGesture.centroidY - bounds.top) / bounds.height * screenGesture.viewBox.height;
      applyViewBox({
        x: anchorX - (centroidX - bounds.left) / bounds.width * width,
        y: anchorY - (centroidY - bounds.top) / bounds.height * height,
        width, height,
      });
      const angle = Math.atan2(second.y - first.y, second.x - first.x);
      options.state.setGlobalAxisRotation("z", screenGesture.worldZ + (angle - screenGesture.angle) * 180 / Math.PI);
    }
    event.preventDefault();
  };

  const onScreenTouchEnd = (event: PointerEvent) => {
    if (!screenTouches.delete(event.pointerId)) return;
    if (screenTouches.size) beginScreenGesture();
    else {
      screenGesture = null;
      options.state.endHistoryTransaction();
    }
  };

  const startJointMove = (
    jointId: string,
    jointIds: string[],
    point: { x: number; y: number },
    constrained: boolean,
    axisLocked = false,
    previousAxisLock?: Pick<NonNullable<typeof jointDrag>, "axisLocked" | "startX" | "startY" | "axis">,
  ) => {
    const joint = options.state.getJoint(jointId);
    jointDrag = {
      jointId,
      jointIds,
      constrained,
      lastX: point.x,
      lastY: point.y,
      axisLocked: previousAxisLock?.axisLocked ?? axisLocked,
      startX: previousAxisLock?.startX ?? point.x,
      startY: previousAxisLock?.startY ?? point.y,
      axis: previousAxisLock?.axis ?? null,
    };
    if (constrained && jointIds.length > 1 && jointIds.some((id) => options.state.getJoint(id).parentJointId)) {
      const reference = joint.parentJointId ? joint : options.state.getJoint(jointIds.find((id) => options.state.getJoint(id).parentJointId)!);
      const parentModel = getJointParentWorldTransform(options.state.rig, reference.id)!;
      const parent = projectPoint(options.state.rig, parentModel, options.state.getJoint(reference.parentJointId!).z);
      const currentModel = getJointWorldTransform(options.state.rig, reference.id);
      const current = projectPoint(options.state.rig, currentModel, reference.z);
      const pointerOffsetX = reference.id === jointId ? 0 : current.x - point.x;
      const pointerOffsetY = reference.id === jointId ? 0 : current.y - point.y;
      interaction = {
        type: "move-selection-constrained", jointIds, parentX: parent.x, parentY: parent.y,
        pointerOffsetX, pointerOffsetY,
        lastAngle: getAngle(parent.x, parent.y, point.x + pointerOffsetX, point.y + pointerOffsetY),
        lastX: point.x, lastY: point.y,
      };
    } else if (constrained && jointIds.length === 1 && joint.parentJointId) {
      const parentModel = getJointParentWorldTransform(options.state.rig, joint.id)!;
      const parent = projectPoint(options.state.rig, parentModel, options.state.getJoint(joint.parentJointId!).z);
      interaction = {
        type: "move-joint-constrained", jointId, parentX: parent.x, parentY: parent.y,
        lastAngle: getAngle(parent.x, parent.y, point.x, point.y),
      };
    } else {
      interaction = { type: "move-selection", jointIds, lastX: point.x, lastY: point.y };
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    if (screenMode && event.pointerType === "touch" && event.button === 0) {
      if (screenTouches.size === 0) options.state.beginHistoryTransaction();
      screenTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      element.setPointerCapture?.(event.pointerId);
      beginScreenGesture();
      event.preventDefault();
      return;
    }
    const target = event.target as SVGElement;
    const jointId = target.dataset.jointId;
    const axisId = target.dataset.axisId;
    const faceId = target.dataset.faceId;
    const shapeId = target.dataset.shapeId;
    const vertexId = target.dataset.vertexId;
    const afterVertexId = target.dataset.afterVertexId;
    const peerGroupId = target.dataset.peerGroupId;
    interactionDepth = jointId ? options.state.getJoint(jointId).z ?? 0
      : peerGroupId
        ? getPeerDepth(options.state.rig, peerGroupId)
        : shapeId
          ? getShapeDepth(options.state.rig, shapeId, vertexId)
        : faceId
          ? getFaceDepth(options.state.rig, faceId)
          : 0;
    const screenPoint = toSvgPoint(element, event);
    const point = toSvgPoint(element, event, options.state.rig, interactionDepth);

    if (event.button === 2 && !options.getLayerToolActive()) {
      interaction = { type: "rotate-view", startClientX: event.clientX, startClientY: event.clientY, startWorldX: options.state.getGlobalAxisRotation("x"), startWorldY: options.state.getGlobalAxisRotation("y"), startWorldZ: options.state.getGlobalAxisRotation("z"), axis: event.altKey ? "z" : null };
      options.state.beginHistoryTransaction();
    } else if (event.button === 0 && screenMode) {
      interaction = { type: "rotate-view", startClientX: event.clientX, startClientY: event.clientY,
        startWorldX: options.state.getGlobalAxisRotation("x"), startWorldY: options.state.getGlobalAxisRotation("y"),
        startWorldZ: options.state.getGlobalAxisRotation("z"), axis: null, free: true };
      options.state.beginHistoryTransaction();
    } else if (event.button === 0 && options.getPolygonToolActive?.() && !spacePressed && !screenMode) {
      if (target.hasAttribute("data-polygon-draft-start")) options.finishPolygon?.();
      else {
        const side = Number(target.dataset.axisSide);
        options.addPolygonPoint?.({
          x: point.x,
          y: point.y,
          ...(target.hasAttribute("data-axis-point") && jointId && axisId && (side === -1 || side === 1)
            ? { axisPoint: { jointId, axisId, side: side as -1 | 1 } } : {}),
        });
      }
      event.preventDefault();
      return;
    } else if (event.button === 0 && options.getCircleToolActive?.() && !spacePressed && !screenMode) {
      options.addCircle?.(point);
      event.preventDefault();
      return;
    } else if (event.button === 0 && options.getSphereToolActive?.() && !spacePressed && !screenMode) {
      options.addSphere?.(point);
      event.preventDefault();
      return;
    } else if (event.button === 0 && options.getLineToolActive?.() && !spacePressed && !screenMode) {
      const side = Number(target.dataset.axisSide);
      options.addLinePoint?.({
        x: point.x,
        y: point.y,
        ...(target.hasAttribute("data-axis-point") && jointId && axisId && (side === -1 || side === 1)
          ? { axisPoint: { jointId, axisId, side: side as -1 | 1 } } : {}),
      });
      event.preventDefault();
      return;
    } else if (event.button === 0 && options.getVertexAddToolActive?.() && !spacePressed && !screenMode) {
      if (shapeId && afterVertexId && target.hasAttribute("data-shape-edge")) {
        options.insertShapeVertex?.(shapeId, afterVertexId, point);
      } else if (shapeId) options.setSelectedShape?.(shapeId, vertexId);
      event.preventDefault();
      return;
    } else if (event.button === 0 && options.getVertexBindToolActive?.() && !spacePressed && !screenMode) {
      if (shapeId && vertexId && target.hasAttribute("data-shape-vertex")) {
        options.setSelectedShape?.(shapeId, vertexId);
      } else if (shapeId) {
        options.setSelectedShape?.(shapeId);
      } else {
        const side = Number(target.dataset.axisSide);
        if (target.hasAttribute("data-axis-point") && jointId && axisId && (side === -1 || side === 1)) {
          options.bindSelectedShapeVertex?.(jointId, axisId, side as -1 | 1, event.altKey);
        }
      }
      event.preventDefault();
      return;
    } else if (event.button === 1 && jointId && (target.hasAttribute("data-drag-joint") || target.hasAttribute("data-body-joint"))) {
      const joint = options.state.getJoint(jointId);
      if (!joint.isVirtual) {
        options.setSelection({ jointId, axisId: joint.axes[0]?.id ?? null, jointIds: [jointId] });
        interaction = { type: "move-joint-z", jointId, startClientY: event.clientY, startZ: joint.z };
        options.state.beginHistoryTransaction();
      }
    } else if (event.button === 1 || (event.button === 0 && spacePressed)) {
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
      } else if (shapeId) {
        options.setSelectedShape?.(shapeId, vertexId);
        options.state.moveBodyItemInStack("shape", shapeId, direction, event.shiftKey);
      }
      event.preventDefault();
      return;
    } else if (target.hasAttribute("data-drag-joint") && jointId && options.getPaintColor()) {
      const joint = options.state.getJoint(jointId);
      if (joint.bodyVisible && !joint.isVirtual) {
        options.state.paintJointWithColor(jointId, options.getPaintColor()!);
      }
    } else if (shapeId && vertexId && target.hasAttribute("data-shape-vertex")) {
      options.setSelectedShape?.(shapeId, vertexId);
      interaction = { type: "move-shape-vertex", shapeId, vertexId };
      options.state.beginHistoryTransaction();
    } else if (shapeId && options.getPaintColor()) {
      options.setSelectedShape?.(shapeId);
      options.state.paintArtShapeWithColor(shapeId, options.getPaintColor()!);
    } else if (shapeId) {
      const currentShapeIds = options.getSelectedShapeIds?.() ?? [];
      const wasSelected = currentShapeIds.includes(shapeId);
      if (event.shiftKey && !event.altKey) {
        interaction = { type: "pending-shift-shape", shapeId, wasSelected, startX: point.x, startY: point.y,
          clientX: event.clientX, clientY: event.clientY };
      } else {
        if (!wasSelected) options.setSelectedShape?.(shapeId);
        let shapeIds = options.getSelectedShapeIds?.() ?? [shapeId];
        options.state.beginHistoryTransaction();
        if (event.altKey) shapeIds = options.duplicateSelectedShapes?.(shapeId) ?? shapeIds;
        interaction = { type: "move-shapes", shapeIds, startX: point.x, startY: point.y,
          appliedX: point.x, appliedY: point.y, axis: null, constrained: event.shiftKey };
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
        lastAngle: getAngle(pivotX, pivotY, screenPoint.x, screenPoint.y),
      };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-rotation-handle") && jointId && axisId) {
      const joint = options.state.getJoint(jointId);
      const axis = joint.axes.find((candidate) => candidate.id === axisId);
      if (!axis) return;
      const first = getAxisPoint(options.state.rig, joint, axis, -1);
      const second = getAxisPoint(options.state.rig, joint, axis, 1);
      const firstScreen = projectPoint(options.state.rig, first, joint.z);
      const secondScreen = projectPoint(options.state.rig, second, joint.z);
      const world = { x: (firstScreen.x + secondScreen.x) / 2, y: (firstScreen.y + secondScreen.y) / 2 };
      interaction = {
        type: "rotate-axis",
        jointId,
        axisId,
        lastAngle: getAngle(world.x, world.y, screenPoint.x, screenPoint.y),
      };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-child-rotation") && jointId) {
      const joint = options.state.getJoint(jointId);
      if (!joint.parentJointId) return;
      const parentModel = getJointParentWorldTransform(options.state.rig, joint.id);
      if (!parentModel) return;
      const parent = projectPoint(options.state.rig, parentModel, options.state.getJoint(joint.parentJointId).z);
      interaction = { type: "rotate-child", jointId, lastAngle: getAngle(parent.x, parent.y, screenPoint.x, screenPoint.y) };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-peer-rotation") && peerGroupId) {
      const group = options.state.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
      if (!group?.jointIds.length) return;
      const pivotModel = getPeerGroupPivot(options.state.rig, peerGroupId);
      const pivotDepth = group.jointIds.reduce((sum, id) => sum + options.state.getJoint(id).z, 0) / group.jointIds.length;
      const pivot = projectPoint(options.state.rig, pivotModel, pivotDepth);
      interaction = {
        type: "rotate-peer", peerGroupId, pivotX: pivot.x, pivotY: pivot.y,
        lastAngle: getAngle(pivot.x, pivot.y, screenPoint.x, screenPoint.y),
      };
      options.state.beginHistoryTransaction();
    } else if (target.hasAttribute("data-select-axis") && jointId && axisId && !event.shiftKey) {
      options.setSelection({ jointId, axisId, jointIds: [jointId] });
    } else if ((target.hasAttribute("data-drag-joint") || (event.shiftKey && target.hasAttribute("data-select-axis"))) && jointId) {
      const joint = options.state.getJoint(jointId);
      const previous = options.getSelection();
      const selected = new Set(previous.jointIds);
      if (event.shiftKey && selected.has(jointId)) {
        interaction = { type: "pending-shift-joint", jointId, jointIds: [...selected], startX: screenPoint.x, startY: screenPoint.y,
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
        startJointMove(jointId, jointIds, screenPoint, shouldConstrainJointDistance(event.altKey), event.shiftKey);
        options.state.beginHistoryTransaction();
      }
    } else if (target.hasAttribute("data-peer-capsule") && peerGroupId && !options.getPaintColor()) {
      const group = options.state.rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
      if (group) {
        const jointId = group.jointIds.at(-1) ?? null;
        options.setSelection({
          jointId,
          axisId: jointId ? options.state.getJoint(jointId).axes[0]?.id ?? null : null,
          jointIds: [...group.jointIds],
        });
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
      const marqueePoint = toSvgPoint(element, event);
      const rectangle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rectangle.setAttribute("class", "selection-marquee");
      rectangle.setAttribute("x", String(marqueePoint.x));
      rectangle.setAttribute("y", String(marqueePoint.y));
      rectangle.setAttribute("width", "0");
      rectangle.setAttribute("height", "0");
      element.append(rectangle);
      interaction = { type: "marquee", startX: marqueePoint.x, startY: marqueePoint.y, additive: event.shiftKey, rectangle };
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
      startJointMove(jointId, jointIds, { x: startX, y: startY }, shouldConstrainJointDistance(event.altKey), true);
      options.state.beginHistoryTransaction();
    } else if (interaction.type === "pending-shift-shape") {
      if (Math.hypot(event.clientX - interaction.clientX, event.clientY - interaction.clientY) < 3) return;
      const { shapeId, wasSelected, startX, startY } = interaction;
      if (!wasSelected) options.setSelectedShape?.(shapeId, undefined, true);
      const shapeIds = options.getSelectedShapeIds?.() ?? [shapeId];
      interaction = { type: "move-shapes", shapeIds, startX, startY,
        appliedX: startX, appliedY: startY, axis: null, constrained: true };
      options.state.beginHistoryTransaction();
    }
    if (interaction.type === "rotate-view") {
      const dx = event.clientX - interaction.startClientX;
      const dy = event.clientY - interaction.startClientY;
      if (interaction.free) {
        options.state.setGlobalAxisRotation("x", interaction.startWorldX - dy * 0.5);
        options.state.setGlobalAxisRotation("y", interaction.startWorldY + dx * 0.5);
        return;
      }
      if (!interaction.axis && Math.hypot(dx, dy) >= 3) interaction.axis = Math.abs(dx) >= Math.abs(dy) ? "y" : "x";
      if (!interaction.axis) return;
      let angle = interaction.axis === "y" ? interaction.startWorldY + dx * 0.5
        : interaction.axis === "x" ? interaction.startWorldX - dy * 0.5
          : interaction.startWorldZ + dx * 0.5;
      if (event.shiftKey) angle = Math.round(angle / 15) * 15;
      options.state.setGlobalAxisRotation(interaction.axis, angle);
      return;
    }
    if (interaction.type === "pan") {
      const bounds = element.getBoundingClientRect();
      const dx = (event.clientX - interaction.startClientX) * interaction.viewBox.width / bounds.width;
      const dy = (event.clientY - interaction.startClientY) * interaction.viewBox.height / bounds.height;
      applyViewBox({ ...interaction.viewBox, x: interaction.viewBox.x - dx, y: interaction.viewBox.y - dy });
      return;
    }

    const screenPoint = toSvgPoint(element, event);
    const point = toSvgPoint(element, event, options.state.rig, interactionDepth);
    if (interaction.type === "move-joint-z") {
      // Moving upward brings the selected joint toward the viewer.
      options.state.setJointZ(interaction.jointId, interaction.startZ + (interaction.startClientY - event.clientY) * 0.5);
      return;
    }
    if (jointDrag && jointDrag.constrained !== shouldConstrainJointDistance(event.altKey)) {
      startJointMove(
        jointDrag.jointId,
        jointDrag.jointIds,
        { x: jointDrag.lastX, y: jointDrag.lastY },
        shouldConstrainJointDistance(event.altKey),
        jointDrag.axisLocked,
        jointDrag,
      );
    }
    let jointPoint = screenPoint;
    if (jointDrag?.axisLocked) {
      if (!jointDrag.axis) {
        jointDrag.axis = Math.abs(screenPoint.x - jointDrag.startX) >= Math.abs(screenPoint.y - jointDrag.startY) ? "x" : "y";
      }
      jointPoint = {
        x: jointDrag.axis === "y" ? jointDrag.startX : screenPoint.x,
        y: jointDrag.axis === "x" ? jointDrag.startY : screenPoint.y,
      };
    }
    if (interaction.type === "move-selection") {
      if (interaction.jointIds.length === 1 && options.getMoveSelectedIndividually?.()) {
        options.state.moveJointIndependentlyInCameraPlane(interaction.jointIds[0], jointPoint.x - interaction.lastX, jointPoint.y - interaction.lastY);
      } else {
        options.state.moveJointsInCameraPlane(interaction.jointIds, jointPoint.x - interaction.lastX, jointPoint.y - interaction.lastY);
      }
      interaction.lastX = jointPoint.x;
      interaction.lastY = jointPoint.y;
    } else if (interaction.type === "move-selection-constrained") {
      const angle = getAngle(interaction.parentX, interaction.parentY,
        jointPoint.x + interaction.pointerOffsetX, jointPoint.y + interaction.pointerOffsetY);
      const delta = ((angle - interaction.lastAngle + 540) % 360) - 180;
      options.state.rotateJointsInCameraPlane(interaction.jointIds, delta);
      interaction.lastAngle = angle;
      interaction.lastX = jointPoint.x;
      interaction.lastY = jointPoint.y;
    } else if (interaction.type === "move-joint-constrained") {
      const angle = getAngle(interaction.parentX, interaction.parentY, jointPoint.x, jointPoint.y);
      const delta = ((angle - interaction.lastAngle + 540) % 360) - 180;
      options.state.rotateJointsInCameraPlane([interaction.jointId], delta);
      interaction.lastAngle = angle;
    } else if (interaction.type === "rotate-axis") {
      const { jointId, axisId } = interaction;
      const joint = options.state.getJoint(jointId);
      const axis = joint.axes.find((candidate) => candidate.id === axisId);
      if (!axis) return;
      const first = getAxisPoint(options.state.rig, joint, axis, -1);
      const second = getAxisPoint(options.state.rig, joint, axis, 1);
      const firstScreen = projectPoint(options.state.rig, first, joint.z);
      const secondScreen = projectPoint(options.state.rig, second, joint.z);
      const world = { x: (firstScreen.x + secondScreen.x) / 2, y: (firstScreen.y + secondScreen.y) / 2 };
      const pointerAngle = getAngle(world.x, world.y, screenPoint.x, screenPoint.y);
      const delta = ((pointerAngle - interaction.lastAngle + 540) % 360) - 180;
      options.state.rotateAxisInCameraPlane(jointId, axisId, delta);
      interaction.lastAngle = pointerAngle;
    } else if (interaction.type === "rotate-child") {
      const joint = options.state.getJoint(interaction.jointId);
      if (!joint.parentJointId) return;
      const parentModel = getJointParentWorldTransform(options.state.rig, joint.id);
      if (!parentModel) return;
      const parent = projectPoint(options.state.rig, parentModel, options.state.getJoint(joint.parentJointId).z);
      const pointerAngle = getAngle(parent.x, parent.y, screenPoint.x, screenPoint.y);
      const delta = ((pointerAngle - interaction.lastAngle + 540) % 360) - 180;
      options.state.rotateJointsInCameraPlane([interaction.jointId], delta);
      interaction.lastAngle = pointerAngle;
    } else if (interaction.type === "rotate-peer") {
      if (Math.hypot(screenPoint.x - interaction.pivotX, screenPoint.y - interaction.pivotY) < 12) return;
      const pointerAngle = getAngle(interaction.pivotX, interaction.pivotY, screenPoint.x, screenPoint.y);
      const delta = ((pointerAngle - interaction.lastAngle + 540) % 360) - 180;
      options.state.rotatePeerGroupInCameraPlane(interaction.peerGroupId, delta);
      interaction.lastAngle = pointerAngle;
    } else if (interaction.type === "rotate-selection") {
      const angle = getAngle(interaction.pivotX, interaction.pivotY, screenPoint.x, screenPoint.y);
      let delta = angle - interaction.lastAngle;
      if (event.shiftKey) delta = Math.round(delta / 15) * 15;
      options.state.rotateSelectionInCameraPlane(interaction.jointIds, delta);
      interaction.lastAngle = angle;
    } else if (interaction.type === "move-shape-vertex") {
      options.state.moveArtShapeVertex(interaction.shapeId, interaction.vertexId, point.x, point.y);
    } else if (interaction.type === "move-shapes") {
      if (interaction.constrained && !interaction.axis) {
        interaction.axis = Math.abs(point.x - interaction.startX) >= Math.abs(point.y - interaction.startY) ? "x" : "y";
      }
      const targetX = interaction.axis === "y" ? interaction.startX : point.x;
      const targetY = interaction.axis === "x" ? interaction.startY : point.y;
      options.state.moveArtShapes(interaction.shapeIds, targetX - interaction.appliedX, targetY - interaction.appliedY);
      interaction.appliedX = targetX;
      interaction.appliedY = targetY;
    } else if (interaction.type === "marquee") {
      const marqueePoint = toSvgPoint(element, event);
      const x = Math.min(interaction.startX, marqueePoint.x);
      const y = Math.min(interaction.startY, marqueePoint.y);
      interaction.rectangle.setAttribute("x", String(x));
      interaction.rectangle.setAttribute("y", String(y));
      interaction.rectangle.setAttribute("width", String(Math.abs(marqueePoint.x - interaction.startX)));
      interaction.rectangle.setAttribute("height", String(Math.abs(marqueePoint.y - interaction.startY)));
    }
    if (jointDrag) { jointDrag.lastX = jointPoint.x; jointDrag.lastY = jointPoint.y; }
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
    } else if (interaction.type === "pending-shift-shape") {
      if (event?.type === "pointerup") options.setSelectedShape?.(interaction.shapeId, undefined, true);
    } else if (interaction.type === "marquee") {
      const point = event ? toSvgPoint(element, event) : { x: interaction.startX, y: interaction.startY };
      const left = Math.min(interaction.startX, point.x);
      const right = Math.max(interaction.startX, point.x);
      const top = Math.min(interaction.startY, point.y);
      const bottom = Math.max(interaction.startY, point.y);
      const selected = interaction.additive ? new Set(options.getSelection().jointIds) : new Set<string>();
      for (const joint of options.state.rig.joints) {
        if (joint.isVirtual || !joint.guideVisible) continue;
        const world = projectPoint(options.state.rig, getJointWorldTransform(options.state.rig, joint.id), joint.z ?? 0);
        if (world.x >= left && world.x <= right && world.y >= top && world.y <= bottom) selected.add(joint.id);
      }
      const selectedShapes = interaction.additive ? new Set(options.getSelectedShapeIds?.() ?? []) : new Set<string>();
      for (const shapeId of getArtShapeIdsInMarquee(options.state.rig, left, right, top, bottom)) selectedShapes.add(shapeId);
      interaction.rectangle.remove();
      const jointIds = [...selected];
      const jointId = jointIds.at(-1) ?? null;
      const axisId = jointId ? options.state.getJoint(jointId).axes[0]?.id ?? null : null;
      options.setSelection({ jointId, axisId, jointIds });
      options.setSelectedShapes?.([...selectedShapes]);
    } else if (interaction.type !== "pan") {
      options.state.endHistoryTransaction();
    }
    interaction = null;
    jointDrag = null;
    interactionDepth = 0;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endInteraction);
    window.removeEventListener("pointercancel", endInteraction);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 1.12 : 0.89, toSvgPoint(element, event));
  };
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    const editingOrDialog = target instanceof HTMLElement
      && (target.matches("input, select, textarea, button, [contenteditable='true']") || !!target.closest("dialog"));
    if (event.code === "Space" && !editingOrDialog) {
      spacePressed = true;
      element.classList.add("is-pannable");
      event.preventDefault();
    } else if (!editingOrDialog && options.getPolygonToolActive?.()) {
      if (event.key === "Enter") options.finishPolygon?.();
      else if (event.key === "Escape") options.cancelPolygon?.();
      else if (event.key === "Backspace") options.removeLastPolygonPoint?.();
      else return;
      event.preventDefault();
    } else if (!editingOrDialog && options.getLineToolActive?.()) {
      if (event.key === "Escape") options.cancelLine?.();
      else if (event.key === "Backspace") options.removeLastLinePoint?.();
      else return;
      event.preventDefault();
    } else if (!editingOrDialog && (event.key === "Delete" || event.key === "Backspace")) {
      if (options.deleteSelectedShapeVertex?.()) event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") {
      spacePressed = false;
      element.classList.remove("is-pannable");
    }
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onScreenTouchMove);
  element.addEventListener("pointerup", onScreenTouchEnd);
  element.addEventListener("pointercancel", onScreenTouchEnd);
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
    setScreenMode: (enabled) => {
      screenMode = enabled;
      element.classList.toggle("is-screen-mode", enabled);
      if (!enabled && screenTouches.size) {
        screenTouches.clear();
        screenGesture = null;
        options.state.endHistoryTransaction();
      }
    },
    destroy: () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onScreenTouchMove);
      element.removeEventListener("pointerup", onScreenTouchEnd);
      element.removeEventListener("pointercancel", onScreenTouchEnd);
      element.removeEventListener("contextmenu", onContextMenu);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      endInteraction();
    },
  };
}

function toSvgPoint(element: SVGSVGElement, event: MouseEvent | PointerEvent | WheelEvent, rig?: RigState["rig"], depth = 0) {
  const point = element.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = element.getScreenCTM();
  const screenPoint = matrix ? point.matrixTransform(matrix.inverse()) : point;
  return rig ? unprojectPoint(rig, screenPoint, depth) : screenPoint;
}

function getFaceDepth(rig: RigState["rig"], faceId: string): number {
  const face = rig.faces.find((candidate) => candidate.id === faceId);
  if (!face) return 0;
  let jointIds: string[];
  if (face.cameraFacingLimb) jointIds = [face.cameraFacingLimb.startJointId, face.cameraFacingLimb.endJointId];
  else if (face.rotationTarget.type === "peer") {
    const peerGroupId = face.rotationTarget.peerGroupId;
    jointIds = rig.peerGroups.find((group) => group.id === peerGroupId)?.jointIds ?? [];
  } else jointIds = [face.rotationTarget.childJointId];
  return jointIds.reduce((total, jointId) => total + (rig.joints.find((joint) => joint.id === jointId)?.z ?? 0), 0)
    / Math.max(1, jointIds.length);
}

function getPeerDepth(rig: RigState["rig"], peerGroupId: string): number {
  const group = rig.peerGroups.find((candidate) => candidate.id === peerGroupId);
  if (!group) return 0;
  return group.jointIds.reduce((total, id) => total + (rig.joints.find((joint) => joint.id === id)?.z ?? 0), 0) / group.jointIds.length;
}

function getShapeDepth(rig: RigState["rig"], shapeId: string, vertexId?: string): number {
  const shape = rig.artShapes?.find((candidate) => candidate.id === shapeId);
  if (!shape) return 0;
  const vertices = vertexId ? shape.vertices.filter((vertex) => vertex.id === vertexId) : shape.vertices;
  if (!vertices.length) return 0;
  return vertices.reduce((sum, vertex) => {
    const jointId = vertex.source === "axis-point" || vertex.source === "joint-center" ? vertex.jointId
      : vertex.source === "root" ? vertex.rootJointId : null;
    return sum + (jointId ? rig.joints.find((joint) => joint.id === jointId)?.z ?? 0 : 0);
  }, 0) / vertices.length;
}

export function getArtShapeIdsInMarquee(
  rig: RigState["rig"], left: number, right: number, top: number, bottom: number,
): string[] {
  if (rig.elementLayers?.shapes === false) return [];
  return (rig.artShapes ?? []).flatMap((shape) => {
    if (shape.groupId && rig.groups.find((group) => group.id === shape.groupId)?.visible === false) return [];
    const points = shape.vertices.map((vertex) => {
      const jointId = vertex.source === "axis-point" || vertex.source === "joint-center" ? vertex.jointId
        : vertex.source === "root" ? vertex.rootJointId : null;
      const depth = jointId ? rig.joints.find((joint) => joint.id === jointId)?.z ?? 0 : 0;
      return projectPoint(rig, getArtShapeVertexPoint(rig, vertex), depth);
    });
    if (!points.length) return [];
    const sphereScale = shape.kind === "sphere" && shape.vertices[0]
      ? getProjectionScale(rig, getCameraZ(rig, getArtShapeVertexPoint(rig, shape.vertices[0]), getShapeDepth(rig, shape.id)))
      : 1;
    const paddingX = shape.kind === "circle" ? shape.radiusX ?? 0 : shape.kind === "sphere" ? (shape.radius ?? 0) * sphereScale : shape.kind === "line" ? (shape.strokeWidth ?? 1) / 2 : 0;
    const paddingY = shape.kind === "circle" ? shape.radiusY ?? 0 : shape.kind === "sphere" ? (shape.radius ?? 0) * sphereScale : shape.kind === "line" ? (shape.strokeWidth ?? 1) / 2 : 0;
    const shapeLeft = Math.min(...points.map((point) => point.x)) - paddingX;
    const shapeRight = Math.max(...points.map((point) => point.x)) + paddingX;
    const shapeTop = Math.min(...points.map((point) => point.y)) - paddingY;
    const shapeBottom = Math.max(...points.map((point) => point.y)) + paddingY;
    return shapeRight >= left && shapeLeft <= right && shapeBottom >= top && shapeTop <= bottom ? [shape.id] : [];
  });
}

function getAngle(centerX: number, centerY: number, x: number, y: number): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}
