export interface SpriteSheetCell {
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteSheetLayout {
  width: number;
  height: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  cells: SpriteSheetCell[];
}

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CenteredFrameInput {
  bounds: RectBounds;
  pivot: { x: number; y: number };
}

export interface CenteredFrameBounds {
  width: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
  frames: RectBounds[];
}

/** Build equal frame bounds whose selected pivot is the exact centre in every frame. */
export function createCenteredFrameBounds(inputs: CenteredFrameInput[]): CenteredFrameBounds {
  if (inputs.length === 0) throw new Error("중앙 정렬할 애니메이션 프레임이 없습니다.");
  for (const { bounds, pivot } of inputs) {
    if (![bounds.x, bounds.y, bounds.width, bounds.height, pivot.x, pivot.y].every(Number.isFinite)
      || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("피벗 중심 출력 영역을 계산할 수 없습니다.");
    }
  }
  const halfWidth = Math.max(0.5, ...inputs.flatMap(({ bounds, pivot }) => [
    pivot.x - bounds.x,
    bounds.x + bounds.width - pivot.x,
  ]));
  const halfHeight = Math.max(0.5, ...inputs.flatMap(({ bounds, pivot }) => [
    pivot.y - bounds.y,
    bounds.y + bounds.height - pivot.y,
  ]));
  const width = halfWidth * 2;
  const height = halfHeight * 2;
  return {
    width,
    height,
    halfWidth,
    halfHeight,
    frames: inputs.map(({ pivot }) => ({
      x: pivot.x - halfWidth,
      y: pivot.y - halfHeight,
      width,
      height,
    })),
  };
}

/** Expand a shared animation bound so the requested point is its exact horizontal center. */
export function centerBoundsHorizontally(bounds: RectBounds, centerX: number): RectBounds {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, centerX].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("가슴 중심 출력 영역을 계산할 수 없습니다.");
  }
  const leftExtent = Math.max(0, centerX - bounds.x);
  const rightExtent = Math.max(0, bounds.x + bounds.width - centerX);
  const halfWidth = Math.max(leftExtent, rightExtent, 0.5);
  return {
    x: centerX - halfWidth,
    y: bounds.y,
    width: halfWidth * 2,
    height: bounds.height,
  };
}

export function includePointInBounds(bounds: RectBounds, point: { x: number; y: number }): RectBounds {
  if (![point.x, point.y].every(Number.isFinite)) throw new Error("출력 피벗 좌표가 올바르지 않습니다.");
  const right = Math.max(bounds.x + bounds.width, point.x);
  const bottom = Math.max(bounds.y + bounds.height, point.y);
  const x = Math.min(bounds.x, point.x);
  const y = Math.min(bounds.y, point.y);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Create a predictable uniform grid instead of a variable-size packed atlas. */
export function createSpriteSheetLayout(
  frameCount: number,
  cellWidth: number,
  cellHeight: number,
  requestedColumns?: number,
): SpriteSheetLayout {
  if (!Number.isInteger(frameCount) || frameCount <= 0) throw new Error("스프라이트 시트에는 하나 이상의 프레임이 필요합니다.");
  if (!Number.isInteger(cellWidth) || cellWidth <= 0 || !Number.isInteger(cellHeight) || cellHeight <= 0) {
    throw new Error("스프라이트 셀 크기가 올바르지 않습니다.");
  }
  const automaticColumns = Math.ceil(Math.sqrt(frameCount));
  const columns = Math.min(frameCount, requestedColumns === undefined
    ? automaticColumns : Math.max(1, Math.floor(requestedColumns)));
  const rows = Math.ceil(frameCount / columns);
  const cells = Array.from({ length: frameCount }, (_, index): SpriteSheetCell => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      index, column, row,
      x: column * cellWidth,
      y: row * cellHeight,
      width: cellWidth,
      height: cellHeight,
    };
  });
  return {
    width: columns * cellWidth,
    height: rows * cellHeight,
    columns,
    rows,
    cellWidth,
    cellHeight,
    cells,
  };
}

export function getRigRootTranslation(rig: Rig): RootTranslation {
  const root = rig.joints.find((joint) => !joint.parentJointId) ?? rig.joints[0];
  if (!root) throw new Error("애니메이션 루트 관절을 찾을 수 없습니다.");
  return { x: root.x, y: root.y, z: root.z };
}

/** Remove root translation while retaining every descendant's parent-relative XYZ pose. */
export function placeRigRootAt(rig: Rig, target: RootTranslation): Rig {
  const result = structuredClone(rig);
  const root = result.joints.find((joint) => !joint.parentJointId) ?? result.joints[0];
  if (!root) return result;
  const depthDelta = target.z - root.z;
  const movingIds = new Set([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const joint of result.joints) {
      if (joint.parentJointId && movingIds.has(joint.parentJointId) && !movingIds.has(joint.id)) {
        movingIds.add(joint.id);
        changed = true;
      }
    }
  }
  root.x = target.x;
  root.y = target.y;
  for (const joint of result.joints) if (movingIds.has(joint.id)) joint.z += depthDelta;
  return result;
}

import type { Rig } from "../rig/types.ts";

export interface RootTranslation {
  x: number;
  y: number;
  z: number;
}

