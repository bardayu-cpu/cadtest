import polygonClipping from 'polygon-clipping';
import type { Opening, Vec2, Wall } from '../model/types';
import type { RecognitionData } from './types';

export const OPENING_KINDS = [
  'door',
  'window',
  'sliding_door',
  'opening',
  'floor_window',
] as const satisfies readonly Opening['kind'][];

export interface MatchMetrics {
  predicted: number;
  expected: number;
  matched: number;
  precision: number;
  recall: number;
}

export interface Evaluation {
  scaleRelativeError: number | null;
  walls: MatchMetrics;
  openings: Record<Opening['kind'], MatchMetrics>;
  rooms: MatchMetrics & { typeMatched: number };
}

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function pointToSegment(point: Vec2, wall: Wall): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, wall.start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
        lengthSquared,
    ),
  );
  return distance(point, {
    x: wall.start.x + t * dx,
    y: wall.start.y + t * dy,
  });
}

function wallsMatch(a: Wall, b: Wall): boolean {
  if (distance(a.start, a.end) === 0 || distance(b.start, b.end) === 0)
    return false;
  const angleA = Math.atan2(a.end.y - a.start.y, a.end.x - a.start.x);
  const angleB = Math.atan2(b.end.y - b.start.y, b.end.x - b.start.x);
  const difference = Math.abs(angleA - angleB) % Math.PI;
  const angle = Math.min(difference, Math.PI - difference);
  // Symmetric segment Hausdorff distance also penalizes truncated/extended walls.
  const separation = Math.max(
    pointToSegment(a.start, b),
    pointToSegment(a.end, b),
    pointToSegment(b.start, a),
    pointToSegment(b.end, a),
  );
  return separation < 100 && angle < (3 * Math.PI) / 180;
}

export function openingCenter(
  opening: Opening,
  walls: readonly Wall[],
): Vec2 | null {
  const wall = walls.find((item) => item.id === opening.wallId);
  if (!wall) return null;
  const length = distance(wall.start, wall.end);
  if (length === 0) return null;
  // The model offset is the opening center measured from wall.start in mm.
  return {
    x: wall.start.x + ((wall.end.x - wall.start.x) * opening.offset) / length,
    y: wall.start.y + ((wall.end.y - wall.start.y) * opening.offset) / length,
  };
}

function ringArea(ring: readonly Vec2[]): number {
  return Math.abs(
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

export function polygonIoU(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const areaA = ringArea(a);
  const areaB = ringArea(b);
  if (areaA === 0 || areaB === 0) return 0;
  const ring = (points: readonly Vec2[]): polygonClipping.Ring =>
    points.map(({ x, y }) => [x, y]);
  const intersection = polygonClipping.intersection([ring(a)], [ring(b)]);
  const intersectionArea = intersection.reduce(
    (total, polygon) =>
      total +
      polygon.reduce(
        (area, boundary, index) =>
          area +
          (index === 0 ? 1 : -1) *
            ringArea(boundary.map(([x, y]) => ({ x, y }))),
        0,
      ),
    0,
  );
  return intersectionArea / (areaA + areaB - intersectionArea);
}

// Augmenting paths give a maximum-cardinality one-to-one matching. Unlike a
// greedy loop, this is invariant to input order even when tolerances overlap.
function match<T>(
  predicted: readonly T[],
  expected: readonly T[],
  eligible: (a: T, b: T) => boolean,
): [number, number][] {
  const candidates = predicted.map((a) =>
    expected.flatMap((b, index) => (eligible(a, b) ? [index] : [])),
  );
  const owners = new Map<number, number>();
  function assign(index: number, visited: Set<number>): boolean {
    for (const target of candidates[index]) {
      if (visited.has(target)) continue;
      visited.add(target);
      const owner = owners.get(target);
      if (owner === undefined || assign(owner, visited)) {
        owners.set(target, index);
        return true;
      }
    }
    return false;
  }
  predicted.forEach((_, index) => assign(index, new Set()));
  return [...owners].map(([target, index]) => [index, target]);
}

function metrics(
  predicted: number,
  expected: number,
  matched: number,
): MatchMetrics {
  return {
    predicted,
    expected,
    matched,
    precision: predicted === 0 ? (expected === 0 ? 1 : 0) : matched / predicted,
    recall: expected === 0 ? 1 : matched / expected,
  };
}

export function evaluate(
  predicted: RecognitionData,
  expected: RecognitionData,
): Evaluation {
  const walls = match(predicted.walls, expected.walls, wallsMatch);
  const openings = Object.fromEntries(
    OPENING_KINDS.map((kind) => {
      const actual = predicted.openings.filter((item) => item.kind === kind);
      const truth = expected.openings.filter((item) => item.kind === kind);
      const pairs = match(actual, truth, (a, b) => {
        const centerA = openingCenter(a, predicted.walls);
        const centerB = openingCenter(b, expected.walls);
        return (
          centerA !== null &&
          centerB !== null &&
          distance(centerA, centerB) < 200
        );
      });
      return [kind, metrics(actual.length, truth.length, pairs.length)];
    }),
  ) as Evaluation['openings'];
  const rooms = match(
    predicted.rooms,
    expected.rooms,
    (a, b) => polygonIoU(a.polygon, b.polygon) >= 0.8,
  );
  const validScale = (value: number | null): value is number =>
    value !== null && Number.isFinite(value) && value > 0;
  return {
    scaleRelativeError:
      validScale(predicted.mmPerPixel) && validScale(expected.mmPerPixel)
        ? Math.abs(predicted.mmPerPixel - expected.mmPerPixel) /
          expected.mmPerPixel
        : null,
    walls: metrics(predicted.walls.length, expected.walls.length, walls.length),
    openings,
    rooms: {
      ...metrics(predicted.rooms.length, expected.rooms.length, rooms.length),
      typeMatched: rooms.filter(
        ([a, b]) => predicted.rooms[a].type === expected.rooms[b].type,
      ).length,
    },
  };
}
