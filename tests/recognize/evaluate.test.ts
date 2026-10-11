import { describe, expect, it } from 'vitest';
import type { Opening, Room, Vec2, Wall } from '../../src/model/types';
import {
  evaluate,
  openingCenter,
  polygonIoU,
} from '../../src/recognize/evaluate';
import type { RecognitionData } from '../../src/recognize/types';

const wall = (id = 'w', y = 0): Wall => ({
  id,
  start: { x: 0, y },
  end: { x: 1000, y },
  thickness: 240,
  source: 'manual',
});
const opening = (
  kind: Opening['kind'] = 'door',
  offset = 500,
  wallId = 'w',
): Opening => ({
  id: 'o',
  wallId,
  offset,
  width: 500,
  kind,
  sillHeight: 0,
  headHeight: 2100,
  source: 'manual',
});
const rect = (x: number, y: number, width: number, height: number): Vec2[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const room = (
  polygon = rect(0, 0, 1000, 1000),
  type: Room['type'] = 'bedroom',
): Room => ({
  id: 'r',
  type,
  name: 'Bedroom',
  polygon,
  ceilingStyle: 'flat',
  source: 'manual',
});
const data = (patch: Partial<RecognitionData> = {}): RecognitionData => ({
  mmPerPixel: 10,
  walls: [wall()],
  openings: [opening()],
  rooms: [room()],
  ...patch,
});

describe('recognition evaluation', () => {
  it('scores perfect geometry independently of IDs without mutating inputs', () => {
    const truth = data();
    const actual = data({
      walls: [wall('new')],
      openings: [opening('door', 500, 'new')],
    });
    const before = JSON.stringify([actual, truth]);
    const score = evaluate(actual, truth);
    expect(score.scaleRelativeError).toBe(0);
    expect(score.walls).toMatchObject({ precision: 1, recall: 1, matched: 1 });
    expect(score.openings.door).toMatchObject({ precision: 1, recall: 1 });
    expect(score.rooms).toMatchObject({ matched: 1, typeMatched: 1 });
    expect(JSON.stringify([actual, truth])).toBe(before);
  });
  it('scores partial recall and false positives', () => {
    const score = evaluate(
      data({ walls: [wall(), wall('false', 2000)] }),
      data({ walls: [wall(), wall('missing', 4000)] }),
    );
    expect(score.walls).toMatchObject({
      matched: 1,
      recall: 0.5,
      precision: 0.5,
    });
  });
  it('accepts wall direction reversal', () => {
    const original = wall();
    expect(
      evaluate(
        data({
          walls: [{ ...original, start: original.end, end: original.start }],
        }),
        data(),
      ).walls.matched,
    ).toBe(1);
  });
  it.each([2.99, 3.01])(
    'checks the wall angle threshold at %s degrees',
    (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const tilted = {
        ...wall(),
        end: { x: 1000 * Math.cos(radians), y: 1000 * Math.sin(radians) },
      };
      expect(evaluate(data({ walls: [tilted] }), data()).walls.matched).toBe(
        degrees < 3 ? 1 : 0,
      );
    },
  );
  it.each([99, 100, 101])(
    'uses a strict 100mm wall distance threshold at %s',
    (offset) => {
      expect(
        evaluate(data({ walls: [wall('shifted', offset)] }), data()).walls
          .matched,
      ).toBe(offset < 100 ? 1 : 0);
    },
  );
  it('rejects a tiny collinear wall fragment and distant collinear walls', () => {
    const small = { ...wall(), end: { x: 50, y: 0 } };
    const distant = {
      ...wall(),
      start: { x: 2000, y: 0 },
      end: { x: 3000, y: 0 },
    };
    expect(
      evaluate(data({ walls: [small, distant] }), data()).walls.matched,
    ).toBe(0);
  });
  it('does not score duplicate walls twice', () => {
    expect(
      evaluate(data({ walls: [wall('a'), wall('b')] }), data()).walls,
    ).toMatchObject({ matched: 1, precision: 0.5, recall: 1 });
  });
  it('finds a maximum matching instead of an order-dependent greedy match', () => {
    const actual = data({
      walls: [wall('ambiguous', 50), wall('only-first', -40)],
    });
    const truth = data({ walls: [wall('first', 0), wall('second', 140)] });
    expect(evaluate(actual, truth).walls.matched).toBe(2);
    expect(
      evaluate({ ...actual, walls: [...actual.walls].reverse() }, truth).walls
        .matched,
    ).toBe(2);
  });
  it('rejects zero-length walls', () => {
    expect(
      evaluate(data({ walls: [{ ...wall(), end: { x: 0, y: 0 } }] }), data())
        .walls.matched,
    ).toBe(0);
  });
  it('computes relative scale error and reports unknown/invalid scale as null', () => {
    expect(
      evaluate(data({ mmPerPixel: 10.1 }), data()).scaleRelativeError,
    ).toBeCloseTo(0.01);
    for (const mmPerPixel of [null, 0, -1, Infinity, NaN]) {
      expect(
        evaluate(data({ mmPerPixel }), data()).scaleRelativeError,
      ).toBeNull();
      expect(
        evaluate(data(), data({ mmPerPixel })).scaleRelativeError,
      ).toBeNull();
    }
  });
  it('returns finite scores for empty results and empty truth', () => {
    const empty = data({
      mmPerPixel: null,
      walls: [],
      openings: [],
      rooms: [],
    });
    expect(evaluate(empty, data()).walls).toMatchObject({
      precision: 0,
      recall: 0,
    });
    expect(evaluate(empty, empty).walls).toMatchObject({
      precision: 1,
      recall: 1,
    });
    expect(evaluate(data(), empty).walls).toMatchObject({
      precision: 0,
      recall: 1,
    });
  });
});

describe('opening evaluation', () => {
  it('uses center offsets on vertical walls', () => {
    const vertical = {
      ...wall(),
      start: { x: 100, y: 200 },
      end: { x: 100, y: 1200 },
    };
    expect(openingCenter(opening(), [vertical])).toEqual({ x: 100, y: 700 });
  });
  it.each([
    'door',
    'window',
    'sliding_door',
    'opening',
    'floor_window',
  ] as const)('scores %s separately and one-to-one', (kind) => {
    const truth = data({ openings: [opening(kind)] });
    const result = evaluate(
      data({
        openings: [opening(kind), { ...opening(kind), id: 'duplicate' }],
      }),
      truth,
    );
    expect(result.openings[kind]).toMatchObject({
      matched: 1,
      recall: 1,
      precision: 0.5,
    });
  });
  it.each([199, 200, 201])(
    'uses a strict 200mm opening threshold at %s',
    (offset) => {
      expect(
        evaluate(data({ openings: [opening('door', 500 + offset)] }), data())
          .openings.door.matched,
      ).toBe(offset < 200 ? 1 : 0);
    },
  );
  it('does not match different types or missing host walls', () => {
    const result = evaluate(
      data({ openings: [opening('window'), opening('door', 500, 'missing')] }),
      data(),
    );
    expect(result.openings.window.precision).toBe(0);
    expect(result.openings.door.matched).toBe(0);
    expect(
      openingCenter(opening(), [{ ...wall(), end: { x: 0, y: 0 } }]),
    ).toBeNull();
  });
  it('scores partial opening recall', () => {
    const result = evaluate(
      data(),
      data({
        openings: [opening(), { ...opening('door', 800), id: 'second' }],
      }),
    );
    expect(result.openings.door).toMatchObject({
      matched: 1,
      recall: 0.5,
      precision: 1,
    });
  });
});

describe('room evaluation', () => {
  it('accepts IoU exactly 0.8 and rejects lower overlap', () => {
    expect(
      polygonIoU(rect(0, 0, 800, 1000), rect(0, 0, 1000, 1000)),
    ).toBeCloseTo(0.8);
    expect(
      evaluate(data({ rooms: [room(rect(0, 0, 800, 1000))] }), data()).rooms
        .matched,
    ).toBe(1);
    expect(
      evaluate(data({ rooms: [room(rect(0, 0, 799, 1000))] }), data()).rooms
        .matched,
    ).toBe(0);
  });
  it('handles concavity and reversed winding', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(polygonIoU(lShape, [...lShape].reverse())).toBeCloseTo(1);
    expect(polygonIoU(lShape, rect(0, 0, 2, 2))).toBeCloseTo(0.75);
    expect(polygonIoU(lShape, rect(1, 1, 1, 1))).toBe(0);
  });
  it('counts geometry matches separately from room types and duplicate rooms', () => {
    const score = evaluate(
      data({
        rooms: [
          room(undefined, 'kitchen'),
          { ...room(undefined, 'kitchen'), id: 'duplicate' },
        ],
      }),
      data(),
    );
    expect(score.rooms).toMatchObject({
      predicted: 2,
      expected: 1,
      matched: 1,
      typeMatched: 0,
    });
  });
  it('scores disjoint and degenerate polygons as zero', () => {
    expect(polygonIoU(rect(0, 0, 1, 1), rect(2, 2, 1, 1))).toBe(0);
    expect(polygonIoU([], rect(0, 0, 1, 1))).toBe(0);
    expect(polygonIoU(rect(0, 0, 0, 0), rect(0, 0, 1, 1))).toBe(0);
  });
});
