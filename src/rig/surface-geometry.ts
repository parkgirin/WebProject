import type { Point } from "./geometry.ts";

export interface SurfaceBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SurfaceStack {
  groupId?: string;
  order: number;
}

export interface SphereRenderSurface extends SurfaceStack {
  kind: "sphere";
  id: string;
  center: Point;
  projectedRadius: number;
  centerDepth: number;
  radius: number;
  bounds: SurfaceBounds;
  source: "joint" | "shape";
  sourceId: string;
  attachedJointId?: string;
}

export interface TubeRenderSurface extends SurfaceStack {
  kind: "tube";
  id: string;
  points: [Point, Point, Point, Point];
  startDepth: number;
  endDepth: number;
  startRadius: number;
  endRadius: number;
  bounds: SurfaceBounds;
  jointIds: [string, string];
}

export type RenderSurface = SphereRenderSurface | TubeRenderSurface;

export function boundsOf(points: readonly Point[]): SurfaceBounds {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function boundsOverlap(first: SurfaceBounds, second: SurfaceBounds): boolean {
  return first.minX < second.maxX && first.maxX > second.minX
    && first.minY < second.maxY && first.maxY > second.minY;
}

export function surfaceDepthRange(surface: RenderSurface): { min: number; max: number } {
  if (surface.kind === "sphere") {
    return { min: surface.centerDepth - surface.radius, max: surface.centerDepth + surface.radius };
  }
  return {
    min: Math.min(surface.startDepth - surface.startRadius, surface.endDepth - surface.endRadius),
    max: Math.max(surface.startDepth + surface.startRadius, surface.endDepth + surface.endRadius),
  };
}

export function sphereDepthAt(surface: SphereRenderSurface, point: Point): number | null {
  const normalized = Math.hypot(point.x - surface.center.x, point.y - surface.center.y)
    / surface.projectedRadius;
  return normalized <= 1
    ? surface.centerDepth + surface.radius * Math.sqrt(Math.max(0, 1 - normalized * normalized))
    : null;
}

export function tubeCoordinatesAt(surface: TubeRenderSurface, point: Point): {
  t: number;
  cross: number;
  depth: number;
} | null {
  const lerpPoint = (start: Point, end: Point, amount: number): Point => ({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  });
  const startCenter = lerpPoint(surface.points[0], surface.points[3], 0.5);
  const endCenter = lerpPoint(surface.points[1], surface.points[2], 0.5);
  const centerDx = endCenter.x - startCenter.x;
  const centerDy = endCenter.y - startCenter.y;
  const centerLengthSquared = centerDx * centerDx + centerDy * centerDy;
  let t = centerLengthSquared > 1e-9
    ? ((point.x - startCenter.x) * centerDx + (point.y - startCenter.y) * centerDy) / centerLengthSquared
    : 0.5;
  let cross = 0.5;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const edgeA = lerpPoint(surface.points[0], surface.points[1], t);
    const edgeB = lerpPoint(surface.points[3], surface.points[2], t);
    const current = lerpPoint(edgeA, edgeB, cross);
    const errorX = point.x - current.x;
    const errorY = point.y - current.y;
    const tangentA = { x: surface.points[1].x - surface.points[0].x, y: surface.points[1].y - surface.points[0].y };
    const tangentB = { x: surface.points[2].x - surface.points[3].x, y: surface.points[2].y - surface.points[3].y };
    const derivativeT = lerpPoint(tangentA, tangentB, cross);
    const derivativeCross = { x: edgeB.x - edgeA.x, y: edgeB.y - edgeA.y };
    const determinant = derivativeT.x * derivativeCross.y - derivativeT.y * derivativeCross.x;
    if (Math.abs(determinant) < 1e-9) break;
    t += (errorX * derivativeCross.y - errorY * derivativeCross.x) / determinant;
    cross += (derivativeT.x * errorY - derivativeT.y * errorX) / determinant;
  }
  if (t < -1e-5 || t > 1 + 1e-5 || cross < -1e-5 || cross > 1 + 1e-5) return null;
  t = Math.min(1, Math.max(0, t));
  cross = Math.min(1, Math.max(0, cross));
  const radius = surface.startRadius + (surface.endRadius - surface.startRadius) * t;
  const radial = Math.abs(cross * 2 - 1);
  return {
    t,
    cross,
    depth: surface.startDepth + (surface.endDepth - surface.startDepth) * t
      + radius * Math.sqrt(Math.max(0, 1 - radial * radial)),
  };
}

export function surfaceDepthAt(surface: RenderSurface, point: Point): number | null {
  return surface.kind === "sphere" ? sphereDepthAt(surface, point) : tubeCoordinatesAt(surface, point)?.depth ?? null;
}
