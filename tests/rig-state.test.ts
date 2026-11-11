import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { DEFAULT_AVATAR_PRESET_ID, getAvatarProportionPreset } from "../src/presets/avatar-presets.ts";
import { getArtShapeVertexPoint, getAxisWorldAngle, getJointParentWorldTransform, getJointViewRadius, getJointWorldTransform, getProjectionScale, projectPoint, unprojectPoint } from "../src/rig/geometry.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";

const closeTo = (actual: number, expected: number, message?: string) => {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);
};

test("the default rig satisfies all structural constraints", () => {
  assert.deepEqual(validateRig(createDefaultRig()), []);
});

test("depth projection scales around the canvas centre and remains invertible", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 50;
  assert.equal(getProjectionScale(rig, 40), 1.2);
  const projected = projectPoint(rig, { x: 400, y: 500 }, 40);
  closeTo(projected.x, 420);
  closeTo(projected.y, 522);
  assert.deepEqual(unprojectPoint(rig, projected, 40), { x: 400, y: 500 });
});

test("perspective can be disabled without disabling camera rotation", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 100;
  rig.perspectiveEnabled = false;
  assert.equal(getProjectionScale(rig, 80), 1);
  assert.deepEqual(projectPoint(rig, { x: 400, y: 500 }, 80), { x: 400, y: 500 });

  rig.viewYRotation = 90;
  const rotated = projectPoint(rig, { x: 400, y: 500 }, 80);
  closeTo(rotated.x, 380);
  closeTo(rotated.y, 500);
});

test("Y-axis view rotation interpolates X into depth and remains invertible", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 0;
  rig.viewYRotation = 60;
  const projected = projectPoint(rig, { x: 400, y: 500 }, 0);
  closeTo(projected.x, 350);
  closeTo(projected.y, 500);
  const restored = unprojectPoint(rig, projected, 0);
  closeTo(restored.x, 400);
  closeTo(restored.y, 500);
});

test("side view uses pure X/Z rotation without silhouette retention", () => {
  const rig = createDefaultRig();
  rig.projectionStrength = 0;
  rig.viewYRotation = 90;
  const left = projectPoint(rig, { x: 200, y: 390 }, 0);
  const right = projectPoint(rig, { x: 400, y: 390 }, 0);
  closeTo(right.x - left.x, 0);
});

test("side radius interpolates from front to side without mutating the base rig", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  waist.sideRadius = 24;
  rig.viewYRotation = 45;
  assert.equal(waist.radius, getAvatarProportionPreset(DEFAULT_AVATAR_PRESET_ID)!.armRadius);
  assert.equal(getJointViewRadius(rig, waist), 27);
  rig.viewYRotation = 90;
  assert.equal(getJointViewRadius(rig, waist), 24);
});

test("legacy waist width migrates to a side-sized capsule radius without changing its front width", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  waist.radius = 60;
  waist.surfaceScale = { x: 1, y: 1, z: .5 };
  waist.capsuleFlatAxes = ["x"];
  waist.capsuleFlatLengths = { x: 60 };

  const state = new RigState(rig);
  const migrated = state.getJoint("waist");
  assert.equal(migrated.radius, 30);
  assert.deepEqual(migrated.surfaceScale, { x: 1, y: 1, z: 1 });
  assert.equal(migrated.capsuleFlatLengths?.x, 60);
  assert.equal(migrated.radius + migrated.capsuleFlatLengths!.x! / 2, 60);
});

