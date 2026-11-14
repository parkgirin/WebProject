import assert from "node:assert/strict";
import test from "node:test";

import { enablePointerInput } from "../src/editor/pointer-input.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";

function createHarness(state: RigState) {
  const hostEvents = new Map<string, (event: any) => void>();
  const windowEvents = new Map<string, (event: any) => void>();
  const host = {
    addEventListener: (name: string, fn: (event: any) => void) => hostEvents.set(name, fn),
    removeEventListener: () => {}, createSVGPoint: () => ({ x: 0, y: 0 }), getScreenCTM: () => null,
    classList: { toggle: () => {}, remove: () => {} },
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: {
    addEventListener: (name: string, fn: (event: any) => void) => windowEvents.set(name, fn),
    removeEventListener: (name: string) => windowEvents.delete(name),
  } });
  const controller = enablePointerInput(host, {
    state, getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
    getEditBodyProportions: () => false, getPaintColor: () => null, getLayerToolActive: () => false,
    setSelection: () => {}, setSelectedFace: () => {},
  });
  return { hostEvents, windowEvents, destroy: () => {
    controller.destroy();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  } };
}

test("dragging a selected joint capsule handle changes its flat length", () => {
  const state = new RigState(createDefaultRig());
  const harness = createHarness(state);
  try {
    harness.hostEvents.get("pointerdown")!({
      button: 0, clientX: 330, clientY: 320,
      target: {
        dataset: { capsuleKind: "joint", jointId: "waist", capsuleAxis: "x" },
        hasAttribute: (name: string) => name === "data-capsule-resize",
      }, preventDefault: () => {},
    });
    harness.windowEvents.get("pointermove")!({ clientX: 345, clientY: 320 });
    assert.equal(state.getJoint("waist").capsuleFlatLengths?.x, 90);
    harness.windowEvents.get("pointerup")!({ type: "pointerup" });
    state.undo();
    assert.equal(state.getJoint("waist").capsuleFlatLengths?.x, 60);
  } finally { harness.destroy(); }
});

test("dragging a selected virtual capsule handle changes peer distance symmetrically", () => {
  const state = new RigState(createDefaultRig());
  const harness = createHarness(state);
  try {
    harness.hostEvents.get("pointerdown")!({
      button: 0, clientX: 240, clientY: 224,
      target: {
        dataset: { capsuleKind: "peer", peerGroupId: "shoulder-band" },
        hasAttribute: (name: string) => name === "data-capsule-resize",
      }, preventDefault: () => {},
    });
    harness.windowEvents.get("pointermove")!({ clientX: 210, clientY: 224 });
    assert.equal(state.getPeerGroupDistance("shoulder-band"), 180);
    harness.windowEvents.get("pointerup")!({ type: "pointerup" });
    state.undo();
    assert.equal(state.getPeerGroupDistance("shoulder-band"), 120);
  } finally { harness.destroy(); }
});
