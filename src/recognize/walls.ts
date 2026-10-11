import type { Wall } from '../model/types';
import type { LineSegment } from './lines';

export interface PixelWall {
  axis: 'h' | 'v';
  at: number;
  start: number;
  end: number;
  thickness: number;
  support: number;
}

export function detectWalls(
  lines: readonly LineSegment[],
  mmPerPixel: number,
): Wall[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0)
    throw new Error('Invalid wall scale.');
  // Reconnect collinear edge fragments before pairing (door/window gaps).
  const edges: LineSegment[] = [];
  for (const line of [...lines].sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.start - b.start,
  )) {
    const previous = edges.find(
      (edge) =>
        edge.axis === line.axis &&
        Math.abs(edge.at - line.at) < 1.6 &&
        Math.max(edge.start, line.start) - Math.min(edge.end, line.end) <
          1200 / mmPerPixel,
    );
    if (previous) {
      previous.start = Math.min(previous.start, line.start);
      previous.end = Math.max(previous.end, line.end);
      previous.support = Math.min(previous.support, line.support);
    } else edges.push({ ...line });
  }
  const candidates: PixelWall[] = [];
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j];
      if (a.axis !== b.axis) continue;
      const thickness = Math.abs(a.at - b.at);
      if (thickness * mmPerPixel < 80 || thickness * mmPerPixel > 300) continue;
      const start = Math.max(a.start, b.start),
        end = Math.min(a.end, b.end);
      if ((end - start) * mmPerPixel < 500) continue;
      const overlap =
        (end - start) / Math.min(a.end - a.start, b.end - b.start);
      if (overlap < 0.65) continue;
      candidates.push({
        axis: a.axis,
        at: (a.at + b.at) / 2,
        start,
        end,
        thickness,
        support: ((a.support + b.support) / 2) * overlap,
      });
    }
  // Prefer broad structural pairs over the narrow multiple lines of windows.
  const unique: PixelWall[] = [];
  for (const wall of candidates.sort(
    (a, b) => b.thickness - a.thickness || b.end - b.start - (a.end - a.start),
  )) {
    if (
      unique.some(
        (other) =>
          other.axis === wall.axis &&
          Math.abs(other.at - wall.at) <
            (other.thickness + wall.thickness) / 2 &&
          Math.min(other.end, wall.end) - Math.max(other.start, wall.start) >
            Math.min(other.end - other.start, wall.end - wall.start) * 0.8,
      )
    )
      continue;
    unique.push({ ...wall });
  }
  // Join gaps small enough to be a doorway. This is geometric continuity only,
  // not opening recognition, and is deliberately independent of sample names.
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < unique.length; i++)
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i],
          b = unique[j];
        const gap = Math.max(a.start, b.start) - Math.min(a.end, b.end);
        if (
          a.axis !== b.axis ||
          Math.abs(a.at - b.at) * mmPerPixel > 45 ||
          Math.abs(a.thickness - b.thickness) * mmPerPixel > 65 ||
          gap * mmPerPixel > 1200
        )
          continue;
        a.start = Math.min(a.start, b.start);
        a.end = Math.max(a.end, b.end);
        a.support = Math.min(a.support, b.support);
        unique.splice(j, 1);
        changed = true;
        break outer;
      }
  }
  // Extend only nearby paired-wall intersections; avoid snapping to furniture
  // endpoints farther than half a wall width away.
  for (const wall of unique)
    for (const endpoint of ['start', 'end'] as const) {
      const nearest = unique
        .filter(
          (other) =>
            other.axis !== wall.axis &&
            wall.at >= other.start - other.thickness &&
            wall.at <= other.end + other.thickness &&
            Math.abs(other.at - wall[endpoint]) <=
              Math.max(wall.thickness, other.thickness),
        )
        .sort(
          (a, b) =>
            Math.abs(a.at - wall[endpoint]) - Math.abs(b.at - wall[endpoint]),
        )[0];
      if (nearest) wall[endpoint] = nearest.at;
    }
  // Furniture usually forms detached paired rectangles. Retain connected wall
  // chains and long isolated structural spans, with reduced confidence.
  const connected = (wall: PixelWall) =>
    unique.filter(
      (other) =>
        other !== wall &&
        other.axis !== wall.axis &&
        other.at >= wall.start - other.thickness &&
        other.at <= wall.end + other.thickness &&
        wall.at >= other.start - wall.thickness &&
        wall.at <= other.end + wall.thickness,
    ).length;
  const components = new Map<PixelWall, number>();
  let componentId = 0;
  for (const seed of unique) {
    if (components.has(seed)) continue;
    const pending = [seed];
    components.set(seed, componentId);
    while (pending.length) {
      const wall = pending.pop()!;
      for (const other of unique) {
        if (components.has(other) || other.axis === wall.axis) continue;
        if (
          other.at >= wall.start - other.thickness &&
          other.at <= wall.end + other.thickness &&
          wall.at >= other.start - wall.thickness &&
          wall.at <= other.end + wall.thickness
        ) {
          components.set(other, componentId);
          pending.push(other);
        }
      }
    }
    componentId++;
  }
  const filtered = unique.filter((wall) => {
    const group = unique.filter(
      (other) => components.get(other) === components.get(wall),
    );
    if (group.length === 1) return (wall.end - wall.start) * mmPerPixel >= 1500;
    const xs = group.flatMap((part) =>
      part.axis === 'h' ? [part.start, part.end] : [part.at],
    );
    const ys = group.flatMap((part) =>
      part.axis === 'v' ? [part.start, part.end] : [part.at],
    );
    return (
      Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      ) *
        mmPerPixel >=
      2500
    );
  });
  return filtered
    .sort(
      (a, b) =>
        a.axis.localeCompare(b.axis) || a.at - b.at || a.start - b.start,
    )
    .map((wall, index) => {
      const point = (t: number) =>
        wall.axis === 'h'
          ? { x: t * mmPerPixel, y: wall.at * mmPerPixel }
          : { x: wall.at * mmPerPixel, y: t * mmPerPixel };
      return {
        id: `auto-wall-${index + 1}`,
        start: point(wall.start),
        end: point(wall.end),
        thickness: wall.thickness * mmPerPixel,
        source: 'auto',
        confidence: Math.max(
          0,
          Math.min(
            1,
            0.35 +
              wall.support * 0.35 +
              Math.min(2, connected(wall)) * 0.1 +
              Math.min(1, ((wall.end - wall.start) * mmPerPixel) / 4000) * 0.1,
          ),
        ),
      };
    });
}
