import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { recognizeFloorPlan } from '../../src/recognize/pipeline';
import { preprocess } from '../../src/recognize/preprocess';
import { detectLines, detectDimensionLines } from '../../src/recognize/lines';
import { refineWalls } from '../../src/recognize/refine';
import { visionToRecognition } from '../../src/recognize/vision/convert';
import { validateVisionPlan } from '../../src/recognize/vision/schema';
import { recognitionDataSchema } from '../../src/recognize/schema';
import type { VisionRecording } from '../../src/recognize/vision/gemini';

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
      // Replay the provider's actual recorded response: CI never calls Gemini.
      const offline = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Network forbidden in replay'));
      try {
        const recorded: VisionRecording = JSON.parse(
          await readFile(
            `fixtures/vision/floorplan-${fixture}.gemini.json`,
            'utf8',
          ),
        );
        expect(recorded.imageSha256).toBe(
          createHash('sha256')
            .update(await readFile(`fixtures/floorplan-${fixture}.jpg`))
            .digest('hex'),
        );
        const raw = recorded.rawResponse as {
          candidates: {
            content: { parts: { text?: string; thought?: boolean }[] };
          }[];
        };
        const plan = validateVisionPlan(
          JSON.parse(
            raw.candidates[0].content.parts
              .filter((p) => !p.thought)
              .map((p) => p.text ?? '')
              .join(''),
          ),
          info.width,
          info.height,
        );
        expect(plan).toEqual(recorded.plan);
        const binary = preprocess({
          width: info.width,
          height: info.height,
          data,
        });
        const lines = detectLines(binary),
          dimensions = detectDimensionLines(lines, binary);
        const refined = refineWalls(
          plan.walls,
          lines.filter((l) => !dimensions.includes(l)),
          result.mmPerPixel!,
        );
        const replay = visionToRecognition(plan, result.mmPerPixel!, refined);
        expect(recognitionDataSchema.safeParse(replay).success).toBe(true);
        expect(replay.walls.length).toBeGreaterThan(0);
        expect(
          replay.walls.every(
            (w) =>
              w.source === 'auto' && w.confidence! >= 0 && w.confidence! <= 1,
          ),
        ).toBe(true);
        expect(offline).not.toHaveBeenCalled();
      } finally {
        offline.mockRestore();
      }
    },
    20_000,
  );
});
