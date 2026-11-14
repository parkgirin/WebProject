import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { createPoseKey, type PoseClip } from "../src/rig/pose-interpolation.ts";
import { RigState, validateRig } from "../src/rig/rig-state.ts";
import {
  createProjectDocument,
  materializeProjectAnimations,
  materializeProjectRig,
  parseProjectDocument,
  quaternionFromEuler,
  rotateVector,
  serializeProjectDocument,
} from "../src/storage/project-document.ts";

const close = (actual: number, expected: number, message?: string) => {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} != ${expected}`);
};

test("a legacy rig separates into structure, body, pose, appearance, and output view", () => {
  const state = new RigState(createDefaultRig());
  state.setJointAxisRotation("right-elbow", "y", 60);
  state.paintJointWithColor("right-wrist", "#123456");
  state.setViewYRotation(35);
  state.setProjectionStrength(70);
  state.setGlobalAxisRotation("z", 25);

  const project = createProjectDocument(state.rig, { createdAt: "2026-11-14T00:00:00.000Z" });

  assert.equal(project.version, 3);
  assert.equal(project.rig.id, "human-v1");
  assert.equal(project.rig.family, "humanoid");
  assert.deepEqual(project.body.joints["right-elbow"].restOffset,
    [state.getJoint("right-elbow").baseOffset!.x, state.getJoint("right-elbow").baseOffset!.y,
      state.getJoint("right-elbow").baseOffset!.z]);
  assert.ok(project.pose.joints["right-elbow"].lengthScale > 0);
  assert.equal(project.appearance.joints["right-wrist"].paletteId, state.getJoint("right-wrist").paletteId);
  assert.equal(project.outputView.projectionStrength, 70);
  assert.deepEqual(Object.keys(project.outputView).sort(),
    ["perspectiveEnabled", "projectionStrength", "rotation", "transparentBackground"]);
});

test("materializing a separated project preserves the legacy editor rig", () => {
  const state = new RigState(createDefaultRig());
  state.setJointAxisRotation("right-elbow", "x", 25);
  state.setJointAxisRotation("right-wrist", "z", 35);
  state.setJointCapsuleFlatLength("waist", "x", 74);
  state.setGlobalAxisRotation("y", 40);
  const project = createProjectDocument(state.rig);
  const restored = materializeProjectRig(project);

  assert.deepEqual(validateRig(restored), []);
  for (const source of state.rig.joints) {
    const target = restored.joints.find((joint) => joint.id === source.id)!;
    close(target.x, source.x, `${source.id}.x`);
    close(target.y, source.y, `${source.id}.y`);
    close(target.z, source.z, `${source.id}.z`);
    close(target.localRotation, source.localRotation, `${source.id}.rz`);
    close(target.localRotationX ?? 0, source.localRotationX ?? 0, `${source.id}.rx`);
    close(target.localRotationY ?? 0, source.localRotationY ?? 0, `${source.id}.ry`);
  }
  close(restored.worldRotation!.y, 40);
  assert.deepEqual(restored.artShapes, state.rig.artShapes);
});

test("v3 project JSON round-trips and rejects mismatched rig identities", () => {
  const project = createProjectDocument(createDefaultRig(), { createdAt: "2026-11-14T00:00:00.000Z" });
  const parsed = parseProjectDocument(serializeProjectDocument(project));
  assert.equal(parsed.rig.id, "human-v1");
  assert.equal(parsed.outputView.transparentBackground, true);

  const incompatible = structuredClone(project);
  incompatible.pose.rigId = "rabbit-v1";
  assert.throws(() => parseProjectDocument(JSON.stringify(incompatible)), /호환 정보/);
});

test("pose conversion measures limb scale in full XYZ space", () => {
  const state = new RigState(createDefaultRig());
  state.setJointAxisRotation("right-elbow", "y", 60);
  const project = createProjectDocument(state.rig);
  const body = project.body.joints["right-elbow"].restOffset;
  const pose = project.pose.joints["right-elbow"];
  const posed = rotateVector(body, pose.offsetRotation).map((value) => value * pose.lengthScale);
  const joint = state.getJoint("right-elbow");
  const parent = state.getJoint("right-shoulder");

  close(Math.hypot(...posed), Math.hypot(joint.x, joint.y, joint.z - parent.z));
  close(posed[0], joint.x);
  close(posed[1], joint.y);
  close(posed[2], joint.z - parent.z);
});

test("animation conversion separates pose keys from world rotation keys", () => {
  const first = createDefaultRig();
  const second = structuredClone(first);
  second.worldRotation = { x: 0, y: 90, z: 0 };
  const clip: PoseClip = {
    id: "turn", name: "회전", fps: 12,
    keys: [createPoseKey("a", "시작", 0, first), createPoseKey("b", "끝", 12, second)],
  };
  const project = createProjectDocument(first, { animations: [clip] });
  const animation = project.animations[0];

  assert.equal(animation.poseTrack.keys.length, 2);
  assert.equal(animation.worldRotationTrack?.keys.length, 2);
  assert.equal(animation.worldRotationTrack?.pivot, "scene-root");
  assert.deepEqual(animation.worldRotationTrack?.keys[1].rotation, quaternionFromEuler(0, 90, 0));
  assert.equal("outputView" in animation, false);
});

test("project animation tracks restore pose, world rotation, and keyed appearance", () => {
  const first = createDefaultRig();
  const secondState = new RigState(structuredClone(first));
  secondState.setJointAxisRotation("right-elbow", "y", 45);
  secondState.setGlobalAxisRotation("z", 30);
  secondState.paintJointWithColor("right-wrist", "#123456");
  const clip: PoseClip = {
    id: "full", name: "전체 트랙", fps: 10,
    keys: [createPoseKey("a", "시작", 0, first), createPoseKey("b", "끝", 10, secondState.rig)],
    playback: { mode: "loop", closingFrames: 4 },
  };

  const restored = materializeProjectAnimations(createProjectDocument(first, { animations: [clip] }))[0];
  const last = restored.keys[1].rig;

  assert.equal(restored.playback?.mode, "loop");
  close(last.worldRotation!.z, 30);
  close(last.joints.find((joint) => joint.id === "right-elbow")!.localRotationY!, 45);
  const wrist = last.joints.find((joint) => joint.id === "right-wrist")!;
  assert.equal(last.palette.find((entry) => entry.id === wrist.paletteId)?.color, "#123456");
});

test("quadruped rigs receive their own compatibility identity", () => {
  const rig = createDefaultRig();
  rig.joints = [
    { ...rig.joints[0], id: "scene-root", parentJointId: undefined },
    { ...rig.joints[1], id: "front-left-paw", parentJointId: "scene-root" },
    { ...rig.joints[2], id: "hind-right-paw", parentJointId: "scene-root" },
  ];
  rig.faces = [];
  rig.peerGroups = [];
  rig.bodyViewProfiles = {
    front: { jointRadiusScale: Object.fromEntries(rig.joints.map((joint) => [joint.id, 1])) },
    side: { jointRadiusScale: Object.fromEntries(rig.joints.map((joint) => [joint.id, 1])) },
    back: { jointRadiusScale: Object.fromEntries(rig.joints.map((joint) => [joint.id, 1])) },
  };
  const project = createProjectDocument(rig);
  assert.equal(project.rig.id, "rabbit-v1");
  assert.equal(project.rig.family, "quadruped");
});
