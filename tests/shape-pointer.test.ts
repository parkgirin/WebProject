import assert from "node:assert/strict";
import test from "node:test";

import { enablePointerInput, getArtShapeIdsInMarquee } from "../src/editor/pointer-input.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getArtShapeVertexPoint } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

function withShapePointerTest(run: (tools: {
  state: RigState;
  shapeIds: string[];
  selected: () => string[];
  setSelected: (ids: string[]) => void;
  down: (shapeId: string, shift?: boolean, alt?: boolean) => void;
  move: (x: number, y: number, shift?: boolean, alt?: boolean) => void;
  up: () => void;
  point: (shapeId: string) => { x: number; y: number };
}) => void): void {
  const state = new RigState(createDefaultRig());
  const shapeIds = [state.addCircle(180, 220, 20), state.addCircle(280, 320, 20)];
  let selectedShapeIds = [...shapeIds];
  const hostEvents = new Map<string, (event: any) => void>();
  const windowEvents = new Map<string, (event: any) => void>();
  const host = {
    addEventListener: (name: string, listener: (event: any) => void) => hostEvents.set(name, listener),
    removeEventListener: () => {},
    createSVGPoint: () => ({ x: 0, y: 0 }),
    getScreenCTM: () => null,
    classList: { toggle: () => {}, remove: () => {} },
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: {
    addEventListener: (name: string, listener: (event: any) => void) => windowEvents.set(name, listener),
    removeEventListener: (name: string) => windowEvents.delete(name),
  } });
  const point = (shapeId: string) => {
    const shape = state.getArtShape(shapeId);
    return getArtShapeVertexPoint(state.rig, shape.vertices[0]);
  };
  const setSelectedShape = (shapeId: string, _vertexId?: string, additive = false) => {
    const selected = new Set(selectedShapeIds);
    if (additive && selected.has(shapeId)) selected.delete(shapeId);
    else {
      if (!additive) selected.clear();
      selected.add(shapeId);
    }
    selectedShapeIds = [...selected];
  };
  try {
    const controller = enablePointerInput(host, {
      state,
      getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
      getEditBodyProportions: () => false,
      getPaintColor: () => null,
      getLayerToolActive: () => false,
      getSelectedShapeIds: () => selectedShapeIds,
      setSelection: () => {},
      setSelectedFace: () => {},
      setSelectedShape,
      duplicateSelectedShapes: (clickedShapeId) => {
        const sources = selectedShapeIds.includes(clickedShapeId) ? selectedShapeIds : [clickedShapeId];
        selectedShapeIds = state.duplicateArtShapes(sources);
        return selectedShapeIds;
      },
    });
    run({
      state, shapeIds, selected: () => selectedShapeIds, setSelected: (ids) => { selectedShapeIds = ids; }, point,
      down: (shapeId, shiftKey = false, altKey = false) => {
        const current = point(shapeId);
        hostEvents.get("pointerdown")!({ button: 0, shiftKey, altKey, clientX: current.x, clientY: current.y,
          target: { dataset: { shapeId }, hasAttribute: () => false }, preventDefault: () => {} });
      },
      move: (x, y, shiftKey = false, altKey = false) => windowEvents.get("pointermove")!({ clientX: x, clientY: y, shiftKey, altKey }),
      up: () => windowEvents.get("pointerup")!({ type: "pointerup" }),
    });
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  }
}

test("shift-drag constrains a multi-shape move to its dominant axis", () => {
  withShapePointerTest(({ shapeIds, down, move, up, point }) => {
    const before = shapeIds.map(point);
    down(shapeIds[0], true);
    move(before[0].x + 7, before[0].y + 34, true);
    up();
    assert.deepEqual(shapeIds.map(point), before.map((value) => ({ x: value.x, y: value.y + 34 })));
  });
});

