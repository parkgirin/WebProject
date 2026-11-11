import assert from "node:assert/strict";
import test from "node:test";

import { renderInspector } from "../src/editor/inspector.ts";
import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getArtShapeVertexPoint, getAxisPoint } from "../src/rig/geometry.ts";
import { interpolatePoseRig } from "../src/rig/pose-interpolation.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";
import { applyRigPreset, createRigPreset } from "../src/storage/rig-preset.ts";

test("axis length can extend beyond the joint radius for single and symmetric endpoints", () => {
  const rig = createDefaultRig();
  const joint = rig.joints.find((candidate) => candidate.id === "head")!;
  const axis = { id: "garment", angle: 90, length: joint.radius * 3, pointSides: [1] as (1 | -1)[] };
  joint.axes.push(axis);
  const state = new RigState(rig);
  const centre = state.getJoint("head");
  const point = getAxisPoint(rig, centre, axis, 1);

  assert.ok(Math.abs(Math.hypot(point.x - getAxisPoint(rig, centre, { ...axis, length: 0.0001 }, 1).x,
    point.y - getAxisPoint(rig, centre, { ...axis, length: 0.0001 }, 1).y) - axis.length) < .001);
  axis.pointSides = [-1, 1];
  assert.deepEqual(validateRig(rig), []);
});

test("polygon root vertices preserve clicked world positions and follow the model root", () => {
  const state = new RigState(createDefaultRig());
  const points = [{ x: 240, y: 300 }, { x: 360, y: 300 }, { x: 300, y: 420 }];
  const shape = state.getArtShape(state.addPolygon(points));

  assert.deepEqual(shape.vertices.map((vertex) => getArtShapeVertexPoint(state.rig, vertex)), points);
  const before = getArtShapeVertexPoint(state.rig, shape.vertices[0]);
  state.setGlobalRotation(90);
  assert.notDeepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[0]), before);
});

test("sphere shapes use one projected centre, and the default head follows its head joint", () => {
  const state = new RigState(createDefaultRig());
  const head = state.getArtShape("head-base");
  assert.equal(head.kind, "sphere");
  assert.equal(head.radius, 60);
  assert.equal(head.vertices[0].source, "joint-center");
  const before = getArtShapeVertexPoint(state.rig, head.vertices[0]);
  state.moveJoint("head", before.x + 24, before.y + 12);
  assert.deepEqual(getArtShapeVertexPoint(state.rig, head.vertices[0]), { x: before.x + 24, y: before.y + 12 });

  const sphereId = state.addSphere(160, 220, 30);
  const sphere = state.getArtShape(sphereId);
  assert.equal(sphere.kind, "sphere");
  assert.equal(sphere.vertices.length, 1);
  state.setArtShapeSphereRadius(sphereId, 50);
  assert.equal(sphere.radius, 50);
  state.undo();
  assert.equal(state.getArtShape(sphereId).radius, 30);

  const id = state.addCircle(180, 240, 32);
  const circle = state.getArtShape(id);
  assert.equal(circle.kind, "circle");
  assert.equal(circle.vertices.length, 1);
  assert.equal(circle.radiusX, 32);
  assert.equal(circle.radiusY, 32);
  state.setArtShapeCircleRadii(id, 48, 24);
  assert.equal(circle.radiusX, 48);
  assert.equal(circle.radiusY, 24);
  state.undo();
  assert.equal(state.getArtShape(id).radiusX, 32);
  assert.equal(state.getArtShape(id).radiusY, 32);
  const end = structuredClone(state.rig);
  const endCircle = end.artShapes!.find((shape) => shape.id === id)!;
  endCircle.radiusX = 64;
  endCircle.radiusY = 16;
  const middle = interpolatePoseRig(state.rig, end, .5).artShapes!.find((shape) => shape.id === id)!;
  assert.equal(middle.radiusX, 48);
  assert.equal(middle.radiusY, 24);
  assert.deepEqual(validateRig(state.rig), []);
});

