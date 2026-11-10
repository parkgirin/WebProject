import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { normalizeBodyViewProfiles, type Rig } from "../src/rig/types.ts";
import { getJointViewRadius } from "../src/rig/geometry.ts";

test("body view profiles preserve the existing body at neutral scale", () => {
  const rig = createDefaultRig();
  for (const view of ["front", "side", "back"] as const) {
    assert.deepEqual(Object.values(rig.bodyViewProfiles[view].jointRadiusScale), rig.joints.map(() => 1));
  }
});

test("legacy rigs receive neutral front, side, and back profiles", () => {
  const legacy = structuredClone(createDefaultRig()) as unknown as Partial<Rig> & Pick<Rig, "joints">;
  delete legacy.bodyViewProfiles;
  normalizeBodyViewProfiles(legacy);

  assert.equal(legacy.bodyViewProfiles?.front.jointRadiusScale.waist, 1);
  assert.equal(legacy.bodyViewProfiles?.side.jointRadiusScale.waist, 1);
  assert.equal(legacy.bodyViewProfiles?.back.jointRadiusScale.waist, 1);
});

test("view profile radius transitions through side and back", () => {
  const rig = createDefaultRig();
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  waist.sideRadius = 20;
  rig.bodyViewProfiles.back.jointRadiusScale.waist = 1.5;

  rig.viewYRotation = 0;
  assert.equal(getJointViewRadius(rig, waist), waist.radius);
  rig.viewYRotation = 90;
  assert.equal(getJointViewRadius(rig, waist), 20);
  rig.viewYRotation = 180;
  assert.equal(getJointViewRadius(rig, waist), waist.radius * 1.5);
});
