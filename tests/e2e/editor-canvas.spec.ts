import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { completeProject } from '../helpers/project';
import type { Project, Vec2 } from '../../src/model/types';
import fixture from '../../fixtures/floorplan-a.calibration.json' with { type: 'json' };

// Avoid concurrent cold compilation competing with navigation assertions.
test.beforeAll(async ({ request }) => {
  expect((await request.get('/project/example')).ok()).toBe(true);
});

async function openEditor(page: Page, project?: Project) {
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('已保存到本机');
  if (project) {
    await page.getByLabel('导入 JSON 项目').setInputFiles({
      name: 'geometry.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByRole('link', { name: `打开 ${project.name}` }).click();
  } else
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page).toHaveURL(/\/project\//, { timeout: 15000 });
  await expect(page.getByRole('button', { name: '保存名称' })).toBeEnabled();
  await expect(
    page.getByRole('region', { name: '编辑画布', exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
async function uploadFixture(page: Page, buffer?: Buffer) {
  if (buffer)
    await page.getByLabel('上传户型图').setInputFiles({
      name: 'floorplan-with-exif.jpg',
      mimeType: 'image/jpeg',
      buffer,
    });
  else
    await page
      .getByLabel('上传户型图')
      .setInputFiles('fixtures/floorplan-a.jpg');
  await expect(
    page.getByRole('region', { name: '户型图画布', exact: true }),
  ).toHaveAttribute('data-image-width', String(fixture.width), {
    timeout: 15000,
  });
  await expect(page.getByRole('button', { name: '手动校准' })).toBeEnabled();
}
async function pickImagePoint(page: Page, point: Vec2) {
  const region = page.getByRole('region', { name: '户型图画布', exact: true });
  await region.scrollIntoViewIfNeeded();
  const bounds = await region.boundingBox();
  if (!bounds) throw new Error('Missing canvas bounds');
  const view = await region.evaluate((element) => ({
    x: Number(element.getAttribute('data-viewport-x')),
    y: Number(element.getAttribute('data-viewport-y')),
    scale: Number(element.getAttribute('data-viewport-scale')),
  }));
  await page.mouse.click(
    bounds.x + view.x + point.x * view.scale,
    bounds.y + view.y + point.y * view.scale,
  );
}
async function selectLine(page: Page, line: Vec2[]) {
  await page.getByRole('button', { name: '手动校准' }).click();
  await pickImagePoint(page, line[0]);
  await pickImagePoint(page, line[1]);
  await expect(page.getByLabel('真实距离（mm）')).toBeVisible();
}
async function exportProject(page: Page): Promise<Project> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const stream = await (await downloading).createReadStream();
  if (!stream) throw new Error('Missing project download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Project;
}
function withExif(image: Buffer) {
  // Synthetic, non-personal EXIF ImageDescription. The source bytes contain the
  // marker; the editor must persist only a fresh raster encoding without it.
  const description = Buffer.from('cadtest-private-metadata\0');
  const tiff = Buffer.alloc(26 + description.length);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x010e, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(description.length, 14);
  tiff.writeUInt32LE(26, 18);
  description.copy(tiff, 26);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    image.subarray(0, 2),
    header,
    payload,
    image.subarray(2),
  ]);
}

test('redraws the fixture without EXIF, calibrates 15040, verifies the lower line, and preserves geometry on recalibration', async ({
  page,
}) => {
  const project = completeProject();
  project.background = {
    imageDataUrl: '',
    mmPerPixel: 1,
    offset: { x: 0, y: 0 },
    opacity: 1,
  };
  await openEditor(page, project);
  const source = withExif(await readFile('fixtures/floorplan-a.jpg'));
  expect(source.includes(Buffer.from('cadtest-private-metadata'))).toBe(true);
  await uploadFixture(page, source);
  await selectLine(page, fixture.top);
  await page.getByLabel('真实距离（mm）').fill(String(fixture.distanceMm));
  await page.getByRole('button', { name: '应用校准' }).click();
  await expect(page.getByText(/校准完成：1 像素/)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('editor-calibrated.png'),
    fullPage: true,
  });
  const calibrated = await exportProject(page);
  expect(calibrated.background.imageDataUrl).toMatch(
    /^data:image\/png;base64,/,
  );
  const raster = Buffer.from(
    calibrated.background.imageDataUrl.split(',')[1],
    'base64',
  );
  expect(raster.includes(Buffer.from('Exif\0\0'))).toBe(false);
  expect(raster.includes(Buffer.from('cadtest-private-metadata'))).toBe(false);
  await selectLine(page, fixture.bottom);
  const measured = Number(
    (await page.getByLabel('当前两点距离').textContent())?.match(
      /([\d.]+) mm/,
    )?.[1],
  );
  expect(
    Math.abs(measured - fixture.distanceMm) / fixture.distanceMm,
  ).toBeLessThan(0.01);
  await page.getByLabel('真实距离（mm）').fill('7520');
  await page.getByRole('button', { name: '应用校准' }).click();
  const changed = await exportProject(page);
  expect(changed.background.mmPerPixel).toBeCloseTo(
    calibrated.background.mmPerPixel / 2,
    5,
  );
  for (const key of [
    'walls',
    'openings',
    'rooms',
    'furniture',
    'anchors',
    'panoramas',
    'floorPlanRenders',
  ] as const)
    expect(changed[key]).toEqual(project[key]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await exportProject(page)).background.mmPerPixel).toBe(
    calibrated.background.mmPerPixel,
  );
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已保存到本机');
  await page.reload();
  await uploadLoaded(page);
  expect(await exportProject(page)).toEqual(changed);
});
async function uploadLoaded(page: Page) {
  await expect(
    page.getByRole('region', { name: '户型图画布', exact: true }),
  ).toHaveAttribute('data-image-width', String(fixture.width), {
    timeout: 15000,
  });
}

test('zooms around the pointer, pans with Space, displays mm coordinates and leaves saved model data unchanged', async ({
  page,
}) => {
  await openEditor(page);
  await uploadFixture(page);
  const original = await exportProject(page);
  const region = page.getByRole('region', { name: '户型图画布', exact: true });
  await region.scrollIntoViewIfNeeded();
  const box = await region.boundingBox();
  if (!box) throw new Error('Missing canvas');
  const view = async () =>
    region.evaluate((element) => ({
      x: Number(element.getAttribute('data-viewport-x')),
      y: Number(element.getAttribute('data-viewport-y')),
      scale: Number(element.getAttribute('data-viewport-scale')),
    }));
  const before = await view();
  const x = Math.round(box.x + box.width / 2),
    y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await expect(page.getByLabel('鼠标位置')).toContainText('mm');
  const position = await page.getByLabel('鼠标位置').textContent();
  await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => (await view()).scale)
    .toBeGreaterThan(before.scale);
  expect(await page.getByLabel('鼠标位置').textContent()).toBe(position);
  const zoomed = await view();
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 25, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(async () => (await view()).x).toBeCloseTo(zoomed.x + 40, 1);
  expect((await view()).y).toBeCloseTo(zoomed.y + 25, 1);
  expect(await exportProject(page)).toEqual(original);
  await page.getByRole('button', { name: '适应画布' }).click();
  expect((await view()).scale).toBeCloseTo(before.scale, 5);
});

test('persists opacity, toggles the background and keeps other steps as placeholders', async ({
  page,
}) => {
  await openEditor(page);
  await uploadFixture(page);
  const opacity = page.getByRole('slider', { name: '底图透明度' });
  await opacity.focus();
  await page.keyboard.press('Home');
  for (let index = 0; index < 7; index++)
    await page.keyboard.press('ArrowRight');
  await expect(opacity).toHaveValue('0.35');
  await page.getByRole('checkbox', { name: '显示户型图' }).uncheck();
  await expect(page.getByRole('button', { name: '手动校准' })).toBeDisabled();
  const canvas = page
    .getByRole('region', { name: '户型图画布', exact: true })
    .locator('canvas')
    .first();
  await expect
    .poll(() =>
      canvas.evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 0);
      }),
    )
    .toBe(false);
  await page.getByRole('checkbox', { name: '显示户型图' }).check();
  await expect(page.getByRole('button', { name: '手动校准' })).toBeEnabled();
  for (const label of ['识别', '家具', '风格', '锚点', '渲染', '发布']) {
    await page
      .getByRole('navigation', { name: '项目步骤' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(
      page.getByText(
        '此步骤将在后续版本提供。当前可以上传户型图、调整画布和手动校准比例尺。',
      ),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: '返回编辑步骤' }).click();
  await uploadLoaded(page);
  await expect(page.getByRole('status')).toHaveText('已保存到本机');
  await page.reload();
  await uploadLoaded(page);
  await expect(page.getByRole('slider', { name: '底图透明度' })).toHaveValue(
    '0.35',
  );
  expect((await exportProject(page)).background.opacity).toBe(0.35);
});