test("legacy default head circles migrate to sphere shapes", () => {
  const rig = createDefaultRig();
  const head = rig.artShapes!.find((shape) => shape.id === "head-base")!;
  head.kind = "circle";
  head.radiusX = 54;
  head.radiusY = 60;
  delete head.radius;

  const state = new RigState(rig);
  const migrated = state.getArtShape("head-base");
  assert.equal(migrated.kind, "sphere");
  assert.equal(migrated.radius, 60);
  assert.equal(migrated.radiusX, undefined);
  assert.equal(migrated.radiusY, undefined);
});

test("sphere art shapes render as camera-facing circles", () => {
  const state = new RigState(createDefaultRig());
  state.setJointZ("head", 40);
  state.setViewYRotation(55);
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: false, selectedFaceId: "neck",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };

  renderSvgEditor(host, state.rig, { jointId: "head", axisId: null, jointIds: ["head"] }, viewState);
  assert.match(host.innerHTML, /<circle[^>]+data-shape-id="head-base"[^>]+data-art-sphere/);
  assert.doesNotMatch(host.innerHTML, /<ellipse[^>]+data-shape-id="head-base"/);
});

test("sphere art shapes use camera-space depth when the view rotates", () => {
  const state = new RigState(createDefaultRig());
  const leftId = state.addSphere(200, 300, 30);
  const rightId = state.addSphere(400, 300, 30);
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };
  const spherePosition = (id: string) => host.innerHTML.indexOf(`data-shape-id="${id}" data-art-sphere`);

  state.setViewYRotation(90);
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(spherePosition(rightId) < spherePosition(leftId), "right sphere is camera-farther at +90°");

  state.setViewYRotation(-90);
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(spherePosition(leftId) < spherePosition(rightId), "left sphere is camera-farther at -90°");
});

test("axis-point polygon vertices follow an extended endpoint while retaining local offsets", () => {
  const state = new RigState(createDefaultRig());
  const head = state.getJoint("head");
  const axisId = state.addAxis(head.id);
  const axis = head.axes.find((candidate) => candidate.id === axisId)!;
  state.setAxisLength(head.id, axis.id, 90);
  const endpoint = getAxisPoint(state.rig, head, axis, 1);
  const shape = state.getArtShape(state.addPolygon([
    { ...endpoint, axisPoint: { jointId: head.id, axisId: axis.id, side: 1 } },
    { x: endpoint.x + 50, y: endpoint.y + 50 },
    { x: endpoint.x - 50, y: endpoint.y + 50 },
  ]));

  assert.deepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[0]), endpoint);
  state.moveArtShapeVertex(shape.id, shape.vertices[0].id, endpoint.x + 10, endpoint.y + 5);
  assert.equal(shape.vertices[0].source, "axis-point");
  assert.deepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[0]), { x: endpoint.x + 10, y: endpoint.y + 5 });
});

test("compatible polygon vertices and colors interpolate without changing their bindings", () => {
  const start = createDefaultRig();
  const state = new RigState(start);
  const shape = state.getArtShape(state.addPolygon([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]));
  shape.color = "#000000";
  const end = structuredClone(start);
  const endShape = end.artShapes!.find((candidate) => candidate.id === shape.id)!;
  const endVertex = endShape.vertices[0];
  if (endVertex.source !== "root") throw new Error("Expected root vertex");
  endVertex.x += 20;
  endShape.color = "#ffffff";

  const middle = interpolatePoseRig(start, end, .5).artShapes!.find((candidate) => candidate.id === shape.id)!;
  const middleVertex = middle.vertices[0];
  assert.equal(middleVertex.source, "root");
  if (middleVertex.source === "root" && shape.vertices[0].source === "root") assert.equal(middleVertex.x, shape.vertices[0].x + 10);
  assert.equal(middle.color, "#bcbcbc");
});