test("legacy stock shoulders migrate to outward capsules without moving the current arm pose", () => {
  const rig = createDefaultRig();
  const elbowBefore = structuredClone(rig.joints.find((joint) => joint.id === "left-elbow")!);
  delete rig.joints.find((joint) => joint.id === "left-elbow")!.parentAnchor;
  delete rig.joints.find((joint) => joint.id === "right-elbow")!.parentAnchor;
  for (const id of ["left-shoulder", "right-shoulder"]) {
    const shoulder = rig.joints.find((joint) => joint.id === id)!;
    delete shoulder.surfaceProfileId;
    delete shoulder.surfaceScale;
    delete shoulder.capsuleFlatAxes;
    delete shoulder.capsuleFlatLengths;
    delete shoulder.capsuleFlatAlignment;
  }
  const before = rig.joints
    .filter((joint) => joint.id.endsWith("shoulder"))
    .map((joint) => ({ id: joint.id, x: joint.x, y: joint.y }));

  const state = new RigState(rig);

  for (const shoulder of rig.joints.filter((joint) => joint.id.endsWith("shoulder"))) {
    assert.equal(shoulder.surfaceProfileId, "rounded-rect");
    assert.deepEqual(shoulder.capsuleFlatAxes, ["x"]);
    assert.equal(shoulder.capsuleFlatLengths?.x, shoulder.radius);
    assert.equal(shoulder.capsuleFlatAlignment, "peer-outward");
  }
  assert.deepEqual(rig.joints
    .filter((joint) => joint.id.endsWith("shoulder"))
    .map((joint) => ({ id: joint.id, x: joint.x, y: joint.y })), before);
  const elbowAfter = state.getJoint("left-elbow");
  assert.deepEqual(elbowAfter.parentAnchor, { type: "capsule-end", role: "outer" });
  assert.equal(elbowAfter.x - state.getJoint("left-shoulder").radius, elbowBefore.x);
  assert.equal(elbowAfter.y, elbowBefore.y);
});

test("shoulder capsule length moves only the anchored arm while keeping torso width", () => {
  const state = new RigState(createDefaultRig());
  const shoulderBefore = getJointWorldTransform(state.rig, "left-shoulder");
  const elbowBefore = getJointWorldTransform(state.rig, "left-elbow");
  const wristBefore = getJointWorldTransform(state.rig, "left-wrist");
  const rightElbowBefore = getJointWorldTransform(state.rig, "right-elbow");
  const peerDistance = state.getPeerGroupDistance("shoulder-band");
  const localElbow = { x: state.getJoint("left-elbow").x, y: state.getJoint("left-elbow").y };

  state.setJointCapsuleFlatLength("left-shoulder", "x", 60);

  const shoulderAfter = getJointWorldTransform(state.rig, "left-shoulder");
  const elbowAfter = getJointWorldTransform(state.rig, "left-elbow");
  const wristAfter = getJointWorldTransform(state.rig, "left-wrist");
  assert.deepEqual(shoulderAfter, shoulderBefore);
  assert.equal(state.getPeerGroupDistance("shoulder-band"), peerDistance);
  assert.deepEqual({ x: state.getJoint("left-elbow").x, y: state.getJoint("left-elbow").y }, localElbow);
  closeTo(elbowAfter.x, elbowBefore.x - 30);
  closeTo(elbowAfter.y, elbowBefore.y);
  closeTo(wristAfter.x, wristBefore.x - 30);
  closeTo(wristAfter.y, wristBefore.y);
  assert.deepEqual(getJointWorldTransform(state.rig, "right-elbow"), rightElbowBefore);
});

test("joint depth and projection strength are bounded and undoable", () => {
  const state = new RigState(createDefaultRig());
  state.setPerspectiveEnabled(false);
  state.setJointZ("head", 200);
  state.setProjectionStrength(-1);
  state.setViewYRotation(240);
  assert.equal(state.getJoint("head").z, 100);
  assert.equal(state.rig.projectionStrength, 0);
  assert.equal(state.rig.viewYRotation, 180);
  state.undo();
  assert.equal(state.rig.viewYRotation, 0);
  state.undo();
  state.undo();
  state.undo();
  assert.equal(state.rig.perspectiveEnabled, true);
});

test("validation reports broken references, duplicate axes, and parent cycles", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  const chest = rig.joints.find((joint) => joint.id === "chest")!;
  waist.parentJointId = "chest";
  chest.parentJointId = "waist";
  waist.axes.push({ ...waist.axes[0], pointSides: [...waist.axes[0].pointSides] });
  rig.faces[0].vertices = [{ jointId: "head", axisId: "missing-axis", side: 1 }];

  const errors = validateRig(rig);

  assert.ok(errors.some((error) => error.startsWith("Parent cycle:")));
  assert.ok(errors.some((error) => error === "Duplicate axis id: waist.upper-torso"));
  assert.ok(errors.some((error) => error.includes("references unknown axis")));
});

