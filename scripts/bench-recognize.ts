import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { cpus, platform, arch } from 'node:os';
import sharp from 'sharp';
import { evaluate } from '../src/recognize/evaluate';
import { expectedFloorplanSchema } from '../src/recognize/schema';
import { recognizeFloorPlan } from '../src/recognize/pipeline';

const fixtures = resolve('fixtures');
const names = await readdir(fixtures);
const files = names
  .filter((name) => /^floorplan-.*\.(jpg|jpeg|png)$/i.test(name))
  .sort();
if (!files.length) throw new Error('No floorplan images found.');
const require = createRequire(import.meta.url);
const langPath = resolve(
  require.resolve('@tesseract.js-data/eng'),
  '../4.0.0_best_int',
);
await mkdir('tmp', { recursive: true });
await writeFile('tmp/.gitignore', '*\n');
const rows = [];
for (const file of files) {
  const started = performance.now();
  const { data, info } = await sharp(await readFile(resolve(fixtures, file)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const predicted = await recognizeFloorPlan(
    { width: info.width, height: info.height, data },
    { ocr: { langPath } },
  );
  const durationMs = performance.now() - started;
  const stem = file.replace(/\.(jpg|jpeg|png)$/i, '');
  const result = { ...predicted, openings: [], rooms: [] };
  await writeFile(
    `tmp/${stem}.recognized.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
  const expectedName = `${stem}.expected.json`;
  const expected = names.includes(expectedName)
    ? expectedFloorplanSchema.parse(
        JSON.parse(await readFile(resolve(fixtures, expectedName), 'utf8')),
      )
    : null;
  const score = expected ? evaluate(result, expected) : null;
  rows.push({
    image: file,
    mmPerPixel: predicted.mmPerPixel?.toFixed(5) ?? 'undetected',
    scaleError:
      score?.scaleRelativeError === null || !score
        ? 'N/A'
        : `${(score.scaleRelativeError * 100).toFixed(3)}%`,
    walls: predicted.walls.length,
    matched: score
      ? `${score.walls.matched}/${score.walls.expected}`
      : 'N/A (no truth)',
    recall: score ? `${(score.walls.recall * 100).toFixed(1)}%` : 'N/A',
    precision: score ? `${(score.walls.precision * 100).toFixed(1)}%` : 'N/A',
    durationMs: Math.round(durationMs),
    under5s: durationMs < 5000,
  });
  console.log(
    `${file}: ${predicted.report.warnings.join(' ')} (${predicted.diagnostics.dimensionMeasurements.length} scale measurements)`,
  );
}
const machine = `${cpus()[0]?.model ?? 'unknown CPU'} / ${platform()} ${arch()} / Node ${process.version}`;
console.log(machine);
console.table(rows);
await writeFile(
  'tmp/bench-recognize.json',
  JSON.stringify({ machine, rows }, null, 2) + '\n',
);
await writeFile(
  'tmp/bench-recognize.md',
  `Machine: ${machine}\n\n| ${Object.keys(rows[0]).join(' | ')} |\n| ${Object.keys(
    rows[0],
  )
    .map(() => '---')
    .join(
      ' | ',
    )} |\n${rows.map((row) => `| ${Object.values(row).join(' | ')} |`).join('\n')}\n`,
);
