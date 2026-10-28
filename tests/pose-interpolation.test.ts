import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { interpolateAngle, interpolatePoseRig } from "../src/rig/pose-interpolation.ts";

test("pose interpolation uses the shortest rotation path without mutating either key", () => {
  const start = createDefaultRig();
  const end = structuredClone(start);
  const startArm = start.joints.find((joint) => joint.id === "left-shoulder")!;
  const endArm = end.joints.find((joint) => joint.id === "left-shoulder")!;
  startArm.x = 20;
  startArm.localRotation = 350;
  endArm.x = 80;
  endArm.localRotation = 10;

  const middle = interpolatePoseRig(start, end, .5);
  const middleArm = middle.joints.find((joint) => joint.id === "left-shoulder")!;
  assert.equal(middleArm.x, 50);
  assert.equal(middleArm.localRotation, 0);
  assert.equal(startArm.x, 20);
  assert.equal(endArm.x, 80);
  assert.equal(interpolateAngle(10, 350, .5), 0);
});
