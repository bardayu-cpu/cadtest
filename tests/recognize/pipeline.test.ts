import { describe, expect, it, vi } from 'vitest';
import { preprocess, type RasterImage } from '../../src/recognize/preprocess';
import { detectLines, detectDimensionLines } from '../../src/recognize/lines';
import { detectScale } from '../../src/recognize/scale';
import { detectWalls } from '../../src/recognize/walls';
import { recognizeFloorPlan } from '../../src/recognize/pipeline';

function raster(dark = false): RasterImage {
  const data = new Uint8Array(240 * 180 * 4).fill(dark ? 0 : 255);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: 240, height: 180, data };
}
function stroke(
  image: RasterImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dark = false,
) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let c = 0; c < 3; c++)
        image.data[(y * image.width + x) * 4 + c] = dark ? 255 : 0;
}
const segment = (axis: 'h' | 'v', at: number, start: number, end: number) => ({
  axis,
  at,
  start,
  end,
  support: 1,
});

describe('portable CV preprocessing and line detection', () => {
  it.each([false, true])(
    'extracts the same two edges on dark=%s backgrounds',
    (dark) => {
      const image = raster(dark);
      stroke(image, 30, 60, 210, 60, dark);
      stroke(image, 30, 70, 210, 70, dark);
      const binary = preprocess(image);
      expect(binary.inverted).toBe(dark);
      const walls = detectWalls(detectLines(binary), 10);
      expect(walls).toHaveLength(1);
      expect(walls[0]).toMatchObject({
        start: { x: 300, y: 650 },
        end: { x: 2100, y: 650 },
        thickness: 100,
        source: 'auto',
      });
      expect(walls[0].confidence).toBeGreaterThanOrEqual(0);
      expect(walls[0].confidence).toBeLessThanOrEqual(1);
    },
  );
  it('removes isolated noise, preserves lines, and composites transparent pixels', () => {
    const image = raster();
    stroke(image, 2, 2, 2, 2);
    stroke(image, 30, 60, 210, 60);
    image.data.set([0, 0, 0, 0], (10 * 240 + 10) * 4);
    const binary = preprocess(image);
    expect(binary.pixels[2 * 240 + 2]).toBe(0);
    expect(binary.pixels[10 * 240 + 10]).toBe(0);
    expect(binary.pixels[60 * 240 + 100]).toBe(1);
  });
  it('rejects malformed rasters', () => {
    expect(() =>
      preprocess({ width: 10, height: 10, data: new Uint8Array(1) }),
    ).toThrow('RGBA');
    expect(() =>
      preprocess({ width: Infinity, height: 10, data: new Uint8Array() }),
    ).toThrow('RGBA');
  });
  it('filters long ticked dimension lines but not short window frames', () => {
    const image = raster();
    for (const y of [20, 90]) {
      stroke(image, 30, y, 210, y);
      stroke(image, 30, y - 5, 30, y + 5);
      stroke(image, 210, y - 5, 210, y + 5);
    }
    const binary = preprocess(image);
    const dimensions = detectDimensionLines(detectLines(binary), binary);
    expect(dimensions.some((line) => line.at === 20)).toBe(true);
    const short = raster();
    stroke(short, 80, 60, 130, 60);
    stroke(short, 80, 55, 80, 65);
    stroke(short, 130, 55, 130, 65);
    expect(
      detectDimensionLines(detectLines(preprocess(short)), preprocess(short)),
    ).toHaveLength(0);
  });
});