test("rotating a child connection moves its descendant subtree and leaves the opposite limb unchanged", () => {
  const state = new RigState(createDefaultRig());
  const shoulder = getJointParentWorldTransform(state.rig, "left-elbow")!;
  const elbowBefore = getJointWorldTransform(state.rig, "left-elbow");
  const wristBefore = getJointWorldTransform(state.rig, "left-wrist");
  const rightElbowBefore = getJointWorldTransform(state.rig, "right-elbow");
  const upperArmLength = Math.hypot(elbowBefore.x - shoulder.x, elbowBefore.y - shoulder.y);
  const lowerArmLength = Math.hypot(wristBefore.x - elbowBefore.x, wristBefore.y - elbowBefore.y);

  state.rotateChildAroundParent("left-elbow", 0);

  const elbowAfter = getJointWorldTransform(state.rig, "left-elbow");
  const wristAfter = getJointWorldTransform(state.rig, "left-wrist");
  const rightElbowAfter = getJointWorldTransform(state.rig, "right-elbow");
  closeTo(elbowAfter.x, shoulder.x + upperArmLength);
  closeTo(elbowAfter.y, shoulder.y);
  closeTo(Math.hypot(wristAfter.x - elbowAfter.x, wristAfter.y - elbowAfter.y), lowerArmLength);
  closeTo(wristAfter.x, elbowAfter.x + lowerArmLength);
  closeTo(wristAfter.y, elbowAfter.y);
  assert.deepEqual(rightElbowAfter, rightElbowBefore);
});

test("independent joint movement keeps direct children at their current world positions", () => {
  const state = new RigState(createDefaultRig());
  const waist = getJointWorldTransform(state.rig, "waist");
  const chest = getJointWorldTransform(state.rig, "chest");
  const head = getJointWorldTransform(state.rig, "head");

  state.moveJointIndependently("waist", waist.x + 30, waist.y + 20);

  const movedWaist = getJointWorldTransform(state.rig, "waist");
  const chestAfter = getJointWorldTransform(state.rig, "chest");
  const headAfter = getJointWorldTransform(state.rig, "head");
  closeTo(movedWaist.x, waist.x + 30);
  closeTo(movedWaist.y, waist.y + 20);
  closeTo(chestAfter.x, chest.x);
  closeTo(chestAfter.y, chest.y);
  closeTo(headAfter.x, head.x);
  closeTo(headAfter.y, head.y);
});

test("changing a parent preserves world pose and rejects cyclic parenting", () => {
  const state = new RigState(createDefaultRig());
  const before = getJointWorldTransform(state.rig, "left-wrist");
  const elbowBefore = getJointWorldTransform(state.rig, "left-elbow");

  state.setParentJoint("left-wrist", "waist");
  state.setParentJoint("left-elbow", "waist");

  const after = getJointWorldTransform(state.rig, "left-wrist");
  const elbowAfter = getJointWorldTransform(state.rig, "left-elbow");
  closeTo(after.x, before.x);
  closeTo(after.y, before.y);
  closeTo(after.rotation, before.rotation);
  closeTo(elbowAfter.x, elbowBefore.x);
  closeTo(elbowAfter.y, elbowBefore.y);
  closeTo(elbowAfter.rotation, elbowBefore.rotation);
  assert.equal(state.getJoint("left-elbow").parentAnchor, undefined);
  assert.deepEqual(validateRig(state.rig), []);
  assert.throws(() => state.setParentJoint("waist", "left-wrist"), /descendant/i);
});

