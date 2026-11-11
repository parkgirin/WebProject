import assert from "node:assert/strict";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";

const viewState: EditorViewState = {
  outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso",
  selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
  activeTool: "select", paintColor: "#dca27b", paintPaletteId: null,
};

test("compact inspector shows every section collapsed without tabs", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });

  try {
    const element = {
      dataset: {} as Record<string, string>,
      innerHTML: "",
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    renderInspector(element, new RigState(createDefaultRig()),
      { jointId: null, axisId: null, jointIds: [] }, () => {}, viewState, () => {});

    assert.doesNotMatch(element.innerHTML, /data-inspector-tab=/);
    assert.match(element.innerHTML, /data-inspector-details="selection"/);
    assert.match(element.innerHTML, /data-inspector-details="layers"/);
    assert.match(element.innerHTML, /data-inspector-details="color"/);
    assert.equal((element.innerHTML.match(/<details /g) ?? []).length, 3);
    assert.doesNotMatch(element.innerHTML, /<details[^>]* open>/);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
