import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { openingCenter } from '../src/recognize/evaluate';
import { recognitionDataSchema } from '../src/recognize/schema';
import type { Vec2 } from '../src/model/types';

const [imagePath, dataPath, outputPath = 'tmp/overlay.png'] =
  process.argv.slice(2);
if (!imagePath || !dataPath) {
  throw new Error(
    'Usage: npm run overlay -- fixtures/floorplan-a.jpg fixtures/floorplan-a.expected.json [tmp/overlay.png]',
  );
}
const output = resolve(outputPath);
const tmp = resolve('tmp');
if (!output.startsWith(`${tmp}/`) || !output.endsWith('.png')) {
  throw new Error(
    'Overlay output must be a PNG inside tmp/ (never committed).',
  );
}
const data = recognitionDataSchema.parse(
  JSON.parse(await readFile(dataPath, 'utf8')),
);
if (data.mmPerPixel === null)
  throw new Error('Overlay requires a known mmPerPixel.');
const scale = data.mmPerPixel;
const { width, height } = await sharp(imagePath).metadata();
if (!width || !height) throw new Error('Cannot read image dimensions.');
const pixel = (point: Vec2) => `${point.x / scale},${point.y / scale}`;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  );
const drawings: string[] = [];
for (const room of data.rooms) {
  drawings.push(
    `<polygon points="${room.polygon.map(pixel).join(' ')}" fill="#66dd88" fill-opacity="0.08" stroke="#66dd88" stroke-width="1" stroke-dasharray="4 4"/>`,
  );
  const center = room.polygon.reduce(
    (sum, point) => ({
      x: sum.x + point.x / room.polygon.length,
      y: sum.y + point.y / room.polygon.length,
    }),
    { x: 0, y: 0 },
  );
  drawings.push(
    `<text x="${center.x / scale}" y="${center.y / scale}" fill="#99ffaa" font-size="13" paint-order="stroke" stroke="#111" stroke-width="3">${escape(room.id)} ${escape(room.name)}</text>`,
  );
}
for (const wall of data.walls) {
  drawings.push(
    `<polyline points="${pixel(wall.start)} ${pixel(wall.end)}" fill="none" stroke="#00d9ff" stroke-opacity="0.12" stroke-width="${wall.thickness / scale}"/>`,
  );
  drawings.push(
    `<polyline points="${pixel(wall.start)} ${pixel(wall.end)}" fill="none" stroke="#00d9ff" stroke-width="1.8"/>`,
  );
  drawings.push(
    `<circle cx="${wall.start.x / scale}" cy="${wall.start.y / scale}" r="2" fill="#00d9ff"/>`,
  );
}
for (const opening of data.openings) {
  const center = openingCenter(opening, data.walls);
  const wall = data.walls.find((item) => item.id === opening.wallId);
  if (!center || !wall) throw new Error(`Invalid opening wall: ${opening.id}`);
  const length = Math.hypot(
    wall.end.x - wall.start.x,
    wall.end.y - wall.start.y,
  );
  const dx = (((wall.end.x - wall.start.x) / length) * opening.width) / 2;
  const dy = (((wall.end.y - wall.start.y) / length) * opening.width) / 2;
  const color = opening.kind.includes('window') ? '#ff60dd' : '#ff9f32';
  drawings.push(
    `<polyline points="${pixel({ x: center.x - dx, y: center.y - dy })} ${pixel({ x: center.x + dx, y: center.y + dy })}" fill="none" stroke="${color}" stroke-width="4"/>`,
  );
  drawings.push(
    `<circle cx="${center.x / scale}" cy="${center.y / scale}" r="3" fill="white"/>`,
  );
}
drawings.push(
  `<rect x="0" y="0" width="${width}" height="25" fill="#111"/><text x="12" y="17" fill="white" font-size="12">${escape(basename(dataPath))} | cyan: walls (${data.walls.length}) | orange: doors | magenta: windows (${data.openings.length} openings) | green: rooms (${data.rooms.length}) | ${scale.toFixed(5)} mm/px</text>`,
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${drawings.join('')}</svg>`;
await mkdir(tmp, { recursive: true });
// Keep generated calibration images out of Git without changing root .gitignore.
await writeFile(resolve(tmp, '.gitignore'), '*\n');
await mkdir(dirname(output), { recursive: true });
await sharp(imagePath)
  .composite([{ input: Buffer.from(svg) }])
  .png()
  .toFile(output);
console.log(`Overlay written to ${output}`);
