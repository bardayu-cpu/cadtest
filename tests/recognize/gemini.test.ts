import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiError,
  recognizeWithGemini,
  visionPrompt,
} from '../../src/recognize/vision/gemini';

const plan = {
  walls: [
    {
      id: 'w',
      start: { x: 10, y: 50 },
      end: { x: 210, y: 50 },
      kind: 'interior',
      thicknessPixels: 10,
    },
  ],
  openings: [],
  rooms: [],
};
const size = { width: 300, height: 200 };
const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const response = (value: unknown = plan) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify(value) }] },
        },
      ],
      modelVersion: 'test-model',
    }),
    { status: 200 },
  );
let cacheDir: string;
beforeEach(async () => {
  cacheDir = resolve('tmp', `vision-test-${randomUUID()}`);
  await mkdir(cacheDir, { recursive: true });
  vi.stubEnv('GEMINI_API_KEY', 'mock-credential');
  vi.stubEnv('GEMINI_MODEL', 'test-model');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(cacheDir, { recursive: true, force: true });
});
describe('Node-only Gemini REST adapter', () => {
  it('uses structured JSON, sends key in a header only, and replays cache without a key or API call', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response());
    const first = await recognizeWithGemini(image, size, {
      cacheDir,
      fetch: request,
    });
    expect(first.calls).toBe(1);
    expect(first.cacheHit).toBe(false);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).not.toContain('mock-credential');
    expect(options?.headers).toMatchObject({
      'x-goog-api-key': 'mock-credential',
    });
    const payload = JSON.parse(String(options?.body));
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseJsonSchema.required).toContain(
      'walls',
    );
    const point =
      payload.generationConfig.responseJsonSchema.properties.walls.items
        .properties.start.properties;
    expect(point.x.maximum).toBe(300);
    expect(point.y.maximum).toBe(200);
    vi.stubEnv('GEMINI_API_KEY', '');
    const cached = await recognizeWithGemini(image, size, {
      cacheDir,
      fetch: request,
    });
    expect(cached.calls).toBe(0);
    expect(cached.cacheHit).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(cached.recording)).not.toContain('mock-credential');
  });
  it('invalidates cache for image, model, and corrupt recording changes', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    await recognizeWithGemini(image, size, { cacheDir, fetch: request });
    await recognizeWithGemini(new Uint8Array([1, 2, 3]), size, {
      cacheDir,
      fetch: request,
    });
    vi.stubEnv('GEMINI_MODEL', 'another-model');
    await recognizeWithGemini(image, size, { cacheDir, fetch: request });
    for (const file of await readdir(cacheDir))
      await writeFile(resolve(cacheDir, file), 'corrupt');
    await recognizeWithGemini(image, size, { cacheDir, fetch: request });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('retries 429 with exponential backoff and records actual request count', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(response());
    const sleep = vi.fn(async () => {});
    const result = await recognizeWithGemini(image, size, {
      cacheDir,
      fetch: request,
      sleep,
    });
    expect(result.calls).toBe(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });
  it('limits retries to three and hides upstream errors/credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('contains mock-credential and image bytes'));
    const sleep = vi.fn(async () => {});
    await expect(
      recognizeWithGemini(image, size, { cacheDir, fetch: request, sleep }),
    ).rejects.toMatchObject({ code: 'NETWORK_OR_IO', attempts: 4 });
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('handles timeout, non-retryable auth and missing key failures explicitly', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('mock-credential', 'TimeoutError'));
    await expect(
      recognizeWithGemini(image, size, {
        cacheDir,
        fetch: request,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', attempts: 4 });
    request
      .mockReset()
      .mockResolvedValue(new Response('mock-credential', { status: 403 }));
    try {
      await recognizeWithGemini(image, size, { cacheDir, fetch: request });
      throw new Error('must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiError);
      expect(String(error)).not.toContain('mock-credential');
    }
    expect(request).toHaveBeenCalledTimes(1);
    vi.stubEnv('GEMINI_API_KEY', '');
    request.mockClear();
    await expect(
      recognizeWithGemini(image, size, { cacheDir, fetch: request }),
    ).rejects.toMatchObject({ code: 'MISSING_KEY', attempts: 0 });
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects truncated and invalid structured responses without caching them', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
        ),
      )
      .mockResolvedValueOnce(response({ walls: 'bad' }));
    await expect(
      recognizeWithGemini(image, size, { cacheDir, fetch: request }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_RESPONSE' });
    await expect(
      recognizeWithGemini(image, size, { cacheDir, fetch: request }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(
      (await readdir(cacheDir)).every((file) => file.startsWith('invalid-')),
    ).toBe(true);
  });
  it('redacts a credential accidentally echoed by a successful provider', async () => {
    const raw = JSON.parse(await response().text());
    raw.debug = 'mock-credential';
    await recognizeWithGemini(image, size, {
      cacheDir,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(raw))),
    });
    const file = (await readdir(cacheDir))[0];
    expect(await readFile(resolve(cacheDir, file), 'utf8')).not.toContain(
      'mock-credential',
    );
  });
  it('does not spend another API call when persisting a valid response fails', async () => {
    await rm(cacheDir, { recursive: true });
    await writeFile(cacheDir, 'blocked cache directory');
    const request = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(
      recognizeWithGemini(image, size, { cacheDir, fetch: request }),
    ).rejects.toMatchObject({ code: 'CACHE_WRITE', attempts: 1 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('refuses cache paths outside ignored tmp', async () => {
    await expect(
      recognizeWithGemini(image, size, { cacheDir: 'fixtures' }),
    ).rejects.toThrow('tmp');
  });
  it('keeps the prompt generic and blocks browser bundling of the adapter', async () => {
    expect(visionPrompt(300, 200)).toContain('Cabinets');
    expect(visionPrompt(300, 200)).not.toMatch(
      /floorplan-[ab]|15040|6390|29 walls|9 rooms/,
    );
    await expect(
      build({
        entryPoints: ['src/recognize/vision/gemini.ts'],
        bundle: true,
        platform: 'browser',
        write: false,
        logLevel: 'silent',
      }),
    ).rejects.toThrow();
    const browser = await build({
      entryPoints: ['src/recognize/pipeline.ts'],
      bundle: true,
      platform: 'browser',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    expect(
      Object.keys(browser.metafile!.inputs).some((path) =>
        path.endsWith('/vision/gemini.ts'),
      ),
    ).toBe(false);
  });
});
