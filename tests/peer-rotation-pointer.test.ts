import assert from "node:assert/strict";
import test from "node:test";

import { enablePointerInput } from "../src/editor/pointer-input.ts";
import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform, getPeerGroupPivot } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

const viewState: EditorViewState = {
  outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso", selectedTarget: "joint",
  inspectorTab: "selection", preserveProportions: false, activeTool: "select", paintColor: "#dca27b", paintPaletteId: null,
};

for (const groupId of ["shoulder-band", "hip-band"]) {
  test(`${groupId} handle starts away from the pivot and rotates gradually without jumping`, () => {
    const state = new RigState(createDefaultRig());
    const group = state.rig.peerGroups.find((candidate) => candidate.id === groupId)!;
    const pivot = getPeerGroupPivot(state.rig, groupId);
    const reference = getJointWorldTransform(state.rig, group.jointIds[0]);
    const referenceDistance = Math.hypot(reference.x - pivot.x, reference.y - pivot.y);
    const dx = reference.x - pivot.x;
    const dy = reference.y - pivot.y;
    const handleDistance = Math.max(55, Math.min(90, referenceDistance));
    const x = pivot.x - dy / referenceDistance * handleDistance + 3;
    const y = pivot.y + dx / referenceDistance * handleDistance + 2;
    const before = structuredClone(state.rig);
    const hostEvents = new Map<string, (event: any) => void>();
    const windowEvents = new Map<string, (event: any) => void>();
    const host = {
      innerHTML: "", addEventListener: (name: string, fn: (event: any) => void) => hostEvents.set(name, fn),
      removeEventListener: () => {}, createSVGPoint: () => ({ x: 0, y: 0 }), getScreenCTM: () => null,
      classList: { toggle: () => {}, remove: () => {} },
    } as unknown as SVGSVGElement;
    renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
    assert.match(host.innerHTML, /class="peer-handle-guide"/);
    const originalWindow = globalThis.window;
    Object.assign(globalThis, { window: {
      addEventListener: (name: string, fn: (event: any) => void) => windowEvents.set(name, fn),
      removeEventListener: (name: string) => windowEvents.delete(name),
    } });
    try {
      const controller = enablePointerInput(host, {
        state, getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
        getPreserveProportions: () => false, getPaintColor: () => null, getLayerToolActive: () => false,
        setSelection: () => {}, setSelectedFace: () => {},
      });
      hostEvents.get("pointerdown")!({ button: 0, clientX: x, clientY: y,
        target: { dataset: { peerGroupId: groupId }, hasAttribute: (name: string) => name === "data-peer-rotation" },
        preventDefault: () => {} });
      windowEvents.get("pointermove")!({ clientX: x, clientY: y });
      assert.deepEqual(state.rig, before);
      windowEvents.get("pointermove")!({ clientX: x + 1, clientY: y });
      const after = getJointWorldTransform(state.rig, group.jointIds[0]);
      const displacement = Math.hypot(after.x - reference.x, after.y - reference.y);
      assert.ok(displacement > 0 && displacement < 4, `unexpected jump: ${displacement}`);
      assert.ok(Math.abs(Math.hypot(after.x - pivot.x, after.y - pivot.y) - referenceDistance) < 1e-8);
      windowEvents.get("pointerup")!({ type: "pointerup" });
      state.undo();
      assert.deepEqual(state.rig, before);
      controller.destroy();
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else Object.assign(globalThis, { window: originalWindow });
    }
  });
}
