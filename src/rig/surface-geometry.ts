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
  endCap?: {
    center: Point;
    centerDepth: number;
    points: Point[];
    depths: number[];
    bounds: SurfaceBounds;
  };
}

export interface PolygonRenderPatch {
  id: string;
  points: Point[];
  depth: number;
  /** Optional per-vertex camera depths for planar interpolation. */
  depths?: number[];
}

export interface PolygonRenderSurface extends SurfaceStack {
  kind: "polygon";
  id: string;
  points: Point[];
  patches: PolygonRenderPatch[];
  bounds: SurfaceBounds;
  jointIds: string[];
}

export type RenderSurface = SphereRenderSurface | TubeRenderSurface | PolygonRenderSurface;

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
  if (surface.kind === "tube") {
    return {
      min: Math.min(surface.startDepth - surface.startRadius, surface.endDepth - surface.endRadius),
      max: Math.max(surface.startDepth + surface.startRadius, surface.endDepth + surface.endRadius),
    };
  }
  const depths = surface.patches.flatMap((patch) => patch.depths?.length === patch.points.length
    ? patch.depths : [patch.depth]);
  return { min: Math.min(...depths), max: Math.max(...depths) };
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

function triangleDepthAt(
  point: Point,
  vertices: [Point, Point, Point],
  depths: [number, number, number],
): number | null {
  const [first, second, third] = vertices;
  const denominator = (second.y - third.y) * (first.x - third.x)
    + (third.x - second.x) * (first.y - third.y);
  if (Math.abs(denominator) < 1e-9) return null;
  const firstWeight = ((second.y - third.y) * (point.x - third.x)
    + (third.x - second.x) * (point.y - third.y)) / denominator;
  const secondWeight = ((third.y - first.y) * (point.x - third.x)
    + (first.x - third.x) * (point.y - third.y)) / denominator;
  const thirdWeight = 1 - firstWeight - secondWeight;
  if (firstWeight < -1e-6 || secondWeight < -1e-6 || thirdWeight < -1e-6) return null;
  return firstWeight * depths[0] + secondWeight * depths[1] + thirdWeight * depths[2];
}

export function tubeEndCapDepthAt(surface: TubeRenderSurface, point: Point): number | null {
  const cap = surface.endCap;
  if (!cap || point.x < cap.bounds.minX || point.x > cap.bounds.maxX
    || point.y < cap.bounds.minY || point.y > cap.bounds.maxY) return null;
  for (let index = 0; index < cap.points.length; index += 1) {
    const next = (index + 1) % cap.points.length;
    const depth = triangleDepthAt(
      point,
      [cap.center, cap.points[index], cap.points[next]],
      [cap.centerDepth, cap.depths[index], cap.depths[next]],
    );
    if (depth !== null) return depth;
  }
  return null;
}

export function tubeDepthAt(surface: TubeRenderSurface, point: Point): number | null {
  const sideDepth = tubeCoordinatesAt(surface, point)?.depth ?? null;
  const capDepth = tubeEndCapDepthAt(surface, point);
  if (sideDepth === null) return capDepth;
  if (capDepth === null) return sideDepth;
  return Math.max(sideDepth, capDepth);
}

export function polygonDepthAt(surface: PolygonRenderSurface, point: Point): number | null {
  let depth: number | null = null;
  for (const patch of surface.patches) {
    if (patch.points.length < 3) continue;
    for (let index = 1; index < patch.points.length - 1; index += 1) {
      const patchDepths = patch.depths?.length === patch.points.length ? patch.depths : null;
      const triangleDepth = triangleDepthAt(
        point,
        [patch.points[0], patch.points[index], patch.points[index + 1]],
        patchDepths
          ? [patchDepths[0], patchDepths[index], patchDepths[index + 1]]
          : [patch.depth, patch.depth, patch.depth],
      );
      if (triangleDepth !== null) {
        depth = depth === null ? triangleDepth : Math.max(depth, triangleDepth);
        break;
      }
    }
  }
  return depth;
}

export function surfaceDepthAt(surface: RenderSurface, point: Point): number | null {
  if (surface.kind === "sphere") return sphereDepthAt(surface, point);
  return surface.kind === "tube" ? tubeDepthAt(surface, point) : polygonDepthAt(surface, point);
}