test("shift-click still toggles shape selection without moving it", () => {
  withShapePointerTest(({ shapeIds, selected, setSelected, down, up, point }) => {
    setSelected([shapeIds[0]]);
    const before = point(shapeIds[1]);
    down(shapeIds[1], true);
    up();
    assert.deepEqual(selected(), shapeIds);
    assert.deepEqual(point(shapeIds[1]), before);
  });
});

test("alt-drag duplicates the multi-selection and moves only the copies", () => {
  withShapePointerTest(({ state, shapeIds, selected, down, move, up, point }) => {
    const before = shapeIds.map(point);
    down(shapeIds[0], false, true);
    const copyIds = [...selected()];
    move(before[0].x + 25, before[0].y + 12, false, true);
    up();

    assert.equal(copyIds.length, 2);
    assert.deepEqual(shapeIds.map(point), before);
    assert.deepEqual(copyIds.map(point), before.map((value) => ({ x: value.x + 25, y: value.y + 12 })));
    state.undo();
    assert.equal(state.rig.artShapes?.some((shape) => copyIds.includes(shape.id)), false);
  });
});

test("marquee bounds select intersecting visible shapes including their circle radius and line width", () => {
  const state = new RigState(createDefaultRig());
  state.rig.artShapes = [];
  const circle = state.addCircle(200, 200, 30);
  const outside = state.addCircle(350, 350, 20);
  const line = state.addLine([{ x: 260, y: 180 }, { x: 320, y: 180 }], 20);

  assert.deepEqual(getArtShapeIdsInMarquee(state.rig, 225, 275, 170, 210), [circle, line]);
  assert.deepEqual(getArtShapeIdsInMarquee(state.rig, 330, 330, 330, 330), [outside]);

  state.rig.elementLayers!.shapes = false;
  assert.deepEqual(getArtShapeIdsInMarquee(state.rig, 0, 600, 0, 780), []);
});

test("blank-canvas drag replaces shape selection and shift-drag adds to it", () => {
  const state = new RigState(createDefaultRig());
  state.rig.artShapes = [];
  const first = state.addCircle(180, 180, 20);
  const second = state.addCircle(320, 320, 20);
  let selectedShapeIds: string[] = [];
  const hostEvents = new Map<string, (event: any) => void>();
  const windowEvents = new Map<string, (event: any) => void>();
  const rectangle = { setAttribute: () => {}, remove: () => {} };
  const host = {
    addEventListener: (name: string, listener: (event: any) => void) => hostEvents.set(name, listener),
    removeEventListener: () => {}, append: () => {}, createSVGPoint: () => ({ x: 0, y: 0 }),
    getScreenCTM: () => null, classList: { toggle: () => {}, remove: () => {} },
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  Object.assign(globalThis, {
    window: {
      addEventListener: (name: string, listener: (event: any) => void) => windowEvents.set(name, listener),
      removeEventListener: (name: string) => windowEvents.delete(name),
    },
    document: { createElementNS: () => rectangle },
  });
  try {
    const controller = enablePointerInput(host, {
      state, getSelection: () => ({ jointId: null, axisId: null, jointIds: [] }),
      getEditBodyProportions: () => false, getPaintColor: () => null, getLayerToolActive: () => false,
      getSelectedShapeIds: () => selectedShapeIds, setSelection: () => {}, setSelectedFace: () => {},
      setSelectedShapes: (ids) => { selectedShapeIds = ids; },
    });
    const drag = (from: number, to: number, shiftKey = false) => {
      hostEvents.get("pointerdown")!({ button: 0, shiftKey, clientX: from, clientY: from,
        target: { dataset: {}, hasAttribute: () => false }, preventDefault: () => {} });
      windowEvents.get("pointermove")!({ clientX: to, clientY: to });
      windowEvents.get("pointerup")!({ type: "pointerup", clientX: to, clientY: to });
    };
    drag(150, 210);
    assert.deepEqual(selectedShapeIds, [first]);
    drag(290, 350, true);
    assert.deepEqual(selectedShapeIds, [first, second]);
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.assign(globalThis, { document: originalDocument });
  }
});
