import type { RigState } from "../rig/rig-state";
import type { EditorSelection } from "./types";

interface PointerInputOptions {
  state: RigState;
  getSelection: () => EditorSelection;
  setSelection: (selection: EditorSelection) => void;
  setSelectedFace: (faceId: string) => void;
}

type Interaction =
  | { type: "move"; jointId: string; offsetX: number; offsetY: number }
  | { type: "rotate"; jointId: string; axisId: string; angleOffset: number };

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

    if (target.hasAttribute("data-rotation-handle") && jointId && axisId) {
      const joint = options.state.getJoint(jointId);
      const axis = joint.axes.find((candidate) => candidate.id === axisId);
      if (!axis) return;
      const pointerAngle = getAngle(joint.x, joint.y, point.x, point.y);
      interaction = {
        type: "rotate",
        jointId,
        axisId,
        angleOffset: axis.angle - pointerAngle,
      };
    } else if (target.hasAttribute("data-select-axis") && jointId && axisId) {
      options.setSelection({ jointId, axisId });
    } else if (target.hasAttribute("data-drag-joint") && jointId) {
      const joint = options.state.getJoint(jointId);
      const previous = options.getSelection();
      options.setSelection({
        jointId,
        axisId: previous.jointId === jointId ? previous.axisId : joint.axes[0]?.id ?? null,
      });
      interaction = {
        type: "move",
        jointId,
        offsetX: joint.x - point.x,
        offsetY: joint.y - point.y,
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
    } else {
      const joint = options.state.getJoint(interaction.jointId);
      const pointerAngle = getAngle(joint.x, joint.y, point.x, point.y);
      options.state.setAxisAngle(
        interaction.jointId,
        interaction.axisId,
        pointerAngle + interaction.angleOffset,
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
