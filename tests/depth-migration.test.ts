import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { RigState, normalizeRigZCoordinates, validateRig } from "../src/rig/rig-state.ts";
import type { Rig } from "../src/rig/types.ts";

test("every default joint has an explicit neutral Z coordinate", () => {
  const rig = createDefaultRig();
  assert.ok(rig.joints.every((joint) => joint.z === 0));
  assert.deepEqual(validateRig(rig), []);
});

test("legacy rigs using depth are upgraded to z before validation", () => {
  const rig = createDefaultRig();
  const legacy = structuredClone(rig) as unknown as { joints: Array<{ z?: number; depth?: number }> };
  legacy.joints[0].depth = legacy.joints[0].z;
  delete legacy.joints[0].z;
  normalizeRigZCoordinates(legacy as unknown as Rig);

  assert.equal(legacy.joints[0].z, 0);
  assert.doesNotThrow(() => new RigState(legacy as unknown as Rig));
});