describe('dimension-to-scale association', () => {
  const lines = [
    segment('h', 30, 20, 220),
    segment('h', 160, 20, 220),
    segment('h', 80, 20, 120),
  ];
  it('cross-validates two spans and rejects an OCR outlier', () => {
    const result = detectScale(lines, [
      { value: 2000, x: 120, y: 20, axis: 'h', confidence: 0.9 },
      { value: 2000, x: 120, y: 150, axis: 'h', confidence: 0.9 },
      { value: 9999, x: 70, y: 70, axis: 'h', confidence: 0.9 },
    ]);
    expect(result.mmPerPixel).toBeCloseTo(10);
    expect(result.measurements).toHaveLength(2);
    expect(result.warnings.join()).toContain('2%');
  });
  it('requires independent dimension evidence and refuses missing, single or inconsistent labels', () => {
    expect(detectScale(lines, []).mmPerPixel).toBeNull();
    const label = {
      value: 2000,
      x: 120,
      y: 20,
      axis: 'h' as const,
      confidence: 0.9,
    };
    expect(detectScale(lines, [label, label]).mmPerPixel).toBeNull();
    expect(
      detectScale(lines, [label, { ...label, value: 6000, y: 150 }]).mmPerPixel,
    ).toBeNull();
  });
  it('does not associate a distant text or text outside the span', () => {
    expect(
      detectScale(lines, [
        { value: 2000, x: 5, y: 20, axis: 'h', confidence: 1 },
      ]).mmPerPixel,
    ).toBeNull();
  });
  it('revalidates a seed cluster against the weighted fitted scale', () => {
    const result = detectScale(
      [
        segment('h', 30, 20, 220),
        segment('h', 80, 20, 120),
        segment('h', 160, 20, 1020),
      ],
      [
        { value: 2000, x: 120, y: 20, axis: 'h', confidence: 1 },
        { value: 1018, x: 70, y: 70, axis: 'h', confidence: 1 },
        { value: 10360, x: 520, y: 150, axis: 'h', confidence: 1 },
      ],
    );
    expect(result.mmPerPixel).not.toBeNull();
    expect(result.measurements).toHaveLength(2);
    for (const reading of result.measurements)
      expect(
        Math.abs(reading.mmPerPixel - result.mmPerPixel!) / result.mmPerPixel!,
      ).toBeLessThan(0.02);
  });
});

describe('double-line wall reconstruction', () => {
  it('rejoins door-sized gaps before pairing and snaps intersections', () => {
    const walls = detectWalls(
      [
        segment('h', 60, 30, 90),
        segment('h', 60, 150, 210),
        segment('h', 70, 30, 90),
        segment('h', 70, 150, 210),
        segment('v', 205, 60, 150),
        segment('v', 215, 60, 150),
      ],
      15,
    );
    expect(
      walls.some(
        (wall) =>
          wall.start.y === 975 && wall.end.x === 3150 && wall.start.x === 450,
      ),
    ).toBe(true);
    expect(
      walls.every(
        (wall) => wall.start.x === wall.end.x || wall.start.y === wall.end.y,
      ),
    ).toBe(true);
  });
  it('rejects single lines and thickness outside 80–300mm', () => {
    expect(detectWalls([segment('h', 60, 30, 210)], 10)).toHaveLength(0);
    expect(
      detectWalls([segment('h', 60, 30, 210), segment('h', 62, 30, 210)], 10),
    ).toHaveLength(0);
    expect(
      detectWalls([segment('h', 60, 30, 210), segment('h', 95, 30, 210)], 10),
    ).toHaveLength(0);
    expect(() => detectWalls([], 0)).toThrow('scale');
  });
  it('rejects a detached small furniture rectangle', () => {
    const walls = detectWalls(
      [
        segment('h', 60, 30, 100),
        segment('h', 70, 30, 100),
        segment('h', 120, 30, 100),
        segment('h', 130, 30, 100),
        segment('v', 30, 60, 130),
        segment('v', 40, 60, 130),
        segment('v', 90, 60, 130),
        segment('v', 100, 60, 130),
      ],
      10,
    );
    expect(walls).toHaveLength(0);
  });
  it('does not duplicate antialiased edge pairs', () => {
    const walls = detectWalls(
      [
        segment('h', 60, 30, 210),
        segment('h', 61, 30, 210),
        segment('h', 70, 30, 210),
        segment('h', 71, 30, 210),
      ],
      10,
    );
    expect(walls).toHaveLength(1);
  });
});

describe('entry point fallbacks', () => {
  it('returns explicit scale failure without inventing millimetres on blank images', async () => {
    const result = await recognizeFloorPlan(raster());
    expect(result.mmPerPixel).toBeNull();
    expect(result.report.scaleDetected).toBe(false);
    expect(result.report.method).toBe('cv');
    expect(result.walls).toHaveLength(0);
    expect(result.report.warnings.join()).toContain('手动校准');
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  });
  it('reports OCR resource failure instead of throwing or guessing a scale', async () => {
    const image = raster();
    stroke(image, 30, 20, 210, 20);
    stroke(image, 30, 15, 30, 25);
    stroke(image, 210, 15, 210, 25);
    const ocr = await import('../../src/recognize/ocr');
    const spy = vi
      .spyOn(ocr, 'readDimensionLabels')
      .mockRejectedValueOnce(new Error('offline'));
    try {
      const result = await recognizeFloorPlan(image);
      expect(result.report.scaleDetected).toBe(false);
      expect(result.report.warnings.join()).toContain('OCR');
    } finally {
      spy.mockRestore();
    }
  });
});
