import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { enablePointerInput } from "../src/editor/pointer-input.ts";

function renderedStack(state: RigState): string[] {
  const group = (id?: string) => state.rig.groups.find((item) => item.id === id);
  return [
    ...state.rig.joints.filter((joint) => joint.bodyVisible && (group(joint.groupId)?.visible ?? true))
      .map((joint) => ({ key: `joint:${joint.id}`, order: (group(joint.groupId)?.order ?? 0) + joint.renderOrder })),
    ...state.rig.faces.filter((face) => group(face.groupId)?.visible ?? true)
      .map((face) => ({ key: `face:${face.id}`, order: (group(face.groupId)?.order ?? 0) + state.getFaceLayerOrder(face.id) })),
  ].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map((entry) => entry.key);
}

test("one-step tool passes exactly one visible item, even when layer orders tie", () => {
  const state = new RigState(createDefaultRig());
  const before = renderedStack(state);
  const index = before.findIndex((key, i) => i < before.length - 1 && key.startsWith("face:"));
  const [type, id] = before[index].split(":") as ["face", string];
  state.moveBodyItemInStack(type, id, 1, false);
  const expected = [...before];
  [expected[index], expected[index + 1]] = [expected[index + 1], expected[index]];
  assert.deepEqual(renderedStack(state), expected);
  state.undo();
  assert.deepEqual(renderedStack(state), before);
  state.redo();
  assert.deepEqual(renderedStack(state), expected);
});

test("front tool moves a joint above visible faces and joints and ignores hidden groups", () => {
  const state = new RigState(createDefaultRig());
  state.setLayerGroupVisibility("head", false);
  const before = renderedStack(state);
  state.moveBodyItemInStack("joint", "left-elbow", 1, true);
  assert.deepEqual(renderedStack(state), [...before.filter((key) => key !== "joint:left-elbow"), "joint:left-elbow"]);
  state.undo();
  assert.deepEqual(renderedStack(state), before);
});

test("clicking an item already at the front does not create a history entry", () => {
  const state = new RigState(createDefaultRig());
  const [type, id] = renderedStack(state).at(-1)!.split(":") as ["joint" | "face", string];
  state.moveBodyItemInStack(type, id, 1, false);
  assert.equal(state.canUndo, false);
});

test("moving a joint preserves the order of faces whose layers are derived from joints", () => {
  const rig = createDefaultRig();
  delete rig.faces.find((face) => face.id === "left-upper-arm")!.layerOrder;
  const state = new RigState(rig);
  const before = renderedStack(state);
  const index = before.indexOf("joint:left-elbow");
  assert.ok(index < before.length - 1);
  state.moveBodyItemInStack("joint", "left-elbow", 1, false);
  const expected = [...before];
  [expected[index], expected[index + 1]] = [expected[index + 1], expected[index]];
  assert.deepEqual(renderedStack(state), expected);
});

