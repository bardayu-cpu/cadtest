import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { cpus, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { evaluate, type Evaluation } from '../src/recognize/evaluate';
import { expectedFloorplanSchema } from '../src/recognize/schema';
import { recognizeFloorPlan } from '../src/recognize/pipeline';
import { preprocess } from '../src/recognize/preprocess';
import { detectDimensionLines, detectLines } from '../src/recognize/lines';
import { refineWalls } from '../src/recognize/refine';
import { visionToRecognition } from '../src/recognize/vision/convert';
import { validateVisionPlan } from '../src/recognize/vision/schema';
import {
  GeminiError,
  recognizeWithGemini,
  type VisionRecording,
} from '../src/recognize/vision/gemini';
import type { RecognitionData } from '../src/recognize/types';

const args = process.argv.slice(2);
const mode =
  args.find((a) => ['cv', 'vision', 'vision+refine', 'all'].includes(a)) ??
  'all';
if (
  args.some(
    (a) =>
      !['cv', 'vision', 'vision+refine', 'all', '--live', '--record'].includes(
        a,
      ),
  )
)
  throw new Error(
    'Usage: bench:recognize -- [cv|vision|vision+refine|all] [--live] [--record]',
  );
const live = args.includes('--live');
if (args.includes('--record') && !live)
  throw new Error('--record requires --live.');
if (live && existsSync('.env.local')) process.loadEnvFile('.env.local');
const require = createRequire(import.meta.url);
const langPath = resolve(
  require.resolve('@tesseract.js-data/eng'),
  '../4.0.0_best_int',
);
await mkdir('tmp', { recursive: true });
await writeFile('tmp/.gitignore', '*\n');
const names = await readdir('fixtures');
const files = names
  .filter((name) => /^floorplan-.*\.(jpg|jpeg|png)$/i.test(name))
  .sort();
if (!files.length) throw new Error('No floorplan images found.');
const rows: Record<string, string | number>[] = [];
const details: { image: string; mode: string; score: Evaluation | null }[] = [];
const auxiliary: Record<string, string | number>[] = [];
const trials: unknown[] = [];
let actualRequests = 0;
for (const file of files) {
  const image = await readFile(resolve('fixtures', file));
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stem = file.replace(/\.(jpg|jpeg|png)$/i, '');
  const started = performance.now();
  const cv = await recognizeFloorPlan(
    { width: info.width, height: info.height, data },
    { ocr: { langPath } },
  );
  const cvMs = performance.now() - started;
  for (const label of ['cv', 'recognized'])
    await writeFile(
      `tmp/${stem}.${label}.json`,
      JSON.stringify({ ...cv, openings: [], rooms: [] }, null, 2) + '\n',
    );
  const expectedName = `${stem}.expected.json`;
  const expected = names.includes(expectedName)
    ? expectedFloorplanSchema.parse(
        JSON.parse(await readFile(resolve('fixtures', expectedName), 'utf8')),
      )
    : null;
  const add = async (
    result: RecognitionData,
    label: string,
    visionMs: number,
    refineMs: number,
    calls: number,
    origin: string,
  ) => {
    const score = expected ? evaluate(result, expected) : null;
    rows.push({
      image: file,
      mode: label,
      scaleError:
        score?.scaleRelativeError != null
          ? `${(score.scaleRelativeError * 100).toFixed(3)}%`
          : 'N/A',
      walls: result.walls.length,
      matched: score ? `${score.walls.matched}/${score.walls.expected}` : 'N/A',
      recall: score ? `${(score.walls.recall * 100).toFixed(1)}%` : 'N/A',
      precision: score ? `${(score.walls.precision * 100).toFixed(1)}%` : 'N/A',
      cvMs: Math.round(cvMs),
      visionMs: Math.round(visionMs),
      refineMs: Math.round(refineMs),
      calls,
      origin,
    });
    details.push({ image: file, mode: label, score });
    if (score) {
      for (const [kind, metric] of Object.entries(score.openings))
        auxiliary.push({
          image: file,
          mode: label,
          kind,
          predicted: metric.predicted,
          expected: metric.expected,
          matched: metric.matched,
          recall: `${(metric.recall * 100).toFixed(1)}%`,
          precision: `${(metric.precision * 100).toFixed(1)}%`,
        });
      auxiliary.push({
        image: file,
        mode: label,
        kind: 'rooms (IoU >= 0.8)',
        predicted: score.rooms.predicted,
        expected: score.rooms.expected,
        matched: score.rooms.matched,
        typeMatched: score.rooms.typeMatched,
        recall: `${(score.rooms.recall * 100).toFixed(1)}%`,
        precision: `${(score.rooms.precision * 100).toFixed(1)}%`,
      });
    }
    await writeFile(
      `tmp/${stem}.${label.replaceAll('+', '-')}.json`,
      JSON.stringify(
        {
          ...result,
          report: {
            createdAt: new Date().toISOString(),
            method:
              label === 'cv'
                ? 'cv'
                : label.startsWith('vision-trial-') || label === 'vision'
                  ? 'vision_model'
                  : 'cv+vision_model',
            scaleDetected: result.mmPerPixel !== null,
            warnings: cv.report.warnings,
          },
        },
        null,
        2,
      ) + '\n',
    );
  };
  if (mode === 'all' || mode === 'cv')
    await add({ ...cv, openings: [], rooms: [] }, 'cv', 0, 0, 0, 'algorithm');
  if (mode === 'cv') continue;
  if (cv.mmPerPixel === null) {
    console.log(`${file}: no scale; vision conversion skipped.`);
    process.exitCode = 1;
    continue;
  }
  const binary = preprocess({ width: info.width, height: info.height, data });
  const allLines = detectLines(binary);
  const dimensions = detectDimensionLines(allLines, binary);
  const lines = allLines.filter((line) => !dimensions.includes(line));
  const count = live && file === 'floorplan-a.jpg' ? 3 : 1;
  let savedRecording = false;
  for (let trial = 1; trial <= count; trial++) {
    let recording: VisionRecording;
    let calls = 0,
      visionMs = 0,
      origin = 'recording';
    try {
      if (live) {
        const response = await recognizeWithGemini(
          image,
          { width: info.width, height: info.height },
          { bypassCache: file === 'floorplan-a.jpg' },
        );
        recording = response.recording;
        calls = response.calls;
        actualRequests += calls;
        visionMs = response.durationMs;
        origin = response.cacheHit ? 'cache' : 'live';
        if (args.includes('--record') && !savedRecording) {
          await mkdir('fixtures/vision', { recursive: true });
          await writeFile(
            `fixtures/vision/${stem}.gemini.json`,
            JSON.stringify(recording, null, 2) + '\n',
          );
          savedRecording = true;
        }
        trials.push({ file, trial, ...response });
        console.log(
          `${file} trial ${trial}: ${recording.plan.walls.length} walls, ${calls} requests, ${Math.round(visionMs)} ms`,
        );
      } else {
        recording = JSON.parse(
          await readFile(`fixtures/vision/${stem}.gemini.json`, 'utf8'),
        );
        // This is historical API latency, not a network call during replay.
        visionMs = recording.durationMs;
      }
      if (
        recording.imageSha256 !==
          createHash('sha256').update(image).digest('hex') ||
        recording.imageSize.width !== info.width ||
        recording.imageSize.height !== info.height
      )
        throw new Error('Recording does not match image.');
      const plan = validateVisionPlan(recording.plan, info.width, info.height);
      if (mode === 'all' || mode === 'vision')
        await add(
          visionToRecognition(plan, cv.mmPerPixel),
          `vision${live ? `-trial-${trial}` : ''}`,
          visionMs,
          0,
          calls,
          origin,
        );
      if (mode === 'all' || mode === 'vision+refine') {
        const start = performance.now();
        const refined = refineWalls(plan.walls, lines, cv.mmPerPixel);
        const elapsed = performance.now() - start;
        await add(
          visionToRecognition(plan, cv.mmPerPixel, refined),
          `vision+refine${live ? `-trial-${trial}` : ''}`,
          visionMs,
          elapsed,
          calls,
          origin,
        );
      }
    } catch (error) {
      const safe =
        error instanceof GeminiError
          ? error.code
          : 'RECORDING_OR_CONVERSION_ERROR';
      const failedCalls = error instanceof GeminiError ? error.attempts : 0;
      actualRequests += failedCalls;
      rows.push({
        image: file,
        mode: `vision-trial-${trial}`,
        error: safe,
        calls: failedCalls,
        visionMs:
          error instanceof GeminiError ? Math.round(error.durationMs) : 0,
      });
      trials.push({ file, trial, error: safe, calls: failedCalls });
      console.log(
        `${file} trial ${trial}: ${safe}; CV result remains available.`,
      );
      process.exitCode = 1;
      if (
        [
          'HTTP_400',
          'HTTP_401',
          'HTTP_403',
          'HTTP_404',
          'MISSING_KEY',
        ].includes(safe)
      )
        break;
    }
  }
}
const machine = `${cpus()[0]?.model ?? 'unknown CPU'} / ${platform()} ${arch()} / Node ${process.version}`;
const averages = live
  ? ['vision', 'vision+refine'].map((mode) => {
      const items = details.flatMap((row) =>
        row.image === 'floorplan-a.jpg' &&
        row.mode.startsWith(mode + '-trial-') &&
        row.score
          ? [row.score.walls]
          : [],
      );
      return {
        image: 'floorplan-a.jpg',
        mode,
        succeeded: items.length,
        requested: 3,
        recall: items.length
          ? items.reduce((sum, row) => sum + row.recall * 100, 0) / items.length
          : null,
        precision: items.length
          ? items.reduce((sum, row) => sum + row.precision * 100, 0) /
            items.length
          : null,
      };
    })
  : [];
console.log(machine, `Actual API requests: ${actualRequests}`);
console.table(rows);
if (live) console.table(averages);
await writeFile(
  'tmp/bench-recognize.json',
  JSON.stringify(
    { machine, live, actualRequests, rows, averages, auxiliary, details },
    null,
    2,
  ) + '\n',
);
const keys = [
  'image',
  'mode',
  'scaleError',
  'walls',
  'matched',
  'recall',
  'precision',
  'cvMs',
  'visionMs',
  'refineMs',
  'calls',
  'origin',
];
const auxiliaryKeys = [
  'image',
  'mode',
  'kind',
  'predicted',
  'expected',
  'matched',
  'typeMatched',
  'recall',
  'precision',
];
const auxiliaryTable = `| ${auxiliaryKeys.join(' | ')} |\n| ${auxiliaryKeys.map(() => '---').join(' | ')} |\n${auxiliary.map((row) => `| ${auxiliaryKeys.map((key) => row[key] ?? 'N/A').join(' | ')} |`).join('\n')}`;
await writeFile(
  'tmp/bench-recognize.md',
  `Machine: ${machine}\n\n${live ? 'Live API calls' : 'Replay only; visionMs is recorded historical API latency, calls=0.'}\n\n| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${keys.map((key) => row[key] ?? row.error ?? 'N/A').join(' | ')} |`).join('\n')}\n\nLive averages: ${JSON.stringify(averages)}\n\nOpening/room scores (no refinement):\n\n${auxiliaryTable}\n`,
);
if (live)
  await writeFile(
    'tmp/vision-live-trials.json',
    JSON.stringify(trials, null, 2) + '\n',
  );