test("presets round-trip polygon geometry and axis bindings", () => {
  const source = new RigState(createDefaultRig());
  const head = source.getJoint("head");
  const axisId = source.addAxis(head.id);
  const axis = head.axes.find((candidate) => candidate.id === axisId)!;
  const endpoint = getAxisPoint(source.rig, head, axis, 1);
  const polygonId = source.addPolygon([
    { ...endpoint, axisPoint: { jointId: head.id, axisId: axis.id, side: 1 } },
    { x: endpoint.x + 20, y: endpoint.y + 30 },
    { x: endpoint.x - 20, y: endpoint.y + 30 },
  ]);
  source.createArtShapeCompositeGroup(["head-base", polygonId]);
  const preset = createRigPreset(source.rig, { pose: true, proportions: true, colors: true, shapes: true });
  const target = new RigState(createDefaultRig());

  assert.deepEqual(applyRigPreset(target, preset, { pose: false, proportions: false, colors: false, shapes: true }), ["도형"]);
  assert.deepEqual(target.rig.artShapes, source.rig.artShapes);
  assert.deepEqual(target.rig.artCompositeGroups, source.rig.artCompositeGroups);
});

test("polygon vertices can be inserted and removed without dropping below three points", () => {
  const state = new RigState(createDefaultRig());
  const shape = state.getArtShape(state.addPolygon([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 90 }]));
  const insertedId = state.insertArtShapeVertex(shape.id, shape.vertices[0].id, 50, 10);

  assert.equal(shape.vertices.length, 4);
  assert.equal(shape.vertices[1].id, insertedId);
  assert.deepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[1]), { x: 50, y: 10 });
  assert.equal(state.removeArtShapeVertex(shape.id, insertedId), shape.vertices[1].id);
  assert.equal(shape.vertices.length, 3);
  assert.throws(() => state.removeArtShapeVertex(shape.id, shape.vertices[0].id), /최소 3개/);
});

test("an existing polygon vertex can bind, snap and unbind while preserving the requested position", () => {
  const state = new RigState(createDefaultRig());
  const shape = state.getArtShape(state.addPolygon([{ x: 210, y: 210 }, { x: 290, y: 210 }, { x: 250, y: 290 }]));
  const vertex = shape.vertices[0];
  const original = getArtShapeVertexPoint(state.rig, vertex);
  const head = state.getJoint("head");
  const axisId = state.addAxis(head.id);
  const axis = head.axes.find((candidate) => candidate.id === axisId)!;

  state.bindArtShapeVertexToAxis(shape.id, vertex.id, head.id, axis.id, 1, false);
  assert.deepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[0]), original);
  assert.equal(shape.vertices[0].source, "axis-point");

  state.bindArtShapeVertexToAxis(shape.id, vertex.id, head.id, axis.id, 1, true);
  assert.deepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[0]), getAxisPoint(state.rig, head, axis, 1));
  state.unbindArtShapeVertex(shape.id, vertex.id);
  assert.equal(shape.vertices[0].source, "root");
  assert.deepEqual(getArtShapeVertexPoint(state.rig, shape.vertices[0]), getAxisPoint(state.rig, head, axis, 1));
});

test("new art axes expose configurable endpoints and protect endpoints used by polygons", () => {
  const state = new RigState(createDefaultRig());
  const head = state.getJoint("right-hip");
  assert.equal(head.axes.length, 1);
  const axisId = state.addAxis(head.id);
  const axis = head.axes.find((candidate) => candidate.id === axisId)!;
  assert.equal(head.axes.length, 2);
  assert.deepEqual(axis.pointSides, [-1, 1]);
  assert.equal(axis.length, head.radius);

  state.setAxisPointSides(head.id, axis.id, [1]);
  const endpoint = getAxisPoint(state.rig, head, axis, 1);
  const shapeId = state.addPolygon([
    { ...endpoint, axisPoint: { jointId: head.id, axisId: axis.id, side: 1 } },
    { x: endpoint.x + 20, y: endpoint.y + 30 },
    { x: endpoint.x - 20, y: endpoint.y + 30 },
  ]);
  assert.ok(shapeId);
  assert.throws(() => state.setAxisPointSides(head.id, axis.id, [-1]), /사용하는 축 끝점/);

  const preset = createRigPreset(state.rig, { pose: false, proportions: false, colors: false, shapes: true });
  const restored = new RigState(createDefaultRig());
  applyRigPreset(restored, preset, { pose: false, proportions: false, colors: false, shapes: true });
  assert.ok(restored.getJoint(head.id).axes.some((candidate) => candidate.id === axis.id));
  assert.equal(restored.rig.artShapes?.find((shape) => shape.id === shapeId)?.vertices[0].source, "axis-point");
});

