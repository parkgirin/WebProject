import assert from "node:assert/strict";
import test from "node:test";
import {
  boundsOverlap,
  polygonDepthAt,
  sphereDepthAt,
  surfaceDepthAt,
  surfaceDepthRange,
  tubeCoordinatesAt,
  tubeDepthAt,
  tubeEndCapDepthAt,
  type PolygonRenderSurface,
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

test("tube depth includes an exposed terminal section beyond the side quad", () => {
  const terminalTube: TubeRenderSurface = {
    ...tube,
    bounds: { minX: 0, minY: -2, maxX: 12, maxY: 2 },
    endCap: {
      center: { x: 10, y: 0 },
      centerDepth: 4,
      points: [{ x: 8, y: 0 }, { x: 10, y: -2 }, { x: 12, y: 0 }, { x: 10, y: 2 }],
      depths: [4, 4, 4, 4],
      bounds: { minX: 8, minY: -2, maxX: 12, maxY: 2 },
    },
  };

  assert.equal(tubeCoordinatesAt(terminalTube, { x: 11, y: 0 }), null);
  assert.equal(tubeEndCapDepthAt(terminalTube, { x: 11, y: 0 }), 4);
  assert.equal(tubeDepthAt(terminalTube, { x: 11, y: 0 }), 4);
  assert.equal(tubeEndCapDepthAt(terminalTube, { x: 13, y: 0 }), null);
});

test("multi-joint polygons separate their outer boundary from depth patches", () => {
  const polygon: PolygonRenderSurface = {
    kind: "polygon",
    id: "waist-hip",
    points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 10, y: 10 }, { x: 2, y: 10 }],
    patches: [
      { id: "center", points: [{ x: 2, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 2, y: 10 }], depth: 3 },
      { id: "left", points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 10 }, { x: 2, y: 10 }], depth: 5 },
    ],
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 10 },
    jointIds: ["waist", "left-hip", "right-hip"],
    order: 0,
  };

  assert.equal(polygonDepthAt(polygon, { x: 1, y: 2 }), 5);
  assert.equal(polygonDepthAt(polygon, { x: 4, y: 2 }), 5);
  assert.equal(polygonDepthAt(polygon, { x: 9, y: 2 }), 3);
  assert.equal(polygonDepthAt(polygon, { x: 11, y: 9 }), null);
  assert.deepEqual(surfaceDepthRange(polygon), { min: 3, max: 5 });
  assert.equal(surfaceDepthAt(polygon, { x: 9, y: 2 }), 3);
});

test("polygon patches interpolate camera depth across their vertices", () => {
  const polygon: PolygonRenderSurface = {
    kind: "polygon",
    id: "torso-side",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    patches: [{
      id: "torso-side",
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      depth: 10,
      depths: [0, 10, 20],
    }],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    jointIds: ["left-shoulder", "right-shoulder", "waist"],
    order: 0,
  };

  assert.equal(polygonDepthAt(polygon, { x: 5, y: 0 }), 5);
  assert.equal(polygonDepthAt(polygon, { x: 0, y: 5 }), 10);
  assert.equal(polygonDepthAt(polygon, { x: 2.5, y: 2.5 }), 7.5);
  assert.deepEqual(surfaceDepthRange(polygon), { min: 0, max: 20 });
});
