import type { RigState } from "../rig/rig-state";
import { getAxisWorldAngle, getJointWorldTransform, getPeerGroupPivot } from "../rig/geometry";
import type { EditorSelection } from "./types";

interface PointerInputOptions {
  state: RigState;
  getSelection: () => EditorSelection;
  setSelection: (selection: EditorSelection) => void;
  setSelectedFace: (faceId: string) => void;
}

type Interaction =
  | { type: "move"; jointId: string; offsetX: number; offsetY: number }
  | { type: "rotate-axis"; jointId: string; axisId: string; angleOffset: number }
  | { type: "rotate-child"; jointId: string }
  | { type: "rotate-lower-body"; jointId: string; angleOffset: number }
  | { type: "rotate-peer"; peerGroupId: string };

export function enablePointerInput(
  element: SVGSVGElement,
  options: PointerInputOptions,
): () => void {
  let interaction: Interaction | null = null;

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as SVGElement;
    const point = toSvgPoint(element, event);
    const jointId = target.dataset.jointId;
    const axisId = target.dataset.axisId;
    const faceId = target.dataset.faceId;
    const peerGroupId = target.dataset.peerGroupId;

    if (target.hasAttribute("data-rotation-handle") && jointId && axisId) {
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
    } else if (target.hasAttribute("data-lower-body-rotation") && jointId) {
      const joint = options.state.getJoint(jointId);
      if (!joint.parentJointId) return;
      const parent = getJointWorldTransform(options.state.rig, joint.parentJointId);
      const current = getJointWorldTransform(options.state.rig, jointId);
      interaction = {
        type: "rotate-lower-body",
        jointId,
        angleOffset: getAngle(parent.x, parent.y, current.x, current.y)
          - getAngle(parent.x, parent.y, point.x, point.y),
      };
      options.setSelectedFace("pelvis");
    } else if (target.hasAttribute("data-child-rotation") && jointId) {
      interaction = { type: "rotate-child", jointId };
    } else if (target.hasAttribute("data-peer-rotation") && peerGroupId) {
      interaction = { type: "rotate-peer", peerGroupId };
    } else if (target.hasAttribute("data-select-axis") && jointId && axisId) {
      options.setSelection({ jointId, axisId });
    } else if (target.hasAttribute("data-drag-joint") && jointId) {
      const joint = options.state.getJoint(jointId);
      const world = getJointWorldTransform(options.state.rig, jointId);
      const previous = options.getSelection();
      options.setSelection({
        jointId,
        axisId: previous.jointId === jointId ? previous.axisId : joint.axes[0]?.id ?? null,
      });
      interaction = {
        type: "move",
        jointId,
        offsetX: world.x - point.x,
        offsetY: world.y - point.y,
      };
    } else if (faceId) {
      options.setSelectedFace(faceId);
    } else {
      options.setSelection({ jointId: null, axisId: null });
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
    const point = toSvgPoint(element, event);
    if (interaction.type === "move") {
      options.state.moveJoint(
        interaction.jointId,
        point.x + interaction.offsetX,
        point.y + interaction.offsetY,
      );
    } else if (interaction.type === "rotate-axis") {
      const joint = options.state.getJoint(interaction.jointId);
      const world = getJointWorldTransform(options.state.rig, joint.id);
      const pointerAngle = getAngle(world.x, world.y, point.x, point.y);
      options.state.setAxisAngle(
        interaction.jointId,
        interaction.axisId,
        pointerAngle + interaction.angleOffset - world.rotation,
      );
    } else if (interaction.type === "rotate-child") {
      const joint = options.state.getJoint(interaction.jointId);
      if (!joint.parentJointId) return;
      const parent = getJointWorldTransform(options.state.rig, joint.parentJointId);
      options.state.rotateChildAroundParent(
        interaction.jointId,
        getAngle(parent.x, parent.y, point.x, point.y),
      );
    } else if (interaction.type === "rotate-lower-body") {
      const joint = options.state.getJoint(interaction.jointId);
      if (!joint.parentJointId) return;
      const parent = getJointWorldTransform(options.state.rig, joint.parentJointId);
      options.state.rotateChildAroundParent(
        interaction.jointId,
        getAngle(parent.x, parent.y, point.x, point.y) + interaction.angleOffset,
      );
    } else {
      const pivot = getPeerGroupPivot(options.state.rig, interaction.peerGroupId);
      options.state.rotatePeerGroup(
        interaction.peerGroupId,
        getAngle(pivot.x, pivot.y, point.x, point.y),
      );
    }
  };

  const endInteraction = () => {
    interaction = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endInteraction);
    window.removeEventListener("pointercancel", endInteraction);
  };

  element.addEventListener("pointerdown", onPointerDown);
  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    endInteraction();
  };
}

function toSvgPoint(element: SVGSVGElement, event: PointerEvent) {
  const point = element.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = element.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : point;
}

function getAngle(centerX: number, centerY: number, x: number, y: number): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}