test("history restores an edited radius", () => {
  const state = new RigState(createDefaultRig());
  const original = state.getJoint("head").radius;

  state.setJointRadius("head", original + 10);
  assert.equal(state.getJoint("head").radius, original + 10);
  state.undo();
  assert.equal(state.getJoint("head").radius, original);
  state.redo();
  assert.equal(state.getJoint("head").radius, original + 10);
});

test("constrained multi-selection applies the same angle to each connection, including descendants", () => {
  const state = new RigState(createDefaultRig());
  const ids = ["left-wrist", "right-elbow", "left-elbow"];
  const before = new Map(ids.map((id) => {
    const parent = getJointParentWorldTransform(state.rig, id)!;
    const world = getJointWorldTransform(state.rig, id);
    return [id, { dx: world.x - parent.x, dy: world.y - parent.y }];
  }));
  const original = structuredClone(state.rig);
  state.beginHistoryTransaction();
  state.moveJointsConstrainedBy(ids, 90, 0, 0);
  state.endHistoryTransaction();
  for (const id of ids) {
    const parent = getJointParentWorldTransform(state.rig, id)!;
    const world = getJointWorldTransform(state.rig, id);
    const vector = before.get(id)!;
    closeTo(world.x - parent.x, -vector.dy, id);
    closeTo(world.y - parent.y, vector.dx, id);
  }
  state.undo();
  assert.deepEqual(state.rig, original);
  state.redo();
  const elbow = getJointWorldTransform(state.rig, "left-elbow");
  const shoulder = getJointParentWorldTransform(state.rig, "left-elbow")!;
  closeTo(elbow.x - shoulder.x, -before.get("left-elbow")!.dy);
});

test("constrained multi-selection moves a selected root once and preserves child distance", () => {
  const state = new RigState(createDefaultRig());
  const root = state.rig.joints.find((joint) => !joint.parentJointId)!;
  const child = state.rig.joints.find((joint) => joint.parentJointId === root.id)!;
  const rootBefore = getJointWorldTransform(state.rig, root.id);
  const childBefore = getJointWorldTransform(state.rig, child.id);
  state.moveJointsConstrainedBy([child.id, root.id, root.id], 45, 12, -8);
  const rootAfter = getJointWorldTransform(state.rig, root.id);
  const childAfter = getJointWorldTransform(state.rig, child.id);
  closeTo(rootAfter.x, rootBefore.x + 12);
  closeTo(rootAfter.y, rootBefore.y - 8);
  closeTo(Math.hypot(childAfter.x - rootAfter.x, childAfter.y - rootAfter.y),
    Math.hypot(childBefore.x - rootBefore.x, childBefore.y - rootBefore.y));
});

test("camera-plane movement follows the visible axes in a side view", () => {
  const state = new RigState(createDefaultRig());
  state.setPerspectiveEnabled(false);
  state.setViewYRotation(90);
  const elbowBefore = getJointWorldTransform(state.rig, "left-elbow");
  const wristZ = state.getJoint("left-wrist").z;

  state.moveJointsInCameraPlane(["left-elbow"], 25, 0);

  const elbowAfter = getJointWorldTransform(state.rig, "left-elbow");
  closeTo(elbowAfter.x, elbowBefore.x);
  closeTo(elbowAfter.y, elbowBefore.y);
  closeTo(state.getJoint("left-elbow").z, 25);
  closeTo(state.getJoint("left-wrist").z, wristZ + 25);
});

test("camera-plane movement follows global world rotation", () => {
  const state = new RigState(createDefaultRig());
  state.setPerspectiveEnabled(false);
  state.setGlobalAxisRotation("z", 90);
  const rootBefore = getJointWorldTransform(state.rig, "scene-root");

  state.moveJointsInCameraPlane(["scene-root"], 20, 0);

  const rootAfter = getJointWorldTransform(state.rig, "scene-root");
  closeTo(rootAfter.x, rootBefore.x);
  closeTo(rootAfter.y, rootBefore.y - 20);
});

