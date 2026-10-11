import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

// Independent local browser harness; does not touch Next.js pages or editor.
const require = createRequire(import.meta.url);
const root = resolve('test-results/recognize-browser');
await mkdir(root, { recursive: true });
await mkdir('tmp', { recursive: true });
await writeFile('tmp/.gitignore', '*\n');
await writeFile(
  resolve(root, 'browser-entry.js'),
  `
import {recognizeFloorPlan} from '../../src/recognize/pipeline';
const output=document.querySelector('pre');
try {
  const results=[];
  for(const name of ['floorplan-a.jpg','floorplan-b.jpg']) {
    const image=await (await fetch('/fixtures/'+name)).blob();
    const origin=location.origin;
    const result=await recognizeFloorPlan(image,{ocr:{workerPath:origin+'/ocr/worker.min.js',corePath:origin+'/ocr/core',langPath:origin+'/ocr/lang'}});
    results.push({name,...result});
  }
  output.textContent=JSON.stringify(results,null,2);
  await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(results)});
} catch(error){ output.textContent=String(error); }
`,
);
const bundle = await build({
  entryPoints: [resolve(root, 'browser-entry.js')],
  outdir: resolve(root, 'dist'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  metafile: true,
  logLevel: 'warning',
});
await writeFile(
  resolve(root, 'metafile.json'),
  JSON.stringify(bundle.metafile, null, 2),
);
const entry =
  bundle.metafile.outputs[resolve(root, 'dist/browser-entry.js')] ??
  Object.values(bundle.metafile.outputs).find((output) =>
    output.entryPoint?.endsWith('browser-entry.js'),
  );
if (
  !entry ||
  Object.keys(entry.inputs).some((input) =>
    input.includes('node_modules/tesseract.js/'),
  )
)
  throw new Error('OCR leaked into initial browser bundle.');
console.log(
  `Initial browser entry: ${entry.bytes} bytes; OCR is in a lazy chunk.`,
);
const html =
  '<!doctype html><html lang="zh"><meta charset="utf-8"><title>Issue 13 浏览器识别验证</title><h1>浏览器比例尺与墙体识别</h1><pre>识别中…</pre><script type="module" src="/browser-entry.js"></script></html>';
const core = dirname(require.resolve('tesseract.js-core'));
const worker = resolve(
  dirname(require.resolve('tesseract.js')),
  '../dist/worker.min.js',
);
const lang = resolve(
  require.resolve('@tesseract.js-data/eng'),
  '../4.0.0_best_int/eng.traineddata.gz',
);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/result' && request.method === 'POST') {
    let body = '';
    for await (const part of request) {
      body += part;
      if (body.length > 2_000_000) {
        response.writeHead(413).end();
        return;
      }
    }
    await writeFile(
      'tmp/browser-recognize-result.json',
      JSON.stringify(JSON.parse(body), null, 2) + '\n',
    );
    response.end('saved');
    console.log('Browser result saved to tmp/browser-recognize-result.json');
    return;
  }
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
    return;
  }
  let file: string | undefined;
  if (/^\/fixtures\/floorplan-[ab]\.jpg$/.test(pathname))
    file = resolve(`.${pathname}`);
  else if (pathname === '/ocr/worker.min.js') file = worker;
  else if (pathname === '/ocr/lang/eng.traineddata.gz') file = lang;
  else if (/^\/ocr\/core\/tesseract-core[\w-]*\.wasm(?:\.js)?$/.test(pathname))
    file = resolve(core, pathname.split('/').at(-1)!);
  else if (/^\/[\w-]+\.js$/.test(pathname))
    file = resolve(root, 'dist', pathname.slice(1));
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(file);
    response.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.wasm')
          ? 'application/wasm'
          : file.endsWith('.jpg')
            ? 'image/jpeg'
            : 'application/octet-stream',
    );
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(3103, '127.0.0.1', () =>
  console.log('Browser smoke harness: http://127.0.0.1:3103'),
);
