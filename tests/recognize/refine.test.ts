import { describe, expect, it } from 'vitest';
import { refineWalls } from '../../src/recognize/refine';
import { visionToRecognition } from '../../src/recognize/vision/convert';
import {
  validateVisionPlan,
  type VisionWall,
  type VisionPlan,
} from '../../src/recognize/vision/schema';
import { recognitionDataSchema } from '../../src/recognize/schema';

const wall = (
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thicknessPixels = 10,
): VisionWall => ({
  id,
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
  kind: 'interior',
  thicknessPixels,
});
const line = (axis: 'h' | 'v', at: number, start: number, end: number) => ({
  axis,
  at,
  start,
  end,
  support: 1,
});
describe('vision-guided pixel refinement', () => {
  it('aligns a perturbed centreline, wall width and endpoints to nearby double edges without mutating inputs', () => {
    const seeds = [wall('h', 100, 52, 300, 54)];
    const lines = [line('h', 50, 90, 310), line('h', 60, 90, 310)];
    const before = JSON.stringify({ seeds, lines });
    const result = refineWalls(seeds, lines, 10);
    expect(result[0]).toMatchObject({
      start: { x: 900, y: 550 },
      end: { x: 3100, y: 550 },
      thickness: 100,
      source: 'auto',
    });
    expect(result[0].confidence).toBeGreaterThan(0.8);
    expect(JSON.stringify({ seeds, lines })).toBe(before);
  });
  it('retains a short segment when both endpoints prefer the same edge endpoint', () => {
    const result = refineWalls(
      [wall('short', 90, 55, 95, 55)],
      [line('h', 50, 0, 100), line('h', 60, 0, 100)],
      10,
    );
    expect(result).toHaveLength(1);
    expect(result[0].end.x).toBeGreaterThan(result[0].start.x);
    expect(Number.isFinite(result[0].confidence)).toBe(true);
  });
  it('reconnects interrupted edges at a doorway', () => {
    const result = refineWalls(
      [wall('h', 30, 65, 210, 65)],
      [
        line('h', 60, 30, 90),
        line('h', 60, 150, 210),
        line('h', 70, 30, 90),
        line('h', 70, 150, 210),
      ],
      10,
    );
    expect(result[0]).toMatchObject({
      start: { x: 300, y: 650 },
      end: { x: 2100, y: 650 },
      thickness: 100,
    });
  });
  it('connects a T stem without splitting its through-wall', () => {
    const result = refineWalls(
      [wall('h', 20, 50, 300, 50), wall('v', 150, 63, 150, 200)],
      [],
      10,
    );
    expect(result).toHaveLength(2);
    expect(result.find((w) => w.id === 'v')?.start).toEqual({
      x: 1500,
      y: 500,
    });
    expect(result.find((w) => w.id === 'h')?.end).toEqual({ x: 3000, y: 500 });
  });
  it('merges nearby collinear segments but preserves thickness changes', () => {
    expect(
      refineWalls(
        [wall('a', 20, 50, 100, 50), wall('b', 115, 50, 200, 50)],
        [],
        10,
      ),
    ).toHaveLength(1);
    expect(
      refineWalls(
        [wall('a', 20, 50, 100, 50, 10), wall('b', 100, 50, 200, 50, 24)],
        [],
        10,
      ),
    ).toHaveLength(2);
  });
  it('keeps unsupported or oblique walls with low confidence instead of inventing support', () => {
    const seeds = [wall('h', 20, 50, 300, 50), wall('d', 400, 100, 500, 200)];
    const result = refineWalls(
      seeds,
      [line('h', 100, 20, 300), line('h', 110, 20, 300)],
      10,
    );
    expect(result).toHaveLength(2);
    expect(result.every((w) => w.confidence! <= 0.25)).toBe(true);
    expect(result.find((w) => w.id === 'd')?.end).toEqual({ x: 5000, y: 2000 });
  });
  it('orthogonalizes only within three degrees and validates scale/geometry', () => {
    expect(
      refineWalls([wall('near', 20, 50, 220, 56)], [], 10)[0].start.y,
    ).toBe(530);
    expect(refineWalls([wall('far', 20, 50, 220, 70)], [], 10)[0].end.y).toBe(
      700,
    );
    expect(() => refineWalls([], [], 0)).toThrow('scale');
    expect(() => refineWalls([wall('zero', 20, 50, 20, 50)], [], 10)).toThrow(
      'vision wall',
    );
  });
});
describe('vision schema and model conversion', () => {
  const plan: VisionPlan = {
    walls: [wall('h', 10, 50, 210, 50)],
    openings: [
      { kind: 'door', wallId: 'h', center: { x: 110, y: 50 }, widthPixels: 20 },
    ],
    rooms: [
      {
        type: 'other',
        name: 'Room',
        polygon: [
          { x: 10, y: 50 },
          { x: 210, y: 50 },
          { x: 210, y: 150 },
          { x: 10, y: 150 },
        ],
      },
    ],
  };
  it('converts pixel openings and polygons to mm without changing model predictions', () => {
    const result = visionToRecognition(plan, 10);
    expect(result.walls[0].start).toEqual({ x: 100, y: 500 });
    expect(result.openings[0]).toMatchObject({
      wallId: 'h',
      offset: 1000,
      width: 200,
      kind: 'door',
      source: 'auto',
    });
    expect(result.rooms[0].polygon[2]).toEqual({ x: 2100, y: 1500 });
    expect(recognitionDataSchema.parse(result)).toEqual(result);
  });
  it('rebinds an opening to a merged containing wall', () => {
    const merged = refineWalls(
      [wall('first', 10, 50, 100, 50), wall('h', 100, 50, 210, 50)],
      [],
      10,
    );
    const result = visionToRecognition(plan, 10, merged);
    expect(result.openings[0].wallId).toBe('first');
    expect(result.openings[0].offset).toBe(1000);
  });
  it('rejects malformed, duplicate, out-of-frame, and dangling-reference model output', () => {
    expect(() =>
      validateVisionPlan(
        { ...plan, walls: [plan.walls[0], plan.walls[0]] },
        300,
        200,
      ),
    ).toThrow('Duplicate');
    expect(() => validateVisionPlan(plan, 100, 200)).toThrow('bounds');
    expect(() =>
      validateVisionPlan(
        { ...plan, openings: [{ ...plan.openings[0], wallId: 'missing' }] },
        300,
        200,
      ),
    ).toThrow('wall ID');
    expect(() =>
      validateVisionPlan(
        { ...plan, walls: [wall('zero', 10, 50, 10, 50)] },
        300,
        200,
      ),
    ).toThrow('Degenerate');
    expect(() =>
      validateVisionPlan({ ...plan, extra: true }, 300, 200),
    ).toThrow();
  });
});