test("camera-plane rotation preserves 3D distance around the visible normal", () => {
  const state = new RigState(createDefaultRig());
  state.setPerspectiveEnabled(false);
  state.setViewYRotation(90);
  const hip = getJointWorldTransform(state.rig, "right-hip");
  const kneeBefore = getJointWorldTransform(state.rig, "right-knee");
  const originalLength = Math.hypot(kneeBefore.x - hip.x, kneeBefore.y - hip.y,
    state.getJoint("right-knee").z - state.getJoint("right-hip").z);

  state.rotateJointsInCameraPlane(["right-knee"], 45);

  const kneeAfter = getJointWorldTransform(state.rig, "right-knee");
  const rotatedLength = Math.hypot(kneeAfter.x - hip.x, kneeAfter.y - hip.y,
    state.getJoint("right-knee").z - state.getJoint("right-hip").z);
  closeTo(rotatedLength, originalLength);
  assert.ok(Math.abs(state.getJoint("right-knee").z) > 1);
});

test("stock joints keep only axes that control their direct children", () => {
  const state = new RigState(createDefaultRig());
  const expected: Record<string, string[]> = {
    waist: ["upper-torso"], chest: ["neck"], head: [],
    "left-shoulder": ["upper-arm"], "right-shoulder": ["upper-arm"],
    "left-elbow": ["lower-arm"], "right-elbow": ["lower-arm"],
    "left-wrist": [], "right-wrist": [],
    "left-hip": ["upper-leg"], "right-hip": ["upper-leg"],
    "left-knee": ["lower-leg"], "right-knee": ["lower-leg"],
    "left-ankle": [], "right-ankle": [],
  };
  for (const [jointId, axisIds] of Object.entries(expected)) {
    assert.deepEqual(state.getJoint(jointId).axes.map((axis) => axis.id), axisIds, jointId);
  }
});

test("connection control axes stay perpendicular to their procedural faces", () => {
  const state = new RigState(createDefaultRig());
  const connections = [
    ["waist", "upper-torso", "chest"], ["chest", "neck", "head"],
    ["left-shoulder", "upper-arm", "left-elbow"], ["right-shoulder", "upper-arm", "right-elbow"],
    ["left-elbow", "lower-arm", "left-wrist"], ["right-elbow", "lower-arm", "right-wrist"],
    ["left-hip", "upper-leg", "left-knee"], ["right-hip", "upper-leg", "right-knee"],
    ["left-knee", "lower-leg", "left-ankle"], ["right-knee", "lower-leg", "right-ankle"],
  ] as const;
  const assertPerpendicular = (parentId: string, axisId: string, childId: string) => {
    const parent = state.getJoint(parentId);
    const axis = parent.axes.find((candidate) => candidate.id === axisId)!;
    const parentWorld = getJointParentWorldTransform(state.rig, childId)!;
    const childWorld = getJointWorldTransform(state.rig, childId);
    const radians = getAxisWorldAngle(state.rig, parent, axis) * Math.PI / 180;
    const dot = (childWorld.x - parentWorld.x) * Math.cos(radians)
      + (childWorld.y - parentWorld.y) * Math.sin(radians);
    closeTo(dot, 0, `${parentId}.${axisId} is not perpendicular to ${childId}`);
    assert.equal(axis.alignment, "child-perpendicular");
  };

  for (const connection of connections) assertPerpendicular(...connection);
  state.moveJoint("left-elbow", 170, 300);
  assertPerpendicular("left-shoulder", "upper-arm", "left-elbow");
  assertPerpendicular("left-elbow", "lower-arm", "left-wrist");
});

test("legacy connection axes are removed while bound art vertices keep their world position", () => {
  const rig = createDefaultRig();
  const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  shoulder.axes.push({ id: "torso", angle: -90, pointSides: [-1, 1] });
  rig.artShapes!.push({
    id: "legacy-bound-shape", kind: "polygon", layerOrder: 1,
    vertices: [
      { id: "a", source: "axis-point", jointId: shoulder.id, axisId: "torso", side: 1, offsetX: 0, offsetY: 0 },
      { id: "b", source: "root", rootJointId: "scene-root", x: 0, y: 0 },
      { id: "c", source: "root", rootJointId: "scene-root", x: 20, y: 0 },
    ],
  });
  const before = getArtShapeVertexPoint(rig, rig.artShapes!.at(-1)!.vertices[0]);
  const state = new RigState(rig);
  const migrated = state.getArtShape("legacy-bound-shape").vertices[0];
  assert.equal(shoulder.axes.some((axis) => axis.id === "torso"), false);
  assert.equal(migrated.source, "root");
  const after = getArtShapeVertexPoint(state.rig, migrated);
  closeTo(after.x, before.x);
  closeTo(after.y, before.y);
});

