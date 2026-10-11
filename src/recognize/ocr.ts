import type { BinaryImage } from './preprocess';
import type { LineSegment } from './lines';

export interface DigitLabel {
  value: number;
  x: number;
  y: number;
  axis: 'h' | 'v';
  confidence: number;
}
export interface OcrOptions {
  langPath?: string;
  workerPath?: string;
  corePath?: string;
}

// Portable BMP encoder: OCR receives only a local data URL in both runtimes.
function bmp(width: number, height: number, pixels: Uint8Array): string {
  const stride = Math.ceil(width / 4) * 4;
  const offset = 54 + 1024;
  const bytes = new Uint8Array(offset + stride * height);
  const view = new DataView(bytes.buffer);
  bytes[0] = 66;
  bytes[1] = 77;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  for (let i = 0; i < 256; i++) {
    bytes[54 + i * 4] = i;
    bytes[55 + i * 4] = i;
    bytes[56 + i * 4] = i;
  }
  for (let y = 0; y < height; y++)
    bytes.set(pixels.subarray(y * width, (y + 1) * width), offset + y * stride);
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 8192)
    encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:image/bmp;base64,${btoa(encoded)}`;
}

export async function readDimensionLabels(
  image: BinaryImage,
  options: OcrOptions = {},
  dimensions: readonly LineSegment[] = [],
): Promise<DigitLabel[]> {
  const imported = await import('tesseract.js');
  const { createWorker, PSM } = imported.default ?? imported;
  const worker = await createWorker('eng', 1, {
    ...options,
    cacheMethod: 'none',
    errorHandler: () => {},
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      user_defined_dpi: '150',
    });
    const bands: {
      axis: 'h' | 'v';
      left: number;
      top: number;
      width: number;
      height: number;
      sheetTop: number;
    }[] = [];
    for (const axis of ['h', 'v'] as const) {
      const positions = [
        ...new Set(
          dimensions
            .filter((line) => line.axis === axis)
            .map((line) => Math.round(line.at)),
        ),
      ].sort((a, b) => a - b);
      const groups: number[][] = [];
      for (const position of positions) {
        const group = groups[groups.length - 1];
        if (group && position - group[group.length - 1] < 40)
          group.push(position);
        else groups.push([position]);
      }
      for (const group of groups) {
        const start = Math.max(0, group[0] - 24),
          end = Math.min(
            axis === 'h' ? image.height : image.width,
            group[group.length - 1] - 3,
          );
        if (end <= start) continue;
        bands.push({
          axis,
          left: axis === 'h' ? 0 : start,
          top: axis === 'h' ? start : 0,
          width: axis === 'h' ? image.width : end - start,
          height: axis === 'h' ? end - start : image.height,
          sheetTop: 0,
        });
      }
    }
    if (!bands.length) return [];
    const factor = 3;
    const width =
      Math.max(
        ...bands.map((band) => (band.axis === 'h' ? band.width : band.height)),
      ) * factor;
    let height = 0;
    for (const band of bands) {
      band.sheetTop = height;
      height += (band.axis === 'h' ? band.height : band.width) * factor + 30;
    }
    const pixels = new Uint8Array(width * height).fill(255);
    for (const band of bands)
      for (let y = 0; y < band.height; y++)
        for (let x = 0; x < band.width; x++) {
          if (!image.pixels[(y + band.top) * image.width + x + band.left])
            continue;
          const px = band.axis === 'h' ? x : band.height - 1 - y;
          const py = band.axis === 'h' ? y : x;
          for (let dy = 0; dy < factor; dy++)
            for (let dx = 0; dx < factor; dx++)
              pixels[
                (band.sheetTop + py * factor + dy) * width + px * factor + dx
              ] = 0;
        }
    const { data } = await worker.recognize(
      bmp(width, height, pixels),
      {},
      { blocks: true },
    );
    const labels: DigitLabel[] = [];
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines)
          for (const word of line.words) {
            if (!/^\d{3,6}$/.test(word.text) || word.confidence < 20) continue;
            const sheetY = (word.bbox.y0 + word.bbox.y1) / 2;
            const band = bands.find(
              (band) =>
                sheetY >= band.sheetTop &&
                sheetY <
                  band.sheetTop +
                    (band.axis === 'h' ? band.height : band.width) * factor,
            );
            if (!band) continue;
            const px = (word.bbox.x0 + word.bbox.x1) / 2 / factor;
            const py = (sheetY - band.sheetTop) / factor;
            labels.push({
              value: Number(word.text),
              x: band.left + (band.axis === 'h' ? px : py),
              y: band.top + (band.axis === 'h' ? py : band.height - 1 - px),
              axis: band.axis,
              confidence: word.confidence / 100,
            });
          }
    return labels;
  } finally {
    await worker.terminate();
  }
}
