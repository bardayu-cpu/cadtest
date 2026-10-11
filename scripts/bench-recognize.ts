import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluate, OPENING_KINDS } from '../src/recognize/evaluate';
import { expectedFloorplanSchema } from '../src/recognize/schema';
import type { RecognitionData } from '../src/recognize/types';

const fixtures = resolve('fixtures');
const files = (await readdir(fixtures))
  .filter((name) => name.endsWith('.expected.json'))
  .sort();
if (files.length === 0) throw new Error('No fixtures/*.expected.json found.');
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const rows = [];
for (const file of files) {
  const expected = expectedFloorplanSchema.parse(
    JSON.parse(await readFile(resolve(fixtures, file), 'utf8')),
  );
  // Read the image as the future pipeline input; #12 intentionally uses no algorithm.
  await readFile(resolve(fixtures, expected.image));
  const predicted: RecognitionData = {
    mmPerPixel: null,
    walls: [],
    openings: [],
    rooms: [],
  };
  const result = evaluate(predicted, expected);
  rows.push({
    fixture: file,
    mode: 'empty placeholder',
    scaleError:
      result.scaleRelativeError === null
        ? 'N/A (undetected)'
        : percent(result.scaleRelativeError),
    walls: `${result.walls.matched}/${result.walls.expected}`,
    wallRecall: percent(result.walls.recall),
    wallPrecision: percent(result.walls.precision),
    rooms: `${result.rooms.predicted}/${result.rooms.expected}`,
    roomIoUMatches: result.rooms.matched,
    roomTypeMatches: result.rooms.typeMatched,
  });
  console.log(`\n${file} — opening scores`);
  console.table(
    OPENING_KINDS.map((kind) => ({
      kind,
      ...result.openings[kind],
      recall: percent(result.openings[kind].recall),
      precision: percent(result.openings[kind].precision),
    })),
  );
}
console.log(
  '\nRecognition benchmark (empty placeholder; scale unavailable, ratios for absent types are vacuous):',
);
console.table(rows);
