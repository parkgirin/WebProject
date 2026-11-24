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

export interface SpriteSheetFrameRecord extends SpriteSheetCell {
  timelineFrame: number;
  durationMs: number;
  rootMotion: RootTranslation;
  sourcePivot: { x: number; y: number };
}

export interface BakedSpriteSequenceContract {
  kind: "baked-cycle";
  order: "frames";
  repeat: "loop";
  firstFrameDuplicatedAtEnd: false;
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

/**
 * Describe the runtime contract for exported frames. Ping-pong and loop closing
 * segments are already baked into `frames`, so consumers must iterate the array
 * once and loop to index zero instead of reflecting it a second time.
 */
export function createBakedSpriteSequenceContract(): BakedSpriteSequenceContract {
  return {
    kind: "baked-cycle",
    order: "frames",
    repeat: "loop",
    firstFrameDuplicatedAtEnd: false,
  };
}

/** Build frame records and root-motion deltas from one already baked playback cycle. */
export function createSpriteSheetFrameRecords(
  timelineFrames: number[],
  layout: SpriteSheetLayout,
  roots: RootTranslation[],
  sourcePivots: { x: number; y: number }[],
  fps: number,
): { referenceRoot: RootTranslation; frames: SpriteSheetFrameRecord[] } {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("스프라이트 FPS가 올바르지 않습니다.");
  const frameCount = timelineFrames.length;
  if (frameCount === 0 || layout.cells.length !== frameCount
    || roots.length !== frameCount || sourcePivots.length !== frameCount) {
    throw new Error("스프라이트 프레임 메타데이터의 개수가 일치하지 않습니다.");
  }
  if (!timelineFrames.every(Number.isFinite)
    || !roots.every((root) => [root.x, root.y, root.z].every(Number.isFinite))
    || !sourcePivots.every((pivot) => [pivot.x, pivot.y].every(Number.isFinite))) {
    throw new Error("스프라이트 프레임 메타데이터에 올바르지 않은 좌표가 있습니다.");
  }
  const referenceRoot = { ...roots[0] };
  const durationMs = 1000 / fps;
  return {
    referenceRoot,
    frames: layout.cells.map((cell, index) => ({
      ...cell,
      timelineFrame: timelineFrames[index],
      durationMs,
      rootMotion: {
        x: roots[index].x - referenceRoot.x,
        y: roots[index].y - referenceRoot.y,
        z: roots[index].z - referenceRoot.z,
      },
      sourcePivot: { ...sourcePivots[index] },
    })),
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