test("a procedural body face can be promoted to a root-bound art polygon", () => {
  const state = new RigState(createDefaultRig());
  const face = state.getFace("torso");
  face.color = "#123456";
  const shape = state.getArtShape(state.addArtShapeFromFace(face.id));

  assert.equal(shape.kind, "polygon");
  assert.equal(shape.color, face.color);
  assert.equal(shape.groupId, face.groupId);
  assert.equal(shape.layerOrder, state.getFaceLayerOrder(face.id) + 1);
  assert.equal(shape.vertices.length, 4);
  assert.ok(shape.vertices.every((vertex) => vertex.source === "root"));
});

test("thick line segments retain endpoint bindings and interpolate their width", () => {
  const start = createDefaultRig();
  const state = new RigState(start);
  const head = state.getJoint("head");
  const axisId = state.addAxis(head.id);
  const axis = head.axes.find((candidate) => candidate.id === axisId)!;
  const endpoint = getAxisPoint(state.rig, head, axis, 1);
  const line = state.getArtShape(state.addLine([
    { ...endpoint, axisPoint: { jointId: head.id, axisId: axis.id, side: 1 } },
    { x: endpoint.x + 80, y: endpoint.y + 20 },
  ], 12));
  assert.equal(line.kind, "line");
  assert.equal(line.vertices.length, 2);
  assert.equal(line.strokeWidth, 12);
  assert.equal(line.vertices[0].source, "axis-point");

  const end = structuredClone(start);
  end.artShapes!.find((candidate) => candidate.id === line.id)!.strokeWidth = 28;
  const middle = interpolatePoseRig(start, end, .5).artShapes!.find((candidate) => candidate.id === line.id)!;
  assert.equal(middle.strokeWidth, 20);
  state.setArtShapeStrokeWidth(line.id, 18);
  assert.equal(line.strokeWidth, 18);
  assert.deepEqual(validateRig(state.rig), []);
});

test("joint, axis, face and art-shape layers toggle their categories as a batch", () => {
  const state = new RigState(createDefaultRig());
  const shape = state.getArtShape(state.addPolygon([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 90 }]));
  state.setElementLayerVisibility("joints", false);
  state.setElementLayerVisibility("axes", false);
  state.setElementLayerVisibility("faces", false);
  state.setElementLayerVisibility("shapes", false);
  state.setArtShapeGroup(shape.id, "head");
  state.setArtShapeLayerOrder(shape.id, 77);

  assert.deepEqual(state.rig.elementLayers, { joints: false, axes: false, faces: false, shapes: false });
  assert.equal(shape.groupId, "head");
  assert.equal(shape.layerOrder, 77);
  assert.deepEqual(validateRig(state.rig), []);
});

test("legacy art shapes remain valid without composite metadata and new shapes default to paint", () => {
  const rig = createDefaultRig();
  delete rig.artShapes![0].compositeMode;
  delete rig.artShapes![0].compositeGroupId;

  assert.deepEqual(validateRig(rig), []);
  const state = new RigState(rig);
  const shape = state.getArtShape(state.addPolygon([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 90 }]));
  assert.equal(shape.compositeMode, "paint");
  assert.equal(shape.compositeGroupId, `composite-${shape.id}`);
});

test("paint and cutout shapes can share a composite group while lines cannot become cutouts", () => {
  const state = new RigState(createDefaultRig());
  const paint = state.getArtShape(state.addCircle(300, 300, 80));
  const cutout = state.getArtShape(state.addCircle(300, 300, 36));
  state.setArtShapeGroup(cutout.id, "head");
  state.setArtShapeComposite(paint.id, "paint", "donut");
  state.setArtShapeComposite(cutout.id, "cutout", "donut");

  assert.equal(paint.compositeGroupId, "donut");
  assert.equal(cutout.compositeMode, "cutout");
  assert.equal(cutout.groupId, "head");
  assert.deepEqual(validateRig(state.rig), []);

  const lineId = state.addLine([{ x: 10, y: 10 }, { x: 90, y: 90 }], 12);
  assert.throws(() => state.setArtShapeComposite(lineId, "cutout", "donut"), /선분/);
  assert.doesNotThrow(() => state.setArtShapeComposite(lineId, "overlay", "donut"));
});

