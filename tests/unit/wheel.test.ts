import { describe, expect, it } from 'vitest';
import {
  wheelViewport,
  screenToCanvas,
  type WheelInput,
} from '../../src/geometry/canvas';

const view = { x: 40, y: -20, scale: 2 };
const pointer = { x: 200, y: 180 };
const canvas = { width: 1000, height: 724 };
const input: WheelInput = {
  deltaX: 10,
  deltaY: 20,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
};

describe('wheel gestures', () => {
  it('pans ordinary wheels and two-finger trackpad scrolling without changing scale', () => {
    expect(wheelViewport(view, pointer, input, canvas, false)).toEqual({
      x: 30,
      y: -40,
      scale: 2,
    });
    expect(
      wheelViewport(view, pointer, { ...input, deltaY: 0 }, canvas, false),
    ).toEqual({ x: 30, y: -20, scale: 2 });
  });
  it.each(['ctrlKey', 'metaKey'] as const)(
    'zooms %s wheels and keeps the point under the pointer fixed',
    (modifier) => {
      const zoomed = wheelViewport(
        view,
        pointer,
        { ...input, [modifier]: true, deltaY: -20 },
        canvas,
        false,
      );
      expect(zoomed.scale).toBeGreaterThan(view.scale);
      const first = screenToCanvas(pointer, view);
      const second = screenToCanvas(pointer, zoomed);
      expect(first.x).toBeCloseTo(second.x);
      expect(first.y).toBeCloseTo(second.y);
      expect(
        wheelViewport(
          view,
          pointer,
          { ...input, [modifier]: true },
          canvas,
          false,
        ).scale,
      ).toBeLessThan(view.scale);
    },
  );
  it('leaves a locked viewport unchanged for every gesture', () => {
    for (const event of [
      input,
      { ...input, ctrlKey: true },
      { ...input, metaKey: true },
    ])
      expect(wheelViewport(view, pointer, event, canvas, true)).toBe(view);
  });
  it('normalizes line and page wheel units before panning', () => {
    expect(
      wheelViewport(
        view,
        pointer,
        { ...input, deltaX: 1, deltaY: 2, deltaMode: 1 },
        canvas,
        false,
      ),
    ).toEqual({ x: 24, y: -52, scale: 2 });
    expect(
      wheelViewport(
        view,
        pointer,
        { ...input, deltaX: 1, deltaY: 1, deltaMode: 2 },
        canvas,
        false,
      ),
    ).toEqual({ x: -960, y: -744, scale: 2 });
  });
});