test("layer pointer tool selects and moves clicked faces and joints without dragging", () => {
  const state = new RigState(createDefaultRig());
  const events = new Map<string, (event: unknown) => void>();
  const element = {
    addEventListener: (name: string, handler: (event: unknown) => void) => events.set(name, handler),
    removeEventListener: () => {},
    createSVGPoint: () => ({ x: 0, y: 0 }), getScreenCTM: () => null,
    classList: { toggle: () => {}, remove: () => {} },
  } as unknown as SVGSVGElement;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { addEventListener: () => {}, removeEventListener: () => {} } });
  let selection = { jointId: null as string | null, axisId: null as string | null, jointIds: [] as string[] };
  let faceId = "";
  try {
    const controller = enablePointerInput(element, {
      state, getSelection: () => selection, getPreserveProportions: () => false,
      getPaintColor: () => null, getLayerToolActive: () => true,
      setSelection: (next) => { selection = next; }, setSelectedFace: (id) => { faceId = id; },
    });
    const click = (dataset: Record<string, string>, attributes: string[], button = 0, shiftKey = false) => {
      let prevented = false;
      events.get("pointerdown")!({ button, shiftKey, clientX: 1, clientY: 1,
        target: { dataset, hasAttribute: (name: string) => attributes.includes(name) },
        preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true);
    };
    const beforeJoint = renderedStack(state);
    click({ jointId: "left-elbow" }, ["data-drag-joint"]);
    assert.equal(selection.jointId, "left-elbow");
    assert.equal(renderedStack(state).indexOf("joint:left-elbow"), beforeJoint.indexOf("joint:left-elbow") + 1);
    const beforeFace = renderedStack(state);
    click({ faceId: "torso" }, []);
    assert.equal(faceId, "torso");
    assert.equal(renderedStack(state).indexOf("face:torso"), beforeFace.indexOf("face:torso") + 1);
    const beforeBack = renderedStack(state);
    click({ jointId: "left-elbow" }, ["data-drag-joint"], 2);
    assert.equal(renderedStack(state).indexOf("joint:left-elbow"), beforeBack.indexOf("joint:left-elbow") - 1);
    click({ faceId: "torso" }, [], 0, true);
    assert.equal(renderedStack(state).at(-1), "face:torso");
    click({ jointId: "left-elbow" }, ["data-drag-joint"], 2, true);
    assert.equal(renderedStack(state)[0], "joint:left-elbow");
    let menuPrevented = false;
    events.get("contextmenu")!({ preventDefault: () => { menuPrevented = true; } });
    assert.equal(menuPrevented, true);
    controller.destroy();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.assign(globalThis, { window: originalWindow });
  }
});

test("moving backward crosses exactly one item, including ties, and supports undo", () => {
  const state = new RigState(createDefaultRig());
  const before = renderedStack(state);
  const index = before.findIndex((key, i) => i > 0 && key.startsWith("joint:"));
  const [type, id] = before[index].split(":") as ["joint", string];
  state.moveBodyItemInStack(type, id, -1, false);
  const expected = [...before];
  [expected[index - 1], expected[index]] = [expected[index], expected[index - 1]];
  assert.deepEqual(renderedStack(state), expected);
  state.undo();
  assert.deepEqual(renderedStack(state), before);
  state.moveBodyItemInStack(type, id, -1, true);
  assert.deepEqual(renderedStack(state), [before[index], ...before.filter((_, i) => i !== index)]);
});

test("group ordering moves one step or to an end, handles ties and preserves item layers", () => {
  const state = new RigState(createDefaultRig());
  const groups = () => [...state.rig.groups].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((group) => group.id);
  const layers = () => state.rig.joints.map((joint) => joint.renderOrder);
  const before = groups();
  const originalLayers = layers();
  const index = before.indexOf("left-arm");
  state.moveLayerGroupInStack("left-arm", 1, false);
  const expected = [...before];
  [expected[index], expected[index + 1]] = [expected[index + 1], expected[index]];
  assert.deepEqual(groups(), expected);
  assert.deepEqual(layers(), originalLayers);
  state.undo();
  assert.deepEqual(groups(), before);
  state.redo();
  assert.deepEqual(groups(), expected);
  state.moveLayerGroupInStack("left-arm", -1, true);
  assert.equal(groups()[0], "left-arm");
  state.moveLayerGroupInStack("left-arm", 1, true);
  assert.equal(groups().at(-1), "left-arm");
});

test("group ordering handles maximum and minimum offsets", () => {
  const rig = createDefaultRig();
  rig.groups.forEach((group) => { group.order = 999; });
  const state = new RigState(rig);
  state.moveLayerGroupInStack("head", 1, true);
  const sorted = () => [...state.rig.groups].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  assert.equal(sorted().at(-1)?.id, "head");
  state.rig.groups.forEach((group) => { group.order = -999; });
  state.moveLayerGroupInStack("head", -1, true);
  assert.equal(sorted()[0].id, "head");
});
