import type { BinaryImage } from './preprocess';

export interface LineSegment {
  axis: 'h' | 'v';
  at: number;
  start: number;
  end: number;
  support: number;
}

export function detectLines(image: BinaryImage, minLength = 25): LineSegment[] {
  const segments: LineSegment[] = [];
  for (const axis of ['h', 'v'] as const) {
    const across = axis === 'h' ? image.height : image.width;
    const along = axis === 'h' ? image.width : image.height;
    for (let at = 0; at < across; at++) {
      let start = -1,
        last = -1,
        hits = 0;
      const flush = () => {
        if (
          start >= 0 &&
          last - start >= minLength &&
          hits / (last - start + 1) > 0.8
        )
          segments.push({
            axis,
            at,
            start,
            end: last,
            support: hits / (last - start + 1),
          });
        start = -1;
        last = -1;
        hits = 0;
      };
      for (let t = 0; t < along; t++) {
        const pixel =
          image.pixels[
            axis === 'h' ? at * image.width + t : t * image.width + at
          ];
        if (pixel) {
          if (start < 0) start = t;
          last = t;
          hits++;
        } else if (start >= 0 && t - last > 2) flush();
      }
      flush();
    }
  }
  // Collapse adjacent antialiased rows without joining separate parallel edges.
  const result: LineSegment[] = [];
  for (const segment of segments.sort(
    (a, b) => b.end - b.start - (a.end - a.start),
  )) {
    const duplicate = result.find(
      (other) =>
        other.axis === segment.axis &&
        Math.abs(other.at - segment.at) <= 1.5 &&
        Math.abs(other.start - segment.start) <= 3 &&
        Math.abs(other.end - segment.end) <= 3,
    );
    if (!duplicate) result.push({ ...segment });
    else duplicate.at = (duplicate.at + segment.at) / 2;
  }
  return result;
}

export function isDimensionLine(
  line: LineSegment,
  image: BinaryImage,
): boolean {
  const tick = (position: number) => {
    for (let delta = -2; delta <= 2; delta++) {
      const at = Math.round(position + delta);
      const center = Math.round(line.at);
      const get = (t: number) => {
        const x = line.axis === 'h' ? at : t;
        const y = line.axis === 'h' ? t : at;
        return x >= 0 && y >= 0 && x < image.width && y < image.height
          ? image.pixels[y * image.width + x]
          : 0;
      };
      let before = 0,
        after = 0;
      for (let i = 1; i <= 48 && get(center - i); i++) before++;
      for (let i = 1; i <= 48 && get(center + i); i++) after++;
      if (before >= 3 && after >= 3 && before < 48 && after < 48) return true;
    }
    return false;
  };
  return tick(line.start) && tick(line.end);
}

// Dimension chains occupy an exterior lane with many ticked segments, or an
// overall span. Window frames and chair rectangles do not form such chains.
export function detectDimensionLines(
  lines: readonly LineSegment[],
  image: BinaryImage,
): LineSegment[] {
  const ticked = lines.filter((line) => isDimensionLine(line, image));
  return ticked.filter((line) => {
    const span = line.axis === 'h' ? image.width : image.height;
    const lane = ticked.filter(
      (other) => other.axis === line.axis && Math.abs(other.at - line.at) <= 2,
    );
    return (
      line.end - line.start > span * 0.6 ||
      (lane.length >= 3 &&
        lane.reduce((sum, part) => sum + part.end - part.start, 0) > span * 0.4)
    );
  });
}
