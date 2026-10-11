import type { Vec2, Wall } from '../model/types';
import { pointDistance } from '../geometry/canvas';
import { projectToSegment } from '../geometry/walls';
import { pxToMm } from '../geometry/units';

export interface SnapOptions {
  mmPerScreenPixel: number;
  origin?: Vec2;
  shift?: boolean;
  excludeWallId?: string;
}
export interface SnapResult {
  point: Vec2;
  kind: 'endpoint' | 'wall' | 'orthogonal' | 'none';
  wallId?: string;
}
export function snapPoint(
  point: Vec2,
  walls: Wall[],
  options: SnapOptions,
): SnapResult {
  const tolerance = pxToMm(10, options.mmPerScreenPixel);
  const candidates = walls.filter((wall) => wall.id !== options.excludeWallId);
  let best: SnapResult | undefined;
  let distance = Infinity;
  for (const wall of candidates)
    for (const endpoint of [wall.start, wall.end]) {
      const next = pointDistance(point, endpoint);
      if (next <= tolerance && next < distance) {
        best = { point: { ...endpoint }, kind: 'endpoint', wallId: wall.id };
        distance = next;
      }
    }
  if (best) return best;
  for (const wall of candidates) {
    const projected = projectToSegment(point, wall.start, wall.end);
    const next = pointDistance(point, projected);
    if (next <= tolerance && next < distance) {
      best = { point: projected, kind: 'wall', wallId: wall.id };
      distance = next;
    }
  }
  if (best) return best;
  const origin = options.origin;
  if (origin && !options.shift)
    return {
      point:
        Math.abs(point.x - origin.x) >= Math.abs(point.y - origin.y)
          ? { x: point.x, y: origin.y }
          : { x: origin.x, y: point.y },
      kind: 'orthogonal',
    };
  return { point: { ...point }, kind: 'none' };
}
