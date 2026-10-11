import type { DigitLabel } from './ocr';
import type { LineSegment } from './lines';

export interface ScaleMeasurement {
  lengthMm: number;
  lengthPixels: number;
  mmPerPixel: number;
  line: LineSegment;
  confidence: number;
}
export interface ScaleResult {
  mmPerPixel: number | null;
  measurements: ScaleMeasurement[];
  warnings: string[];
}

export function detectScale(
  lines: readonly LineSegment[],
  labels: readonly DigitLabel[],
): ScaleResult {
  const measurements: ScaleMeasurement[] = [];
  for (const label of labels) {
    const along = label.axis === 'h' ? label.x : label.y;
    const across = label.axis === 'h' ? label.y : label.x;
    const candidates = lines.filter(
      (line) =>
        line.axis === label.axis &&
        along > line.start &&
        along < line.end &&
        Math.abs(across - line.at) >= 4 &&
        Math.abs(across - line.at) <= 40 &&
        Math.abs(along - (line.start + line.end) / 2) <
          (line.end - line.start) * 0.2,
    );
    const line = candidates.sort(
      (a, b) => Math.abs(across - a.at) - Math.abs(across - b.at),
    )[0];
    if (!line) continue;
    const lengthPixels = line.end - line.start;
    const mmPerPixel = label.value / lengthPixels;
    if (mmPerPixel < 0.1 || mmPerPixel > 500) continue;
    if (measurements.some((item) => item.line === line)) continue;
    measurements.push({
      lengthMm: label.value,
      lengthPixels,
      mmPerPixel,
      line,
      confidence: label.confidence,
    });
  }
  if (!measurements.length)
    return {
      mmPerPixel: null,
      measurements: [],
      warnings: ['未识别到可靠尺寸标注，请手动校准比例尺。'],
    };
  const clusters = measurements.map((seed) =>
    measurements.filter(
      (item) =>
        Math.abs(item.mmPerPixel - seed.mmPerPixel) / seed.mmPerPixel < 0.02,
    ),
  );
  let cluster = clusters.sort(
    (a, b) =>
      b.length - a.length ||
      b.reduce((sum, v) => sum + v.lengthPixels * v.confidence, 0) -
        a.reduce((sum, v) => sum + v.lengthPixels * v.confidence, 0),
  )[0];
  if (cluster.length < 2)
    return {
      mmPerPixel: null,
      measurements,
      warnings: ['尺寸标注无法交叉验证，请手动校准比例尺。'],
    };
  // Fit millimetres = scale * pixels. Long dimension spans carry more weight,
  // because one-pixel tick localization errors dominate short spans.
  const fit = (items: ScaleMeasurement[]) =>
    items.reduce(
      (sum, item) => sum + item.lengthMm * item.lengthPixels * item.confidence,
      0,
    ) /
    items.reduce(
      (sum, item) => sum + item.lengthPixels ** 2 * item.confidence,
      0,
    );
  let mmPerPixel = fit(cluster);
  // Seed-relative clustering alone can retain readings more than 2% from
  // the fitted scale. Revalidate against the estimate before returning it.
  for (let pass = 0; pass < 2; pass++) {
    cluster = cluster.filter(
      (item) => Math.abs(item.mmPerPixel - mmPerPixel) / mmPerPixel < 0.02,
    );
    if (cluster.length < 2)
      return {
        mmPerPixel: null,
        measurements,
        warnings: ['尺寸标注无法交叉验证，请手动校准比例尺。'],
      };
    mmPerPixel = fit(cluster);
  }
  const warnings =
    cluster.length === measurements.length
      ? []
      : ['部分尺寸标注的比例尺偏差超过 2%，已排除离群读数。'];
  return { mmPerPixel, measurements: cluster, warnings };
}
