import { describe, expect, it } from 'vitest';
import { snapPoint } from '../../src/editor2d/snapping';
import type { Wall } from '../../src/model/types';
const wall: Wall = {
  id: 'w',
  start: { x: 100, y: 100 },
  end: { x: 1000, y: 100 },
  thickness: 120,
  source: 'auto',
};
const options = { mmPerScreenPixel: 2, origin: { x: 0, y: 0 } };
describe('screen-distance wall snapping', () => {
  it('prefers an endpoint within 10 screen pixels over a nearer wall line and orthogonal lock', () => {
    const line = {
      ...wall,
      id: 'line',
      start: { x: 90, y: 0 },
      end: { x: 90, y: 500 },
    };
    expect(snapPoint({ x: 90, y: 100 }, [wall, line], options)).toEqual({
      point: wall.start,
      kind: 'endpoint',
      wallId: 'w',
    });
  });
  it('projects onto an existing segment before orthogonal locking', () => {
    expect(snapPoint({ x: 500, y: 112 }, [wall], options)).toEqual({
      point: { x: 500, y: 100 },
      kind: 'wall',
      wallId: 'w',
    });
  });
  it('locks to the closer horizontal or vertical axis and Shift disables only that lock', () => {
    expect(snapPoint({ x: 400, y: 30 }, [], options)).toEqual({
      point: { x: 400, y: 0 },
      kind: 'orthogonal',
    });
    expect(snapPoint({ x: 30, y: 400 }, [], options).point).toEqual({
      x: 0,
      y: 400,
    });
    expect(
      snapPoint({ x: 400, y: 30 }, [], { ...options, shift: true }),
    ).toEqual({ point: { x: 400, y: 30 }, kind: 'none' });
    expect(
      snapPoint({ x: 101, y: 100 }, [wall], { ...options, shift: true }).kind,
    ).toBe('endpoint');
  });
  it('keeps a 10-pixel threshold at different zoom/calibration ratios, including the boundary', () => {
    expect(snapPoint({ x: 120, y: 100 }, [wall], options).kind).toBe(
      'endpoint',
    );
    expect(snapPoint({ x: 120.01, y: 100 }, [wall], options).kind).toBe('wall');
    expect(
      snapPoint({ x: 150, y: 100 }, [wall], { mmPerScreenPixel: 5 }).kind,
    ).toBe('endpoint');
    expect(
      snapPoint({ x: 150, y: 100 }, [wall], { mmPerScreenPixel: 1 }).kind,
    ).toBe('wall');
  });
  it('excludes the wall being dragged and does not snap to infinite line extensions', () => {
    expect(
      snapPoint({ x: 100, y: 100 }, [wall], { ...options, excludeWallId: 'w' })
        .kind,
    ).toBe('orthogonal');
    expect(
      snapPoint({ x: 1200, y: 100 }, [wall], { mmPerScreenPixel: 2 }).kind,
    ).toBe('none');
  });
});
