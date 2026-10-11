export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
export interface BinaryImage {
  width: number;
  height: number;
  pixels: Uint8Array;
  inverted: boolean;
}

// All processing uses typed arrays, so the same implementation runs in Node
// and browser workers. No canvas, native extension or WASM initialization here.
export function preprocess(image: RasterImage): BinaryImage {
  const { width, height, data } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width * height > 24_000_000 ||
    data.length !== width * height * 4
  ) {
    throw new Error('Expected an RGBA raster of 2–24,000,000 pixels.');
  }
  const grey = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  let border = 0;
  let samples = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const alpha = data[i * 4 + 3] / 255;
      const value = Math.round(
        (data[i * 4] * 0.299 +
          data[i * 4 + 1] * 0.587 +
          data[i * 4 + 2] * 0.114) *
          alpha +
          255 * (1 - alpha),
      );
      grey[i] = value;
      histogram[value]++;
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) {
        border += value;
        samples++;
      }
    }
  const inverted = border / samples < 128;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * histogram[i];
  let count = 0,
    sum = 0,
    best = -1,
    threshold = 127;
  for (let i = 0; i < 255; i++) {
    count += histogram[i];
    sum += i * histogram[i];
    if (!count || count === grey.length) continue;
    const variance =
      count *
      (grey.length - count) *
      (sum / count - (total - sum) / (grey.length - count)) ** 2;
    if (variance > best) {
      best = variance;
      threshold = i;
    }
  }
  const raw = grey.map((value) =>
    Number(inverted ? value > threshold : value <= threshold),
  );
  const pixels = raw.slice();
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!raw[i]) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) neighbours += raw[i + dy * width + dx];
      if (neighbours === 0) pixels[i] = 0;
    }
  return { width, height, pixels, inverted };
}
