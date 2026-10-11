import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/recognize/evaluate';
import { expectedFloorplanSchema } from '../../src/recognize/schema';

const directory = resolve('fixtures');
const files = readdirSync(directory).filter((name) =>
  name.endsWith('.expected.json'),
);

describe.each(files)('%s manual truth', (file) => {
  const truth = expectedFloorplanSchema.parse(
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')),
  );
  it('cross-validates at least three dimension lines with <1% spread and scale error', () => {
    const scales = truth.calibration.map(
      ({ startPixel, endPixel, lengthMm }) =>
        lengthMm /
        Math.hypot(endPixel.x - startPixel.x, endPixel.y - startPixel.y),
    );
    expect(scales.length).toBeGreaterThanOrEqual(3);
    expect(
      (Math.max(...scales) - Math.min(...scales)) / truth.mmPerPixel,
    ).toBeLessThan(0.01);
    for (const scale of scales)
      expect(
        Math.abs(scale - truth.mmPerPixel) / truth.mmPerPixel,
      ).toBeLessThan(0.01);
  });
  it('has image dimensions, unique IDs, manual sources and bounded geometry', async () => {
    const image = await sharp(resolve(directory, truth.image)).metadata();
    expect({ width: image.width, height: image.height }).toEqual(
      truth.imageSize,
    );
    for (const collection of [truth.walls, truth.openings, truth.rooms]) {
      expect(new Set(collection.map((item) => item.id)).size).toBe(
        collection.length,
      );
      for (const item of collection) expect(item.source).toBe('manual');
    }
    for (const point of [
      ...truth.walls.flatMap((wall) => [wall.start, wall.end]),
      ...truth.rooms.flatMap((room) => room.polygon),
    ]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(
        truth.imageSize.width * truth.mmPerPixel,
      );
      expect(point.y).toBeLessThanOrEqual(
        truth.imageSize.height * truth.mmPerPixel,
      );
    }
  });
  it('has valid host walls and non-overlapping openings inside each wall', () => {
    for (const opening of truth.openings) {
      const wall = truth.walls.find((item) => item.id === opening.wallId);
      expect(wall).toBeDefined();
      if (!wall) throw new Error('Missing wall');
      const length = Math.hypot(
        wall.end.x - wall.start.x,
        wall.end.y - wall.start.y,
      );
      expect(opening.offset - opening.width / 2).toBeGreaterThanOrEqual(0);
      expect(opening.offset + opening.width / 2).toBeLessThanOrEqual(length);
      expect(opening.sillHeight).toBeLessThan(opening.headHeight);
      for (const other of truth.openings.filter(
        (item) => item.wallId === opening.wallId && item.id !== opening.id,
      )) {
        expect(Math.abs(other.offset - opening.offset)).toBeGreaterThanOrEqual(
          (other.width + opening.width) / 2,
        );
      }
    }
  });
  it('self-scores all walls, openings and rooms', () => {
    const score = evaluate(truth, truth);
    expect(score.walls.matched).toBe(truth.walls.length);
    expect(score.rooms.matched).toBe(truth.rooms.length);
    expect(score.rooms.typeMatched).toBe(truth.rooms.length);
    expect(
      Object.values(score.openings).reduce(
        (sum, metrics) => sum + metrics.matched,
        0,
      ),
    ).toBe(truth.openings.length);
  });
});
