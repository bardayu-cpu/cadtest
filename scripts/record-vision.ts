import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import {
  GeminiError,
  recognizeWithGemini,
} from '../src/recognize/vision/gemini';

const args = process.argv.slice(2);
if (
  args.some((arg) => !['--live', 'a', 'b'].includes(arg)) ||
  args.filter((arg) => ['a', 'b'].includes(arg)).length > 1
)
  throw new Error('Usage: record:vision -- --live [a|b]');
if (!args.includes('--live'))
  throw new Error(
    'Recording sends public fixtures to Gemini; explicitly pass --live.',
  );
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
await mkdir('tmp', { recursive: true });
await writeFile('tmp/.gitignore', '*\n');
await mkdir('fixtures/vision', { recursive: true });
const trials = [];
const requested = args.find((arg) => ['a', 'b'].includes(arg));
for (const fixture of requested ? [requested] : ['a', 'b']) {
  const image = await readFile(`fixtures/floorplan-${fixture}.jpg`);
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error('Missing image size.');
  const count = fixture === 'a' ? 3 : 1;
  let savedRecording = false;
  for (let trial = 1; trial <= count; trial++) {
    try {
      const result = await recognizeWithGemini(
        image,
        { width, height },
        { bypassCache: true },
      );
      if (!savedRecording) {
        await writeFile(
          `fixtures/vision/floorplan-${fixture}.gemini.json`,
          JSON.stringify(result.recording, null, 2) + '\n',
        );
        savedRecording = true;
      }
      trials.push({ fixture, trial, ...result });
      console.log(
        `Image ${fixture} trial ${trial}: ${result.recording.plan.walls.length} walls, ${result.calls} requests, ${Math.round(result.durationMs)}ms`,
      );
    } catch (error) {
      if (!(error instanceof GeminiError))
        throw new Error('Recording failed; inspect local configuration.');
      trials.push({
        fixture,
        trial,
        error: error.code,
        calls: error.attempts,
        durationMs: error.durationMs,
      });
      console.log(
        `Image ${fixture} trial ${trial}: ${error.code}, ${error.attempts} requests`,
      );
      // A permanent configuration/auth/model failure should not consume more quota.
      if (
        [
          'HTTP_400',
          'HTTP_401',
          'HTTP_403',
          'HTTP_404',
          'MISSING_KEY',
        ].includes(error.code)
      )
        break;
    }
  }
}
await writeFile(
  requested
    ? `tmp/vision-live-${requested}.json`
    : 'tmp/vision-live-trials.json',
  JSON.stringify(trials, null, 2) + '\n',
);
if (trials.some((t) => 'error' in t)) process.exitCode = 1;
