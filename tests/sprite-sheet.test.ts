import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { getOutputJointPivot } from "../src/editor/export-animation.ts";
import {
  centerBoundsHorizontally,
  createCenteredFrameBounds,
  createSpriteSheetLayout,
  getRigRootTranslation,
  includePointInBounds,
  placeRigRootAt,
} from "../src/editor/sprite-sheet.ts";

test("sprite bounds expand around the reference chest without changing vertical bounds", () => {
  assert.deepEqual(
    centerBoundsHorizontally({ x: 20, y: 40, width: 150, height: 260 }, 80),
    { x: -10, y: 40, width: 180, height: 260 },
  );
  assert.deepEqual(
    centerBoundsHorizontally({ x: 20, y: 40, width: 120, height: 260 }, 80),
    { x: 20, y: 40, width: 120, height: 260 },
  );
});

test("a manual output pivot is retained inside the shared sprite bounds", () => {
  assert.deepEqual(
    includePointInBounds({ x: 20, y: 40, width: 120, height: 260 }, { x: -30, y: 340 }),
    { x: -30, y: 40, width: 170, height: 300 },
  );
  const centered = centerBoundsHorizontally(
    includePointInBounds({ x: 20, y: 40, width: 120, height: 260 }, { x: 170, y: 320 }),
    170,
  );
  assert.equal(centered.x + centered.width / 2, 170);
  assert.ok(centered.y <= 320 && centered.y + centered.height >= 320);
});

test("every frame places its evaluated pivot at the exact shared cell centre", () => {
  const centered = createCenteredFrameBounds([
    { bounds: { x: 0, y: 0, width: 100, height: 80 }, pivot: { x: 20, y: 60 } },
    { bounds: { x: 10, y: -20, width: 60, height: 120 }, pivot: { x: 50, y: 20 } },
  ]);

  assert.equal(centered.width, 160);
  assert.equal(centered.height, 160);
  assert.deepEqual(centered.frames, [
    { x: -60, y: -20, width: 160, height: 160 },
    { x: -30, y: -60, width: 160, height: 160 },
  ]);
  centered.frames.forEach((bounds, index) => {
    const pivot = [{ x: 20, y: 60 }, { x: 50, y: 20 }][index];
    assert.equal(pivot.x - bounds.x, centered.width / 2);
    assert.equal(pivot.y - bounds.y, centered.height / 2);
  });
});

test("a hidden joint can still drive a frame-by-frame output pivot", () => {
  const rig = createDefaultRig();
  const head = rig.joints.find((joint) => joint.id === "head")!;
  assert.equal(head.bodyVisible, false);

  rig.worldRotation = { x: 0, y: 0, z: 0 };
  const first = getOutputJointPivot(rig, "head")!;
  rig.worldRotation = { x: 0, y: 0, z: 90 };
  const rotated = getOutputJointPivot(rig, "head")!;

  assert.notDeepEqual(rotated, first);
  assert.equal(getOutputJointPivot(rig, "missing"), null);
});

test("sprite sheet layout places frames in a predictable uniform grid", () => {
  const layout = createSpriteSheetLayout(10, 128, 256);

  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 3);
  assert.equal(layout.width, 512);
  assert.equal(layout.height, 768);
  assert.deepEqual(layout.cells[0], { index: 0, column: 0, row: 0, x: 0, y: 0, width: 128, height: 256 });
  assert.deepEqual(layout.cells[5], { index: 5, column: 1, row: 1, x: 128, y: 256, width: 128, height: 256 });
  assert.deepEqual(layout.cells[9], { index: 9, column: 1, row: 2, x: 128, y: 512, width: 128, height: 256 });
});

test("sprite sheet layout supports a requested column count and rejects invalid cells", () => {
  const layout = createSpriteSheetLayout(5, 64, 96, 2);
  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 3);
  assert.deepEqual(layout.cells.map((cell) => [cell.x, cell.y]), [
    [0, 0], [64, 0], [0, 96], [64, 96], [0, 192],
  ]);
  assert.throws(() => createSpriteSheetLayout(0, 64, 96), /하나 이상/);
  assert.throws(() => createSpriteSheetLayout(2, 0, 96), /셀 크기/);
});

test("placing a rig at a reference root removes XYZ root motion without changing local depth", () => {
  const rig = createDefaultRig();
  const root = rig.joints.find((joint) => !joint.parentJointId)!;
  const knee = rig.joints.find((joint) => joint.id === "left-knee")!;
  const beforeLocalDepth = knee.z - root.z;
  root.x += 34;
  root.y -= 18;
  for (const joint of rig.joints) joint.z += 27;

  const inPlace = placeRigRootAt(rig, { x: 300, y: 320, z: 0 });
  assert.deepEqual(getRigRootTranslation(inPlace), { x: 300, y: 320, z: 0 });
  const inPlaceRoot = inPlace.joints.find((joint) => !joint.parentJointId)!;
  const inPlaceKnee = inPlace.joints.find((joint) => joint.id === "left-knee")!;
  assert.equal(inPlaceKnee.z - inPlaceRoot.z, beforeLocalDepth);
});

test("animation export UI exposes the sprite sheet package without removing frame sequences", () => {
  const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.match(source, /PNG 스프라이트 시트 \+ JSON/);
  assert.match(source, /PNG 프레임 시퀀스/);
  assert.match(source, /SVG 프레임 시퀀스/);
  assert.match(source, /exportPoseAnimationSpriteSheet/);
  assert.match(source, /data-manual-output-pivot/);
  assert.match(source, /data-output-pivot-selection/);
  assert.match(source, /관절 추적:/);
});

