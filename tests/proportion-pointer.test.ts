import assert from "node:assert/strict";
import test from "node:test";

import { enablePointerInput } from "../src/editor/pointer-input.ts";
import type { EditorSelection } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getJointWorldTransform } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

function withPointerTest(run: (h: {
  state: RigState; getSelection: () => EditorSelection; setSelection: (value: EditorSelection) => void; setPreserve: (value: boolean) => void;
  down: (id: string, shift: boolean, alt?: boolean, axis?: boolean) => void; move: (x: number, y: number, alt: boolean) => void;
  up: () => void; point: (id: string) => { x: number; y: number }; length: (id: string) => number;
}) => void) {
  const state = new RigState(createDefaultRig());
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
  let selection: EditorSelection = { jointId: "left-elbow", axisId: "upper-arm", jointIds: ["left-elbow"] };
  let preserve = false;
  const point = (id: string) => getJointWorldTransform(state.rig, id);
  const length = (id: string) => {
    const child = point(id);
    const parent = point(state.getJoint(id).parentJointId!);
    return Math.hypot(child.x - parent.x, child.y - parent.y);
  };
  try {
    const controller = enablePointerInput(host, {
      state, getSelection: () => selection, getPreserveProportions: () => preserve,
      getPaintColor: () => null, getLayerToolActive: () => false,
      setSelection: (next) => { selection = next; }, setSelectedFace: () => {},
    });
    run({ state, getSelection: () => selection, setSelection: (value) => { selection = value; }, setPreserve: (value) => { preserve = value; }, point, length,
      down: (id, shiftKey, altKey = false, axis = false) => {
        const current = point(id);
        hostEvents.get("pointerdown")!({ button: 0, shiftKey, altKey, clientX: current.x, clientY: current.y,
          target: { dataset: { jointId: id, ...(axis ? { axisId: "torso" } : {}) }, hasAttribute: (name: string) => name === (axis ? "data-select-axis" : "data-drag-joint") },
          preventDefault: () => {} });
      },
      move: (x, y, altKey) => windowEvents.get("pointermove")!({ clientX: x, clientY: y, altKey }),
      up: () => windowEvents.get("pointerup")!({ type: "pointerup" }),
    });
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  }
}

test("alt-drag preserves length without deselecting, while shift-click deselects", () => {
  withPointerTest(({ down, move, up, point, length, getSelection, state }) => {
    const before = point("left-elbow");
    const initialLength = length("left-elbow");
    down("left-elbow", false, true);
    move(before.x + 35, before.y + 20, true);
    up();
    assert.deepEqual(getSelection().jointIds, ["left-elbow"]);
    assert.ok(Math.abs(length("left-elbow") - initialLength) < 1e-8);
    assert.equal(state.canUndo, true);
    down("left-elbow", true);
    up();
    assert.deepEqual(getSelection().jointIds, []);
  });
});

test("shift-clicking a peer joint axis adds and removes it without clearing the other peer", () => {
  withPointerTest(({ down, up, getSelection, setSelection }) => {
    setSelection({ jointId: "left-shoulder", axisId: "torso", jointIds: ["left-shoulder"] });
    down("right-shoulder", true, false, true);
    up();
    assert.deepEqual(getSelection().jointIds, ["left-shoulder", "right-shoulder"]);
    down("right-shoulder", true, false, true);
    up();
    assert.deepEqual(getSelection().jointIds, ["left-shoulder"]);
    down("right-shoulder", false, false, true);
    assert.deepEqual(getSelection().jointIds, ["right-shoulder"]);
  });
});

test("alt-drag on a selected joint preserves the whole multi-selection", () => {
  withPointerTest(({ down, move, up, point, length, getSelection, setSelection }) => {
    setSelection({ jointId: "left-elbow", axisId: "upper-arm", jointIds: ["left-elbow", "left-wrist"] });
    const initialLengths = [length("left-elbow"), length("left-wrist")];
    const before = point("left-elbow");
    down("left-elbow", false, true);
    move(before.x + 35, before.y + 15, true);
    up();
    assert.deepEqual(getSelection().jointIds, ["left-elbow", "left-wrist"]);
    assert.ok(Math.abs(length("left-elbow") - initialLengths[0]) < 1e-8);
    assert.ok(Math.abs(length("left-wrist") - initialLengths[1]) < 1e-8);
  });
});

test("shift selects joints without activating the proportion constraint", () => {
  withPointerTest(({ down, move, up, point, length, getSelection }) => {
    const start = point("right-elbow");
    const initial = length("right-elbow");
    down("right-elbow", true);
    move(start.x + 35, start.y + 20, false);
    up();
    assert.deepEqual(getSelection().jointIds, ["left-elbow", "right-elbow"]);
    assert.ok(Math.abs(length("right-elbow") - initial) > 1e-3);
  });
});

test("alt can be pressed or released during a drag and checkbox keeps the constraint active", () => {
  withPointerTest(({ down, move, up, point, length, setPreserve }) => {
    const start = point("left-elbow");
    down("left-elbow", false);
    move(start.x + 15, start.y + 10, false);
    const unconstrainedLength = length("left-elbow");
    move(start.x + 30, start.y + 25, true);
    assert.ok(Math.abs(length("left-elbow") - unconstrainedLength) < 1e-8);
    move(start.x + 45, start.y + 40, false);
    assert.ok(Math.abs(length("left-elbow") - unconstrainedLength) > 1e-3);
    up();
    setPreserve(true);
    const next = point("left-elbow");
    const fixedLength = length("left-elbow");
    down("left-elbow", false);
    move(next.x + 30, next.y + 20, false);
    up();
    assert.ok(Math.abs(length("left-elbow") - fixedLength) < 1e-8);
  });
});
