import assert from "node:assert/strict";
import test from "node:test";

import { enablePointerInput } from "../src/editor/pointer-input.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";

test("right-drag rotates the world Y axis and records one undoable change", () => {
  const state = new RigState(createDefaultRig());
  const hostEvents = new Map<string, (event: any) => void>();
  const windowEvents = new Map<string, (event: any) => void>();
  const host = {
    addEventListener: (name: string, listener: (event: any) => void) => hostEvents.set(name, listener),
    removeEventListener: () => {}, createSVGPoint: () => ({ x: 0, y: 0 }), getScreenCTM: () => null,
    classList: { toggle: () => {}, remove: () => {} },
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: {
    addEventListener: (name: string, listener: (event: any) => void) => windowEvents.set(name, listener),
    removeEventListener: (name: string) => windowEvents.delete(name),
  } });
  try {
    const controller = enablePointerInput(host, {
      state, getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
      getEditBodyProportions: () => false, getPaintColor: () => null, getLayerToolActive: () => false,
      setSelection: () => {}, setSelectedFace: () => {},
    });
    hostEvents.get("pointerdown")!({ button: 2, clientX: 100, clientY: 50,
      target: { dataset: {}, hasAttribute: () => false }, preventDefault: () => {} });
    windowEvents.get("pointermove")!({ clientX: 160, clientY: 50, shiftKey: false });
  assert.equal(state.getGlobalAxisRotation("y"), 30);
    windowEvents.get("pointerup")!({ type: "pointerup" });
    state.undo();
    assert.equal(state.rig.viewYRotation, 0);
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  }
});

test("screen mode drag rotates both world axes instead of editing the model", () => {
  const state = new RigState(createDefaultRig());
  const hostEvents = new Map<string, (event: any) => void>();
  const windowEvents = new Map<string, (event: any) => void>();
  const host = {
    addEventListener: (name: string, listener: (event: any) => void) => hostEvents.set(name, listener),
    removeEventListener: () => {}, createSVGPoint: () => ({ x: 0, y: 0 }), getScreenCTM: () => null,
    classList: { toggle: () => {}, remove: () => {} },
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: {
    addEventListener: (name: string, listener: (event: any) => void) => windowEvents.set(name, listener),
    removeEventListener: (name: string) => windowEvents.delete(name),
  } });
  try {
    let selected = false;
    const controller = enablePointerInput(host, {
      state, getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
      getEditBodyProportions: () => false, getPaintColor: () => null, getLayerToolActive: () => false,
      setSelection: () => { selected = true; }, setSelectedFace: () => {},
    });
    controller.setScreenMode(true);
    hostEvents.get("pointerdown")!({ button: 0, clientX: 100, clientY: 100, pointerType: "mouse",
      target: { dataset: { jointId: "head" }, hasAttribute: (name: string) => name === "data-drag-joint" }, preventDefault: () => {} });
    windowEvents.get("pointermove")!({ clientX: 140, clientY: 80, shiftKey: false });
    assert.equal(state.getGlobalAxisRotation("x"), 10);
    assert.equal(state.getGlobalAxisRotation("y"), 20);
    assert.equal(selected, false);
    windowEvents.get("pointerup")!({ type: "pointerup" });
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  }
});

test("one-finger screen gesture rotates the model on touch devices", () => {
  const state = new RigState(createDefaultRig());
  const hostEvents = new Map<string, (event: any) => void>();
  const host = {
    addEventListener: (name: string, listener: (event: any) => void) => hostEvents.set(name, listener),
    removeEventListener: () => {}, createSVGPoint: () => ({ x: 0, y: 0 }), getScreenCTM: () => null,
    classList: { toggle: () => {}, remove: () => {} }, setPointerCapture: () => {},
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { addEventListener: () => {}, removeEventListener: () => {} } });
  try {
    const controller = enablePointerInput(host, {
      state, getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
      getEditBodyProportions: () => false, getPaintColor: () => null, getLayerToolActive: () => false,
      setSelection: () => {}, setSelectedFace: () => {},
    });
    controller.setScreenMode(true);
    const base = { button: 0, pointerId: 7, pointerType: "touch", target: { dataset: {}, hasAttribute: () => false }, preventDefault: () => {} };
    hostEvents.get("pointerdown")!({ ...base, clientX: 100, clientY: 100 });
    hostEvents.get("pointermove")!({ ...base, clientX: 130, clientY: 70 });
    assert.equal(state.getGlobalAxisRotation("x"), 15);
    assert.equal(state.getGlobalAxisRotation("y"), 15);
    hostEvents.get("pointerup")!({ ...base, clientX: 130, clientY: 70 });
    assert.equal(state.canUndo, true);
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  }
});
