import type { Vec2, Wall } from '../model/types';
import {
  pointDistance,
  type Size,
  type Viewport,
  MIN_ZOOM,
  MAX_ZOOM,
} from './canvas';
import { mmToPx } from './units';

export const wallLength = (wall: Pick<Wall, 'start' | 'end'>) =>
  pointDistance(wall.start, wall.end);
export function projectToSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  const t = squared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared,
        ),
      )
    : 0;
  return { x: start.x + t * dx, y: start.y + t * dy };
}
export function pointAtLength(
  start: Vec2,
  direction: Vec2,
  length: number,
): Vec2 {
  if (!Number.isFinite(length) || length <= 0)
    throw new Error('请输入大于零的墙体长度（mm）。');
  const distance = pointDistance(start, direction);
  const dx = distance ? (direction.x - start.x) / distance : 1;
  const dy = distance ? (direction.y - start.y) / distance : 0;
  const point = { x: start.x + dx * length, y: start.y + dy * length };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error('墙体长度超出有效范围。');
  return point;
}
export function wallOutline(wall: Wall): Vec2[] {
  const length = wallLength(wall);
  if (!length) return [];
  const x = ((-(wall.end.y - wall.start.y) / length) * wall.thickness) / 2;
  const y = (((wall.end.x - wall.start.x) / length) * wall.thickness) / 2;
  return [
    { x: wall.start.x + x, y: wall.start.y + y },
    { x: wall.end.x + x, y: wall.end.y + y },
    { x: wall.end.x - x, y: wall.end.y - y },
    { x: wall.start.x - x, y: wall.start.y - y },
  ];
}

export function fitWallViewport(
  walls: Wall[],
  canvas: Size,
  mmPerPixel: number,
): Viewport | null {
  const points = walls.flatMap(wallOutline);
  if (!points.length) return null;
  const xs = points.map((point) => mmToPx(point.x, mmPerPixel));
  const ys = points.map((point) => mmToPx(point.y, mmPerPixel));
  const minX = Math.min(...xs),
    minY = Math.min(...ys);
  const width = Math.max(...xs) - minX,
    height = Math.max(...ys) - minY;
  const scale = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min((canvas.width - 32) / width, (canvas.height - 80) / height),
    ),
  );
  return {
    scale,
    x: (canvas.width - width * scale) / 2 - minX * scale,
    y: 64 + (canvas.height - 80 - height * scale) / 2 - minY * scale,
  };
}
