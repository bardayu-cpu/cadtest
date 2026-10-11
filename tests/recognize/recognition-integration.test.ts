import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { recognizeFloorPlan } from '../../src/recognize/pipeline';

const require = createRequire(import.meta.url);
const langPath = resolve(
  require.resolve('@tesseract.js-data/eng'),
  '../4.0.0_best_int',
);
describe('real offline OCR and wall pipeline', () => {
  it.each(['a', 'b'])(
    'runs floorplan-%s without truth data or a remote OCR service',
    async (fixture) => {
      const { data, info } = await sharp(`fixtures/floorplan-${fixture}.jpg`)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const result = await recognizeFloorPlan(
        { width: info.width, height: info.height, data },
        { ocr: { langPath } },
      );
      expect(result.report.scaleDetected).toBe(true);
      expect(
        result.diagnostics.dimensionMeasurements.length,
      ).toBeGreaterThanOrEqual(2);
      expect(result.walls.length).toBeGreaterThan(0);
      expect(
        result.walls.every(
          (wall) =>
            wall.source === 'auto' &&
            wall.confidence !== undefined &&
            wall.confidence >= 0 &&
            wall.confidence <= 1,
        ),
      ).toBe(true);
      if (fixture === 'a')
        expect(Math.abs(result.mmPerPixel! - 15.52) / 15.52).toBeLessThan(0.01);
    },
    20_000,
  );
});
