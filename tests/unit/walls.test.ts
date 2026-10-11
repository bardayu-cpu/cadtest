import { expect, it } from 'vitest';
import {
  fitWallViewport,
  pointAtLength,
  projectToSegment,
  wallOutline,
  wallLength,
} from '../../src/geometry/walls';
const wall = {
  id: 'w',
  start: { x: -500, y: 20 },
  end: { x: 500, y: 20 },
  thickness: 240,
  source: 'manual' as const,
};
it('renders full thickness around the centreline in mm, including diagonal walls', () => {
  expect(wallOutline(wall)).toEqual([
    { x: -500, y: 140 },
    { x: 500, y: 140 },
    { x: 500, y: -100 },
    { x: -500, y: -100 },
  ]);
  const diagonal = { ...wall, start: { x: 0, y: 0 }, end: { x: 300, y: 400 } };
  expect(wallLength(diagonal)).toBe(500);
  const outline = wallOutline(diagonal);
  expect(
    Math.hypot(outline[0].x - outline[3].x, outline[0].y - outline[3].y),
  ).toBeCloseTo(240);
  expect(wallOutline({ ...wall, end: wall.start })).toEqual([]);
});
it('uses entered lengths along the preview direction, with a horizontal fallback and finite validation', () => {
  const start = { x: -100, y: 200 };
  expect(pointAtLength(start, { x: 200, y: 600 }, 1000)).toEqual({
    x: 500,
    y: 1000,
  });
  expect(pointAtLength(start, start, 1200)).toEqual({ x: 1100, y: 200 });
  for (const length of [0, -1, Infinity, NaN])
    expect(() => pointAtLength(start, start, length)).toThrow();
  expect(projectToSegment({ x: 600, y: 50 }, wall.start, wall.end)).toEqual(
    wall.end,
  );
});

it('fits complete wall thickness without a background, with space for the toolbar', () => {
  const view = fitWallViewport([wall], { width: 1000, height: 724 }, 1)!;
  for (const point of wallOutline(wall)) {
    expect(point.x * view.scale + view.x).toBeGreaterThanOrEqual(16);
    expect(point.x * view.scale + view.x).toBeLessThanOrEqual(984);
    expect(point.y * view.scale + view.y).toBeGreaterThanOrEqual(64);
    expect(point.y * view.scale + view.y).toBeLessThanOrEqual(708);
  }
  expect(fitWallViewport([], { width: 1000, height: 724 }, 1)).toBeNull();
});
