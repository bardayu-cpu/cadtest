import { expect, test, type Page } from '@playwright/test';
import type { Project, Vec2 } from '../../src/model/types';
import { createProject } from '../../src/model/project';
import trace from '../../fixtures/floorplan-a.wall-trace.json' with { type: 'json' };

test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});
async function open(page: Page, project?: Project) {
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('已保存到本机');
  if (project) {
    await page.getByLabel('导入 JSON 项目').setInputFiles({
      name: 'walls.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByRole('link', { name: `打开 ${project.name}` }).click();
  } else
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('button', { name: '墙工具' })).toBeVisible({
    timeout: 15000,
  });
  if (
    await page
      .getByRole('button', { name: '展开侧栏', exact: true })
      .isVisible()
  )
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
}
async function screen(page: Page, mm: Vec2, ratio = 1) {
  const region = page.getByRole('region', { name: '户型图画布', exact: true });
  const bounds = await region.boundingBox();
  if (!bounds) throw new Error('Missing canvas');
  const view = await region.evaluate((el) => ({
    x: Number(el.getAttribute('data-viewport-x')),
    y: Number(el.getAttribute('data-viewport-y')),
    scale: Number(el.getAttribute('data-viewport-scale')),
  }));
  return {
    x: bounds.x + view.x + (mm.x / ratio) * view.scale,
    y: bounds.y + view.y + (mm.y / ratio) * view.scale,
  };
}
async function click(page: Page, point: Vec2, ratio = 1) {
  const p = await screen(page, point, ratio);
  await page.mouse.click(p.x, p.y);
}
async function exported(page: Page): Promise<Project> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const stream = await (await download).createReadStream();
  if (!stream) throw new Error('Missing download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString()) as Project;
}
async function drag(page: Page, from: Vec2, to: Vec2, shift = false) {
  const a = await screen(page, from),
    b = await screen(page, to);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}
test('traces all outer walls and main interior partitions on the real calibrated sample, then persists and undoes edits', async ({
  page,
}, info) => {
  await open(page);
  await page.getByLabel('上传户型图').setInputFiles('fixtures/floorplan-a.jpg');
  const region = page.getByRole('region', { name: '户型图画布', exact: true });
  await expect(region).toHaveAttribute('data-image-width', '1264');
  await page.getByRole('button', { name: '手动校准', exact: true }).click();
  await click(page, { x: 123, y: 45 });
  await click(page, { x: 1091, y: 45 });
  await page.getByLabel('真实距离（mm）').fill('15040');
  await page.getByRole('button', { name: '应用校准' }).click();
  const ratio = 15040 / 968;
  await page.getByRole('button', { name: '墙工具', exact: true }).click();
  for (const path of trace.paths) {
    for (const point of path)
      await click(page, { x: point.x * ratio, y: point.y * ratio }, ratio);
    await page.keyboard.press('Escape');
  }
  const result = await exported(page);
  const count = trace.paths.reduce((sum, path) => sum + path.length - 1, 0);
  expect(result.walls).toHaveLength(count);
  expect(
    result.walls.every((w) => w.source === 'manual' && w.thickness === 240),
  ).toBe(true);
  expect(
    result.walls.every(
      (w) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) > 0,
    ),
  ).toBe(true);
  await page.keyboard.press('Control+z');
  expect((await exported(page)).walls).toHaveLength(count - 1);
  await page.keyboard.press('Control+Shift+z');
  expect((await exported(page)).walls).toEqual(result.walls);
  await expect(page.getByRole('status')).toHaveText('已保存到本机');
  await page.reload();
  await expect(page.getByRole('button', { name: '墙工具' })).toBeVisible();
  expect((await exported(page)).walls).toEqual(result.walls);
  await page.getByRole('button', { name: '墙工具' }).click();
  await page.screenshot({
    path: info.outputPath('wall-tool-1280x800.png'),
    scale: 'css',
  });
});
test('draws continuous walls, enters exact keyboard lengths, switches thickness and finishes with double click or Escape', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: '墙工具' }).click();
  await page.getByLabel('新墙厚度', { exact: true }).selectOption('120');
  await click(page, { x: 1000, y: 1000 });
  const pointer = await screen(page, { x: 3500, y: 1350 });
  await page.mouse.move(pointer.x, pointer.y);
  await expect(page.getByLabel('墙体状态')).toContainText('正交锁定');
  await page.keyboard.type('3000');
  await page.keyboard.press('Enter');
  await click(page, { x: 4000, y: 3500 });
  await page.keyboard.press('Escape');
  let result = await exported(page);
  expect(result.walls).toHaveLength(2);
  expect(result.walls[0].end).toEqual({ x: 4000, y: 1000 });
  expect(result.walls[1].end).toEqual({ x: 4000, y: 3500 });
  expect(result.walls.every((w) => w.thickness === 120)).toBe(true);
  await page.getByLabel('新墙厚度', { exact: true }).selectOption('custom');
  await page.getByLabel('自定义墙厚（mm）').fill('180');
  await click(page, { x: 5000, y: 4000 });
  await page.keyboard.down('Shift');
  await click(page, { x: 6500, y: 5500 });
  await page.keyboard.up('Shift');
  const last = await screen(page, { x: 7500, y: 5500 });
  await page.mouse.dblclick(last.x, last.y);
  await expect(page.getByLabel('墙体状态')).toHaveText('点击起点开始描墙');
  result = await exported(page);
  expect(result.walls).toHaveLength(4);
  expect(result.walls[2].thickness).toBe(180);
  expect(result.walls[2].start.y).not.toBe(result.walls[2].end.y);
  await page.keyboard.press('Control+z');
  expect((await exported(page)).walls).toHaveLength(3);
});
test('drags an endpoint and a whole auto wall through many positions as one undo each, and cascades deletion', async ({
  page,
}, info) => {
  const project = createProject('拖动批处理');
  project.walls = [
    {
      id: 'auto',
      start: { x: 1000, y: 1000 },
      end: { x: 4000, y: 1000 },
      thickness: 240,
      source: 'auto',
      confidence: 0.9,
    },
    {
      id: 'blue',
      start: { x: 1000, y: 6000 },
      end: { x: 7000, y: 6000 },
      thickness: 120,
      source: 'auto',
      confidence: 0.95,
    },
    {
      id: 'warn',
      start: { x: 1000, y: 4500 },
      end: { x: 7000, y: 4500 },
      thickness: 120,
      source: 'auto',
      confidence: 0.3,
    },
  ];
  project.openings = [
    {
      id: 'door',
      wallId: 'auto',
      offset: 500,
      width: 900,
      kind: 'door',
      sillHeight: 0,
      headHeight: 2100,
      source: 'auto',
    },
  ];
  await open(page, project);
  await click(page, { x: 2500, y: 1000 });
  await drag(page, { x: 4000, y: 1000 }, { x: 4800, y: 1350 });
  let changed = await exported(page);
  expect(changed.walls[0].end).toEqual({ x: 4800, y: 1000 });
  expect(changed.walls[0].source).toBe('manual');
  await page.keyboard.press('Control+z');
  expect((await exported(page)).walls).toEqual(project.walls);
  await page.keyboard.press('Control+Shift+z');
  expect((await exported(page)).walls).toEqual(changed.walls);
  await drag(page, { x: 2900, y: 1000 }, { x: 3500, y: 1600 });
  changed = await exported(page);
  expect(changed.walls[0].start).toEqual({ x: 1600, y: 1600 });
  expect(changed.walls[0].end).toEqual({ x: 5400, y: 1600 });
  await page.keyboard.press('Control+z');
  expect((await exported(page)).walls[0].start).toEqual({ x: 1000, y: 1000 });
  await page.keyboard.press('Control+Shift+z');
  expect((await exported(page)).walls).toEqual(changed.walls);
  await page.getByLabel('已选墙厚（mm）').fill('120');
  await page.getByLabel('已选墙厚（mm）').press('Enter');
  expect((await exported(page)).walls[0].thickness).toBe(120);
  await page.keyboard.press('Control+z');
  expect((await exported(page)).walls[0].thickness).toBe(240);
  await page.screenshot({
    path: info.outputPath('wall-colors-1280x800.png'),
    scale: 'css',
  });
  await page.keyboard.press('Delete');
  const removed = await exported(page);
  expect(removed.walls).toHaveLength(2);
  expect(removed.openings).toEqual([]);
  await page.keyboard.press('Control+z');
  const restored = await exported(page);
  expect(restored.walls).toEqual(changed.walls);
  expect(restored.openings).toEqual(project.openings);
});
test('cancels a drag on Escape and can draw a short typed vertical segment without endpoint snapping stealing its direction', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: '墙工具' }).click();
  await click(page, { x: 1000, y: 1000 });
  await click(page, { x: 4000, y: 1000 });
  const p = await screen(page, { x: 4000, y: 1050 });
  await page.mouse.move(p.x, p.y);
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  let result = await exported(page);
  expect(result.walls[1].end).toEqual({ x: 4000, y: 1050 });
  await page.getByRole('button', { name: '选择工具' }).click();
  await click(page, { x: 2500, y: 1000 });
  const a = await screen(page, { x: 4000, y: 1000 }),
    b = await screen(page, { x: 4800, y: 1000 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await exported(page)).walls).toEqual(result.walls);
  const end = await screen(page, { x: 4000, y: 1000 });
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  result = await exported(page);
  expect(result.walls).toHaveLength(1);
});