test("overlay paints its own color inside the accumulated shape without shrinking the result", () => {
  const state = new RigState(createDefaultRig());
  const base = state.addCircle(300, 300, 80);
  const pattern = state.addCircle(350, 300, 50);
  state.paintArtShapeWithColor(base, "#552211");
  state.paintArtShapeWithColor(pattern, "#ffee00");
  state.setArtShapeComposite(base, "paint", "pants");
  state.setArtShapeComposite(pattern, "overlay", "pants");
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };

  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(host.innerHTML, /id="art-composite-overlay-clip-/);
  assert.match(host.innerHTML, new RegExp(`data-shape-id="${base}"[\\s\\S]*mask="url\\(#art-composite-overlay-clip-[^"]+\\)"[\\s\\S]*data-shape-id="${pattern}"`));
  assert.equal(state.getArtShape(pattern).compositeMode, "overlay");
  assert.deepEqual(validateRig(state.rig), []);
});

test("the SVG renderer masks only earlier paint shapes in the same composite group", () => {
  const state = new RigState(createDefaultRig());
  const painted = state.getArtShape(state.addCircle(300, 300, 80));
  const unrelated = state.getArtShape(state.addCircle(300, 300, 70));
  const cutout = state.getArtShape(state.addCircle(300, 300, 30));
  state.setArtShapeComposite(painted.id, "paint", "donut");
  state.setArtShapeComposite(cutout.id, "cutout", "donut");
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };

  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/id="art-composite-subtract-/g)?.length, 1);
  assert.match(host.innerHTML, new RegExp(`data-shape-id="${painted.id}"`));
  assert.match(host.innerHTML, new RegExp(`data-shape-id="${unrelated.id}"`));
  assert.match(host.innerHTML, new RegExp(`class="body-art-cutout-guide" data-shape-id="${cutout.id}"`));
});

test("paint shapes in one composite group render only their shared intersection", () => {
  const state = new RigState(createDefaultRig());
  const first = state.addCircle(270, 300, 60);
  const second = state.addCircle(330, 300, 60);
  const groupId = state.createArtShapeCompositeGroup([first, second, first]);
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedShapeIds: [first, second], selectedTarget: "joint", inspectorTab: "selection",
    editBodyProportions: false, moveSelectedIndividually: false, activeTool: "select",
    paintColor: "#000000", paintPaletteId: null,
  };

  assert.equal(state.getArtShape(first).compositeGroupId, groupId);
  assert.equal(state.getArtShape(second).compositeGroupId, groupId);
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(host.innerHTML, /mask="url\(#art-shape-mask-[0-9]+\)"/);
  assert.match(host.innerHTML, /id="art-composite-result-/);

  state.undo();
  assert.notEqual(state.getArtShape(first).compositeGroupId, state.getArtShape(second).compositeGroupId);
});

test("a composite group requires at least two selected shapes", () => {
  const state = new RigState(createDefaultRig());
  assert.throws(() => state.createArtShapeCompositeGroup(["head-base"]), /2개 이상/);
});