test("rotating a remaining connection axis rotates its child subtree", () => {
  const state = new RigState(createDefaultRig());
  const joint = state.getJoint("left-shoulder");
  const axis = joint.axes.find((candidate) => candidate.id === "upper-arm")!;
  const shoulder = getJointParentWorldTransform(state.rig, "left-elbow")!;
  const before = getJointWorldTransform(state.rig, "left-elbow");
  state.setAxisAngle(joint.id, axis.id, getAxisWorldAngle(state.rig, joint, axis) + 30);
  const after = getJointWorldTransform(state.rig, "left-elbow");
  closeTo(Math.hypot(after.x - shoulder.x, after.y - shoulder.y), Math.hypot(before.x - shoulder.x, before.y - shoulder.y));
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 1);
});

test("hip peer group uses one virtual capsule and keeps only upper-leg axes", () => {
  const state = new RigState(createDefaultRig());
  const group = state.rig.peerGroups.find((candidate) => candidate.id === "hip-band")!;
  assert.equal(group.virtualCapsule, true);
  for (const id of group.jointIds) {
    const joint = state.getJoint(id);
    assert.deepEqual(joint.axes.map((axis) => axis.id), ["upper-leg"]);
    assert.equal(joint.axisReferenceJointId, undefined);
  }
  assert.deepEqual(state.getJoint("waist").axes.map((axis) => axis.id), ["upper-torso"]);
  assert.equal(state.rig.faces.some((face) => ["pelvis", "left-pelvis-triangle", "right-pelvis-triangle"].includes(face.id)), false);
  assert.equal(state.rig.faces.find((face) => face.id === "waist-hip")?.proceduralSurface, "waist-hip");

  const before = state.getPeerGroupDistance("hip-band")!;
  state.setPeerGroupDistance("hip-band", before + 20);
  closeTo(state.getPeerGroupDistance("hip-band")!, before + 20);
});

test("legacy pelvis faces and helper axes migrate to the hip capsule", () => {
  const rig = createDefaultRig();
  const group = rig.peerGroups.find((candidate) => candidate.id === "hip-band")!;
  delete group.virtualCapsule;
  rig.joints.find((joint) => joint.id === "waist")!.axes.push({ id: "pelvis", angle: 0, pointSides: [-1, 1] });
  for (const id of group.jointIds) {
    const hip = rig.joints.find((joint) => joint.id === id)!;
    hip.axisReferenceJointId = "waist";
    hip.axes.unshift(
      { id: "pelvis-horizontal", angle: 0, pointSides: [-1] },
      { id: "pelvis-vertical", angle: 90, pointSides: [-1, 1] },
    );
  }
  rig.faces.push({
    id: "pelvis", rotationTarget: { type: "peer", peerGroupId: "hip-band", referenceJointId: "left-hip" },
    vertices: [], orderOffset: 0,
  });
  rig.faces = rig.faces.filter((face) => face.id !== "waist-hip");

  const state = new RigState(rig);
  assert.equal(group.virtualCapsule, true);
  assert.equal(state.rig.faces.some((face) => face.id === "pelvis"), false);
  assert.equal(state.rig.faces.find((face) => face.id === "waist-hip")?.proceduralSurface, "waist-hip");
  assert.deepEqual(state.getJoint("waist").axes.map((axis) => axis.id), ["upper-torso"]);
  assert.deepEqual(state.getJoint("left-hip").axes.map((axis) => axis.id), ["upper-leg"]);
});
