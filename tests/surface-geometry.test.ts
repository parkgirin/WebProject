import assert from "node:assert/strict";
import test from "node:test";
import {
  boundsOverlap,
  sphereDepthAt,
  surfaceDepthAt,
  surfaceDepthRange,
  tubeCoordinatesAt,
  type SphereRenderSurface,
  type TubeRenderSurface,
} from "../src/rig/surface-geometry.ts";

const sphere: SphereRenderSurface = {
  kind: "sphere",
  id: "sphere",
  source: "shape",
  sourceId: "sphere",
  center: { x: 10, y: 20 },
  projectedRadius: 5,
  centerDepth: 7,
  radius: 5,
  order: 0,
  bounds: { minX: 5, minY: 15, maxX: 15, maxY: 25 },
};

const tube: TubeRenderSurface = {
  kind: "tube",
  id: "tube",
  points: [{ x: 0, y: -2 }, { x: 10, y: -2 }, { x: 10, y: 2 }, { x: 0, y: 2 }],
  startDepth: 2,
  endDepth: 4,
  startRadius: 2,
  endRadius: 2,
  order: 0,
  bounds: { minX: 0, minY: -2, maxX: 10, maxY: 2 },
  jointIds: ["start", "end"],
};

test("surface bounds reject disjoint and edge-only pairs", () => {
  assert.equal(boundsOverlap(sphere.bounds, { minX: 12, minY: 18, maxX: 18, maxY: 24 }), true);
  assert.equal(boundsOverlap(sphere.bounds, { minX: 15, minY: 15, maxX: 20, maxY: 25 }), false);
  assert.equal(boundsOverlap(sphere.bounds, { minX: -5, minY: -5, maxX: 0, maxY: 0 }), false);
});

test("sphere surface depth follows its projected front hemisphere", () => {
  assert.equal(sphereDepthAt(sphere, sphere.center), 12);
  assert.equal(sphereDepthAt(sphere, { x: 15, y: 20 }), 7);
  assert.equal(sphereDepthAt(sphere, { x: 16, y: 20 }), null);
  assert.deepEqual(surfaceDepthRange(sphere), { min: 2, max: 12 });
});

test("tube surface depth is evaluated only inside its projected side", () => {
  const center = tubeCoordinatesAt(tube, { x: 5, y: 0 });
  assert.ok(center);
  assert.ok(Math.abs(center.t - 0.5) < 1e-6);
  assert.ok(Math.abs(center.cross - 0.5) < 1e-6);
  assert.ok(Math.abs(center.depth - 5) < 1e-6);
  assert.equal(tubeCoordinatesAt(tube, { x: 5, y: 3 }), null);
  assert.equal(surfaceDepthAt(tube, { x: 5, y: 0 }), center.depth);
  assert.deepEqual(surfaceDepthRange(tube), { min: 0, max: 6 });
});
