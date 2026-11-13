import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState } from "../src/rig/rig-state.ts";
import { applyUserBodyPreset } from "../src/presets/body-presets.ts";
import { parseBodyPresetModules } from "../src/presets/preset-catalog-core.ts";

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

test("a non-human rig uses its own joints in the pose navigator", () => {
  const path = new URL("../src/presets/data/body/사족동물-기본체.json", import.meta.url);
  const [preset] = parseBodyPresetModules({
    "./data/body/사족동물-기본체.json": JSON.parse(readFileSync(path, "utf8")),
  });
  const state = new RigState(createDefaultRig());
  applyUserBodyPreset(state, preset);
  const element = {
    dataset: {} as Record<string, string>,
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;

  renderInspector(element, state,
    { jointId: "pelvis", axisId: null, jointIds: ["pelvis"] }, () => {},
    { ...viewState, selectedFaceId: "rear-spine" }, () => {});

  assert.match(element.innerHTML, /data-joint-shortcut="tail-tip"/);
  assert.match(element.innerHTML, /data-joint-shortcut="front-left-paw"/);
  assert.doesNotMatch(element.innerHTML, /data-joint-shortcut="left-shoulder"/);
});

test("the human pose navigator follows current projected joint positions", () => {
  const state = new RigState(createDefaultRig());
  const element = {
    dataset: {} as Record<string, string>, innerHTML: "",
    querySelector: () => null, querySelectorAll: () => [],
  } as unknown as HTMLElement;
  const render = (navigator: Partial<EditorViewState> = {}) => renderInspector(element, state,
    { jointId: "head", axisId: null, jointIds: ["head"] }, () => {}, { ...viewState, ...navigator }, () => {});
  const headPosition = () => element.innerHTML.match(
    /style="--x:([^;]+)px;--y:([^;]+)px" data-joint-shortcut="head"/,
  )?.slice(1).join(",");

  render();
  const before = headPosition();
  render({ poseNavigatorMode: "rest" });
  const restBefore = headPosition();
  state.getJoint("head").x += 36;
  render();
  const current = headPosition();

  assert.ok(before);
  assert.ok(restBefore);
  assert.notEqual(current, before);
  render({ poseNavigatorMode: "rest" });
  assert.equal(headPosition(), restBefore);
  assert.match(element.innerHTML, /data-pose-navigator-mode/);
  assert.match(element.innerHTML, /data-pose-navigator-rotate="-30"/);
  assert.match(element.innerHTML, /data-pose-navigator-rotate="30"/);
  assert.match(element.innerHTML, /data-joint-shortcut="left-shoulder"/);
});

test("the pose navigator applies only its own Y rotation in 30 degree steps", () => {
  const state = new RigState(createDefaultRig());
  state.getJoint("head").z = 40;
  const element = {
    dataset: {} as Record<string, string>, innerHTML: "",
    querySelector: () => null, querySelectorAll: () => [],
  } as unknown as HTMLElement;

  renderInspector(element, state,
    { jointId: "head", axisId: null, jointIds: ["head"] }, () => {},
    { ...viewState, poseNavigatorMode: "current", poseNavigatorYRotation: 30 }, () => {});

  assert.match(element.innerHTML, /현재 상태 · Y 30°/);
  assert.match(element.innerHTML, /<output[^>]*>Y 30°<\/output>/);
});

test("the face shortcut lists only faces connected to the selected joints", () => {
  const state = new RigState(createDefaultRig());
  const element = {
    dataset: {} as Record<string, string>, innerHTML: "",
    querySelector: () => null, querySelectorAll: () => [],
  } as unknown as HTMLElement;

  renderInspector(element, state,
    { jointId: "right-elbow", axisId: null, jointIds: ["right-elbow"] }, () => {},
    viewState, () => {});

  const faceSelect = element.innerHTML.match(/<select class="pose-face-shortcut[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.match(faceSelect, /right-upper-arm/);
  assert.match(faceSelect, /right-lower-arm/);
  assert.doesNotMatch(faceSelect, /left-upper-arm/);
  assert.doesNotMatch(faceSelect, />연결 면: torso</);
  assert.match(element.innerHTML, /선택 관절 연결 면 2개/);
});
