import { describe, expect, it } from 'vitest';
import {
  calibrationScale,
  canvasToScreen,
  fitImage,
  MAX_ZOOM,
  MIN_ZOOM,
  pointDistance,
  screenToCanvas,
  screenToImage,
  screenToMm,
  zoomAt,
} from '../../src/geometry/canvas';
import { pxToMm } from '../../src/geometry/units';
import { createProjectStore } from '../../src/model/store';
import { completeProject } from '../helpers/project';
import { memoryStorage } from '../helpers/storage';
import fixture from '../../fixtures/floorplan-a.calibration.json';

describe('canvas coordinates and calibration', () => {
  it('maps between screen pixels, image pixels and model millimetres with pan, zoom and background offset', () => {
    const background = {
      ...completeProject().background,
      mmPerPixel: 10,
      offset: { x: 100, y: -200 },
    };
    const view = { x: 40, y: -30, scale: 2 };
    const screen = { x: 140, y: 70 };
    expect(screenToCanvas(screen, view)).toEqual({ x: 50, y: 50 });
    expect(canvasToScreen({ x: 50, y: 50 }, view)).toEqual(screen);
    expect(screenToImage(screen, view, background)).toEqual({ x: 40, y: 70 });
    expect(screenToMm(screen, view, 10)).toEqual({ x: 500, y: 500 });
  });
  it('keeps the world position under the pointer fixed while zooming, including at zoom limits', () => {
    const view = { x: -120, y: 70, scale: 0.5 };
    const pointer = { x: 123, y: 234 };
    for (const factor of [1.12, 1 / 1.12, 1e8, 1e-8]) {
      const next = zoomAt(view, pointer, factor);
      expect(screenToCanvas(pointer, next).x).toBeCloseTo(
        screenToCanvas(pointer, view).x,
      );
      expect(screenToCanvas(pointer, next).y).toBeCloseTo(
        screenToCanvas(pointer, view).y,
      );
      expect(next.scale).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(next.scale).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });
  it('fits and centers a native image without losing the background millimetre offset', () => {
    const background = completeProject().background;
    const view = fitImage(
      { width: 1264, height: 921 },
      { width: 800, height: 520 },
      background,
    );
    const imageCenter = {
      x: 1264 / 2 + background.offset.x / background.mmPerPixel,
      y: 921 / 2 + background.offset.y / background.mmPerPixel,
    };
    expect(canvasToScreen(imageCenter, view)).toEqual({ x: 400, y: 260 });
    expect(view.scale * 1264).toBeLessThanOrEqual(768);
    expect(view.scale * 921).toBeLessThanOrEqual(488);
  });
  it('fits below the toolbar so dimension endpoints remain clickable', () => {
    const view = fitImage(
      { width: 1264, height: 921 },
      { width: 1000, height: 724 },
      { ...completeProject().background, offset: { x: 0, y: 0 } },
      { top: 64, bottom: 16 },
    );
    expect(canvasToScreen(fixture.top[0], view).y).toBeGreaterThan(64);
    expect(canvasToScreen(fixture.top[1], view).y).toBeGreaterThan(64);
    expect(canvasToScreen(fixture.bottom[1], view).y).toBeLessThan(708);
  });
  it('calibrates the fixture top 15040 line and measures the bottom line within 1%', () => {
    const scale = calibrationScale(
      fixture.top[0],
      fixture.top[1],
      fixture.distanceMm,
    );
    const measured = pxToMm(
      pointDistance(fixture.bottom[0], fixture.bottom[1]),
      scale,
    );
    expect(
      Math.abs(measured - fixture.distanceMm) / fixture.distanceMm,
    ).toBeLessThan(0.01);
  });
  it('uses Euclidean pixel distance for diagonal calibration', () => {
    expect(calibrationScale({ x: 0, y: 0 }, { x: 3, y: 4 }, 500)).toBe(100);
  });
  it.each([0, -10, NaN, Infinity])(
    'rejects invalid real distances: %s',
    (distance) => {
      expect(() =>
        calibrationScale({ x: 0, y: 0 }, { x: 10, y: 0 }, distance),
      ).toThrow('真实距离');
    },
  );
  it('rejects coincident, too-close and non-finite points', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: Infinity, y: 0 },
    ])
      expect(() => calibrationScale({ x: 0, y: 0 }, point, 15040)).toThrow(
        '校准点',
      );
  });
  it('recalibrates only the background ratio, preserving every geometry coordinate through undo/redo and persistence', async () => {
    const project = completeProject();
    const storage = memoryStorage([project]);
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    await store.getState().openProject(project.id);
    const scale = calibrationScale(
      fixture.top[0],
      fixture.top[1],
      fixture.distanceMm,
    );
    store.getState().updateBackground({ mmPerPixel: scale });
    store.getState().updateBackground({ mmPerPixel: scale / 2 });
    const expected = {
      ...project,
      background: { ...project.background, mmPerPixel: scale / 2 },
    };
    expect(store.getState().currentProject).toEqual(expected);
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().currentProject).toEqual({
      ...project,
      background: { ...project.background, mmPerPixel: scale },
    });
    store.getState().undo();
    expect(store.getState().currentProject).toEqual(project);
    store.getState().redo();
    store.getState().redo();
    await store.getState().flush();
    expect(await storage.loadProject(project.id)).toEqual(expected);
  });
});