test("nested composite groups preserve child groups and apply their results in order", () => {
  const state = new RigState(createDefaultRig());
  const first = state.addCircle(260, 300, 70);
  const second = state.addCircle(280, 300, 60);
  const third = state.addCircle(320, 300, 50);
  const fourth = state.addCircle(340, 300, 40);
  const firstGroup = state.createArtShapeCompositeGroup([first, second]);
  const secondGroup = state.createArtShapeCompositeGroup([third, fourth]);
  const parent = state.createNestedArtCompositeGroup([first, second, third, fourth]);
  state.setArtCompositeGroupMode(secondGroup, "cutout");

  assert.equal(state.rig.artCompositeGroups?.find((group) => group.id === firstGroup)?.parentGroupId, parent);
  assert.equal(state.rig.artCompositeGroups?.find((group) => group.id === secondGroup)?.parentGroupId, parent);
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };
  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(host.innerHTML, /id="art-composite-subtract-/);
  assert.ok((host.innerHTML.match(/id="art-composite-result-/g)?.length ?? 0) >= 3);
  assert.deepEqual(validateRig(state.rig), []);
});

test("a nested child group can overlay its composed result across group boundaries", () => {
  const state = new RigState(createDefaultRig());
  const base = state.addCircle(280, 300, 80);
  const baseLimit = state.addCircle(300, 300, 80);
  const patch = state.addCircle(330, 300, 45);
  const patchLimit = state.addCircle(350, 300, 45);
  const baseGroup = state.createArtShapeCompositeGroup([base, baseLimit]);
  const patchGroup = state.createArtShapeCompositeGroup([patch, patchLimit]);
  const parent = state.createNestedArtCompositeGroup([base, baseLimit, patch, patchLimit]);
  state.setArtCompositeGroupMode(patchGroup, "overlay");
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };

  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.equal(state.rig.artCompositeGroups?.find((group) => group.id === baseGroup)?.parentGroupId, parent);
  assert.equal(state.rig.artCompositeGroups?.find((group) => group.id === patchGroup)?.compositeMode, "overlay");
  assert.match(host.innerHTML, /id="art-composite-overlay-clip-/);
  assert.deepEqual(validateRig(state.rig), []);
});

test("nested grouping rejects partial child-group selections", () => {
  const state = new RigState(createDefaultRig());
  const first = state.addCircle(200, 200, 20);
  const second = state.addCircle(220, 200, 20);
  const third = state.addCircle(300, 200, 20);
  state.createArtShapeCompositeGroup([first, second]);
  assert.throws(() => state.createNestedArtCompositeGroup([first, third]), /모든 도형/);
});

test("composite operations follow layer order instead of refilling an earlier cutout", () => {
  const state = new RigState(createDefaultRig());
  const base = state.addCircle(300, 300, 90);
  const hole = state.addCircle(300, 300, 45);
  const finalIntersection = state.addCircle(320, 300, 70);
  state.setArtShapeComposite(base, "paint", "ordered");
  state.setArtShapeComposite(hole, "cutout", "ordered");
  state.setArtShapeComposite(finalIntersection, "paint", "ordered");
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedTarget: "joint", inspectorTab: "selection", editBodyProportions: false,
    moveSelectedIndividually: false, activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };

  renderSvgEditor(host, state.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(host.innerHTML, new RegExp(`<g mask="url\\(#art-shape-mask-[0-9]+\\)">\\s*<g mask="url\\(#art-composite-subtract-[^"]+\\)">[\\s\\S]*data-shape-id="${base}"`));
});

test("multiple selected shapes move and delete as single undoable keyboard operations", () => {
  const state = new RigState(createDefaultRig());
  const firstId = state.addCircle(200, 200, 20);
  const secondId = state.addCircle(300, 300, 20);
  const before = [firstId, secondId].map((id) => getArtShapeVertexPoint(state.rig, state.getArtShape(id).vertices[0]));

  state.moveArtShapes([firstId, secondId, firstId], 10, -4);
  assert.deepEqual([firstId, secondId].map((id) => getArtShapeVertexPoint(state.rig, state.getArtShape(id).vertices[0])),
    before.map((point) => ({ x: point.x + 10, y: point.y - 4 })));
  state.undo();
  assert.deepEqual([firstId, secondId].map((id) => getArtShapeVertexPoint(state.rig, state.getArtShape(id).vertices[0])), before);

  state.removeArtShapes([firstId, secondId]);
  assert.equal(state.rig.artShapes?.some((shape) => shape.id === firstId || shape.id === secondId), false);
  state.undo();
  assert.ok(state.rig.artShapes?.some((shape) => shape.id === firstId));
  assert.ok(state.rig.artShapes?.some((shape) => shape.id === secondId));
});

test("the inspector deletes every selected shape as one undoable operation", () => {
  const state = new RigState(createDefaultRig());
  const first = state.addCircle(180, 200, 20);
  const second = state.addCircle(240, 200, 20);
  const groupId = state.createArtShapeCompositeGroup([first, second]);
  let click: (() => void) | undefined;
  let viewUpdate: Partial<EditorViewState> | undefined;
  const deleteButton = { addEventListener: (event: string, handler: () => void) => {
    if (event === "click") click = handler;
  } };
  const element = {
    innerHTML: "",
    querySelector: (selector: string) => selector === "[data-delete-shape]" ? deleteButton : null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
  const viewState: EditorViewState = {
    outlinesVisible: false, hideSameJointEdges: false, selectedFaceId: "torso",
    selectedShapeId: second, selectedShapeIds: [first, second], selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, moveSelectedIndividually: false,
    activeTool: "select", paintColor: "#000000", paintPaletteId: null,
  };

  renderInspector(element, state, { jointId: null, axisId: null, jointIds: [] }, () => {}, viewState,
    (next) => { viewUpdate = next; });
  assert.match(element.innerHTML, /선택 도형 2개 삭제/);
  click!();
  assert.equal(state.rig.artShapes?.some((shape) => shape.id === first || shape.id === second), false);
  assert.equal(state.rig.artCompositeGroups?.some((group) => group.id === groupId), false);
  assert.deepEqual(viewUpdate?.selectedShapeIds, []);
  state.undo();
  assert.ok(state.rig.artShapes?.some((shape) => shape.id === first));
  assert.ok(state.rig.artShapes?.some((shape) => shape.id === second));
  assert.ok(state.rig.artCompositeGroups?.some((group) => group.id === groupId));
});

test("duplicating selected shapes preserves their internal composite group without joining the originals", () => {
  const state = new RigState(createDefaultRig());
  const firstId = state.addCircle(200, 200, 20);
  const secondId = state.addCircle(220, 200, 20);
  const originalGroup = state.createArtShapeCompositeGroup([firstId, secondId]);
  const copyIds = state.duplicateArtShapes([firstId, secondId]);

  assert.equal(copyIds.length, 2);
  const copyGroups = copyIds.map((id) => state.getArtShape(id).compositeGroupId);
  assert.equal(copyGroups[0], copyGroups[1]);
  assert.notEqual(copyGroups[0], originalGroup);
  assert.equal(state.getArtShape(copyIds[0]).layerOrder, state.getArtShape(firstId).layerOrder + 1);
  state.undo();
  assert.equal(state.rig.artShapes?.some((shape) => copyIds.includes(shape.id)), false);
});

test("duplicating nested groups copies the hierarchy without linking back to the originals", () => {
  const state = new RigState(createDefaultRig());
  const first = state.addCircle(180, 200, 30);
  const second = state.addCircle(200, 200, 25);
  const third = state.addCircle(280, 200, 30);
  const fourth = state.addCircle(300, 200, 25);
  const firstGroup = state.createArtShapeCompositeGroup([first, second]);
  const secondGroup = state.createArtShapeCompositeGroup([third, fourth]);
  const parent = state.createNestedArtCompositeGroup([first, second, third, fourth]);
  state.setArtCompositeGroupMode(secondGroup, "cutout");

  const copies = state.duplicateArtShapes([first, second, third, fourth]);
  const copiedDirectGroups = [...new Set(copies.map((id) => state.getArtShape(id).compositeGroupId!))];
  const copiedDefinitions = copiedDirectGroups.map((id) => state.rig.artCompositeGroups!.find((group) => group.id === id)!);
  assert.equal(copiedDirectGroups.length, 2);
  assert.ok(copiedDefinitions.every((group) => group.parentGroupId && group.parentGroupId !== parent));
  assert.equal(new Set(copiedDefinitions.map((group) => group.parentGroupId)).size, 1);
  assert.equal(copiedDefinitions.find((group) => group.id.startsWith(`${secondGroup}-copy`))?.compositeMode, "cutout");
  assert.ok(copiedDefinitions.every((group) => group.id !== firstGroup && group.id !== secondGroup));
});
