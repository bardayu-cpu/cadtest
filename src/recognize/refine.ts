import type { Vec2, Wall } from '../model/types';
import type { LineSegment } from './lines';
import type { VisionWall } from './vision/schema';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
function axisOf(start: Vec2, end: Vec2): 'h' | 'v' | null {
  const dx = Math.abs(end.x - start.x),
    dy = Math.abs(end.y - start.y);
  if (dy <= dx * Math.tan((3 * Math.PI) / 180)) return 'h';
  if (dx <= dy * Math.tan((3 * Math.PI) / 180)) return 'v';
  return null;
}
interface PixelWall {
  id: string;
  axis: 'h' | 'v';
  at: number;
  start: number;
  end: number;
  thickness: number;
  confidence: number;
}

/** Portable pure refinement: vision supplies semantics, pixels supply geometry. */
export function refineWalls(
  walls: readonly VisionWall[],
  lines: readonly LineSegment[],
  mmPerPixel: number,
): Wall[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0)
    throw new Error('Invalid refinement scale.');
  const edges: LineSegment[] = [];
  // Rejoin aligned edge fragments across plausible door-sized gaps.
  for (const line of [...lines].sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.start - b.start,
  )) {
    const existing = edges.find(
      (e) =>
        e.axis === line.axis &&
        Math.abs(e.at - line.at) <= 1.5 &&
        Math.max(e.start, line.start) - Math.min(e.end, line.end) <=
          1200 / mmPerPixel,
    );
    if (existing) {
      existing.start = Math.min(existing.start, line.start);
      existing.end = Math.max(existing.end, line.end);
      existing.support = Math.min(existing.support, line.support);
    } else edges.push({ ...line });
  }
  const aligned: PixelWall[] = [];
  const oblique: Wall[] = [];
  for (const wall of walls) {
    if (
      ![
        wall.start.x,
        wall.start.y,
        wall.end.x,
        wall.end.y,
        wall.thicknessPixels,
      ].every(Number.isFinite) ||
      distance(wall.start, wall.end) < 1 ||
      wall.thicknessPixels <= 0
    )
      throw new Error('Invalid vision wall.');
    const axis = axisOf(wall.start, wall.end);
    const world = (p: Vec2) => ({ x: p.x * mmPerPixel, y: p.y * mmPerPixel });
    if (!axis) {
      oblique.push({
        id: wall.id,
        start: world(wall.start),
        end: world(wall.end),
        thickness: wall.thicknessPixels * mmPerPixel,
        source: 'auto',
        confidence: 0.2,
      });
      continue;
    }
    const along = (p: Vec2) => (axis === 'h' ? p.x : p.y);
    const across = (p: Vec2) => (axis === 'h' ? p.y : p.x);
    const seed: PixelWall = {
      id: wall.id,
      axis,
      at: (across(wall.start) + across(wall.end)) / 2,
      start: Math.min(along(wall.start), along(wall.end)),
      end: Math.max(along(wall.start), along(wall.end)),
      thickness: wall.thicknessPixels,
      confidence: 0.25,
    };
    const near = edges.filter(
      (e) =>
        e.axis === axis &&
        Math.abs(e.at - seed.at) <= 25 &&
        Math.min(e.end, seed.end) - Math.max(e.start, seed.start) > 0,
    );
    const pairs: { a: LineSegment; b: LineSegment; cost: number }[] = [];
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i],
          b = near[j],
          thickness = Math.abs(a.at - b.at),
          center = (a.at + b.at) / 2;
        const overlap =
          Math.min(a.end, b.end, seed.end) -
          Math.max(a.start, b.start, seed.start);
        if (
          thickness * mmPerPixel < 80 ||
          thickness * mmPerPixel > 300 ||
          overlap < Math.min(25, (seed.end - seed.start) * 0.3)
        )
          continue;
        // Favor the nearest centre and thickness, then complete span support.
        const cost =
          Math.abs(center - seed.at) * 3 +
          Math.abs(thickness - seed.thickness) * 0.5 +
          (seed.end - seed.start - overlap) * 0.08;
        pairs.push({ a, b, cost });
      }
    const best = pairs.sort((a, b) => a.cost - b.cost)[0];
    if (best) {
      const { a, b } = best;
      seed.at = (a.at + b.at) / 2;
      seed.thickness = Math.abs(a.at - b.at);
      const endpoints = { start: seed.start, end: seed.end };
      for (const endpoint of ['start', 'end'] as const) {
        const options = [a.start, a.end, b.start, b.end]
          .filter((t) => Math.abs(t - seed[endpoint]) <= 25)
          .sort(
            (x, y) =>
              Math.abs(x - seed[endpoint]) - Math.abs(y - seed[endpoint]),
          );
        if (options.length) endpoints[endpoint] = options[0];
      }
      if (endpoints.end > endpoints.start) {
        seed.start = endpoints.start;
        seed.end = endpoints.end;
      }
      const coverage = Math.min(
        1,
        (Math.min(a.end, b.end, seed.end) -
          Math.max(a.start, b.start, seed.start)) /
          (seed.end - seed.start),
      );
      seed.confidence = Math.max(
        0.4,
        Math.min(
          0.95,
          0.45 + coverage * 0.35 + Math.min(a.support, b.support) * 0.15,
        ),
      );
    }
    aligned.push(seed);
  }
  // Snap only endpoints; a T connection does not split a through-wall.
  // Use a snapshot so results do not depend on mutation order.
  const snapshot = aligned.map((w) => ({ ...w }));
  for (const wall of aligned)
    for (const endpoint of ['start', 'end'] as const) {
      const nearest = snapshot
        .filter(
          (other) =>
            other.axis !== wall.axis &&
            wall.at >= other.start - 25 &&
            wall.at <= other.end + 25 &&
            Math.abs(other.at - wall[endpoint]) <= 25,
        )
        .sort(
          (a, b) =>
            Math.abs(a.at - wall[endpoint]) - Math.abs(b.at - wall[endpoint]),
        )[0];
      if (
        nearest &&
        (endpoint === 'start' ? nearest.at < wall.end : nearest.at > wall.start)
      )
        wall[endpoint] = nearest.at;
    }
  // Merge collinear fragments, preserving changes of thickness.
  const merged: PixelWall[] = [];
  for (const wall of aligned.sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.start - b.start,
  )) {
    const previous = merged.find(
      (other) =>
        other.axis === wall.axis &&
        Math.abs(other.at - wall.at) <= Math.min(3, 45 / mmPerPixel) &&
        Math.abs(other.thickness - wall.thickness) * mmPerPixel <= 60 &&
        Math.max(other.start, wall.start) - Math.min(other.end, wall.end) <= 25,
    );
    if (previous) {
      previous.start = Math.min(previous.start, wall.start);
      previous.end = Math.max(previous.end, wall.end);
      previous.confidence = Math.min(previous.confidence, wall.confidence);
    } else merged.push({ ...wall });
  }
  return [
    ...merged
      .filter((w) => w.end > w.start)
      .map((w) => {
        const point = (t: number) =>
          w.axis === 'h'
            ? { x: t * mmPerPixel, y: w.at * mmPerPixel }
            : { x: w.at * mmPerPixel, y: t * mmPerPixel };
        return {
          id: w.id,
          start: point(w.start),
          end: point(w.end),
          thickness: w.thickness * mmPerPixel,
          source: 'auto' as const,
          confidence: w.confidence,
        };
      }),
    ...oblique,
  ];
}