test('rejects bad uploads and invalid calibration without overwriting the current project', async ({
  page,
}) => {
  await openEditor(page);
  await uploadFixture(page);
  const original = await exportProject(page);
  for (const file of [
    {
      name: 'bad.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    },
    {
      name: 'broken.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not a jpeg'),
    },
  ]) {
    await page.getByLabel('上传户型图').setInputFiles(file);
    await expect(
      page
        .getByRole('region', { name: '编辑画布', exact: true })
        .getByRole('alert'),
    ).toBeVisible();
    expect(await exportProject(page)).toEqual(original);
  }
  await selectLine(page, [fixture.top[0], fixture.top[0]]);
  await page.getByLabel('真实距离（mm）').fill('15040');
  await page.getByRole('button', { name: '应用校准' }).click();
  await expect(
    page
      .getByRole('region', { name: '编辑画布', exact: true })
      .getByRole('alert'),
  ).toContainText('至少需要相距 1 像素');
  await page.getByRole('button', { name: '重新选点' }).click();
  await pickImagePoint(page, fixture.top[0]);
  await pickImagePoint(page, fixture.top[1]);
  await page.getByLabel('真实距离（mm）').fill('0');
  await page.getByRole('button', { name: '应用校准' }).click();
  await expect(
    page
      .getByRole('region', { name: '编辑画布', exact: true })
      .getByRole('alert'),
  ).toContainText('请输入大于零');
  expect(await exportProject(page)).toEqual(original);
  await page.getByRole('button', { name: '取消校准' }).click();
  await expect(page.getByLabel('真实距离（mm）')).toBeHidden();
});

test('does not reuse calibration points from an image that has been undone', async ({
  page,
}) => {
  await openEditor(page);
  await uploadFixture(page);
  const original = await exportProject(page);
  await page.getByLabel('上传户型图').setInputFiles('fixtures/floorplan-b.jpg');
  const region = page.getByRole('region', { name: '户型图画布', exact: true });
  await expect(region).toHaveAttribute('data-image-width', '1071');
  await selectLine(page, [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
  ]);
  await expect(page.getByLabel('真实距离（mm）')).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(region).toHaveAttribute('data-image-width', '1264');
  await expect(page.getByLabel('真实距离（mm）')).toBeHidden();
  expect(await exportProject(page)).toEqual(original);
});
