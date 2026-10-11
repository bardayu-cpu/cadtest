import type { Project, Vec2 } from '../model/types';
import { mmToPx, pxToMm } from './units';

export type Viewport = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

export function screenToCanvas(point: Vec2, view: Viewport): Vec2 {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  };
}
export function canvasToScreen(point: Vec2, view: Viewport): Vec2 {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}
export function screenToImage(
  point: Vec2,
  view: Viewport,
  background: Project['background'],
): Vec2 {
  const world = screenToCanvas(point, view);
  return {
    x: world.x - mmToPx(background.offset.x, background.mmPerPixel),
    y: world.y - mmToPx(background.offset.y, background.mmPerPixel),
  };
}
export function screenToMm(
  point: Vec2,
  view: Viewport,
  mmPerPixel: number,
): Vec2 {
  const world = screenToCanvas(point, view);
  return { x: pxToMm(world.x, mmPerPixel), y: pxToMm(world.y, mmPerPixel) };
}
export function pointDistance(first: Vec2, second: Vec2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
export function calibrationScale(
  first: Vec2,
  second: Vec2,
  realDistanceMm: number,
): number {
  const distance = pointDistance(first, second);
  if (!Number.isFinite(distance) || distance < 1)
    throw new Error('两个校准点至少需要相距 1 像素，请重新选点。');
  if (!Number.isFinite(realDistanceMm) || realDistanceMm <= 0)
    throw new Error('请输入大于零的真实距离（mm）。');
  const scale = realDistanceMm / distance;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('比例尺无效，请重新输入真实距离。');
  return scale;
}
export function zoomAt(
  view: Viewport,
  pointer: Vec2,
  factor: number,
): Viewport {
  const point = screenToCanvas(pointer, view);
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
  return {
    scale,
    x: pointer.x - point.x * scale,
    y: pointer.y - point.y * scale,
  };
}
export function fitImage(
  image: Size,
  canvas: Size,
  background: Project['background'],
): Viewport {
  const scale = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min(
        (canvas.width - 32) / image.width,
        (canvas.height - 32) / image.height,
      ),
    ),
  );
  return {
    scale,
    x:
      (canvas.width - image.width * scale) / 2 -
      mmToPx(background.offset.x, background.mmPerPixel) * scale,
    y:
      (canvas.height - image.height * scale) / 2 -
      mmToPx(background.offset.y, background.mmPerPixel) * scale,
  };
}
