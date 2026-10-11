import { expect, test } from '@playwright/test';
import { completeProject } from '../helpers/project';
import { exportProjectJson } from '../../src/model/project';

// Compile the editor route before concurrent browser flows start in next dev.
test.beforeAll(async ({ request }) => {
  expect((await request.get('/project/example')).ok()).toBe(true);
});

async function waitForSave(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toHaveText('已保存到本机');
}

test('creates, opens, renames, undoes, redoes, refreshes and deletes a local project', async ({
  page,
}) => {
  await page.goto('/');
  await waitForSave(page);
  await page.getByRole('textbox', { name: '项目名称' }).fill('我的家');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(
    page.getByRole('heading', { name: '我的家', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '项目信息' }).click();
  await page.getByRole('textbox', { name: '项目名称' }).fill('新名字');
  await page.getByRole('button', { name: '保存名称' }).click();
  await expect(
    page.getByRole('heading', { name: '新名字', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(
    page.getByRole('heading', { name: '我的家', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(
    page.getByRole('heading', { name: '新名字', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.keyboard.press('Meta+Shift+z');
  await expect(
    page.getByRole('heading', { name: '新名字', exact: true }),
  ).toBeVisible();
  await waitForSave(page);
  const url = page.url();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '新名字', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '返回项目列表' }).click();
  await expect(
    page.getByRole('heading', { name: '新名字', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '打开 新名字' }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole('link', { name: '返回项目列表' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除 新名字' }).click();
  await expect(page.getByRole('heading', { name: '暂无项目' })).toBeVisible();
  await waitForSave(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂无项目' })).toBeVisible();
});

test('imports every model field, survives refresh and downloads the identical JSON', async ({
  page,
}) => {
  const project = completeProject();
  await page.goto('/');
  await waitForSave(page);
  await page.getByLabel('导入 JSON 项目').setInputFiles({
    name: 'project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportProjectJson(project)),
  });
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible();
  await waitForSave(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: `导出 ${project.name}` }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(`${project.name}.json`);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Missing download stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual(project);
  await page.getByRole('link', { name: `打开 ${project.name}` }).click();
  await expect(page).toHaveURL(/\/project\//, { timeout: 15000 });
  await expect(
    page.getByRole('region', { name: '编辑画布', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const sidebar = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await sidebar.isVisible()) await sidebar.click();
  await expect(
    page.getByText('1 面墙 · 1 个门窗 · 1 个房间 · 1 件家具 · 2 个锚点'),
  ).toBeVisible();
});

test('rejects malformed and structurally invalid JSON with a Chinese message', async ({
  page,
}) => {
  await page.goto('/');
  await waitForSave(page);
  for (const { text, message } of [
    { text: '{broken', message: '文件不是有效的 JSON' },
    { text: '{"version":2}', message: '项目数据格式错误' },
  ]) {
    await page.getByLabel('导入 JSON 项目').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      message,
    );
    await expect(page.getByRole('heading', { name: '暂无项目' })).toBeVisible();
  }
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page).toHaveURL(/\/project\//);
});

for (const event of ['visibilitychange', 'pagehide'] as const) {
  test(`flushes pending edits immediately on ${event}`, async ({ page }) => {
    // Hold only the autosave debounce so the test proves that the event initiates
    // a write, rather than passing after an ordinary timer-driven autosave.
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      Object.defineProperty(window, 'setTimeout', {
        configurable: true,
        value: (handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
          original(handler, timeout === 400 ? 60000 : timeout, ...args),
      });
    });
    await page.goto('/');
    await waitForSave(page);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await expect(page).toHaveURL(/\/project\//);
    await expect(page.getByRole('button', { name: '项目信息' })).toBeEnabled();
    await page.getByRole('button', { name: '项目信息' }).click();
    await expect(page.getByRole('button', { name: '保存名称' })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: '项目名称' })).toBeVisible();
    const name = `即时保存 ${event}`;
    await page.getByRole('textbox', { name: '项目名称' }).fill(name);
    await page.getByRole('button', { name: '保存名称' }).click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('正在保存…');
    await page.evaluate((eventName) => {
      if (eventName === 'pagehide') {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
      } else {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'visibilityState');
      }
    }, event);
    await expect(page.getByRole('status')).toHaveText('已保存到本机', {
      timeout: 2000,
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  });
}

test('rejects dangling references with a Chinese field message', async ({
  page,
}) => {
  const project = completeProject();
  project.openings[0].wallId = 'missing';
  await page.goto('/');
  await waitForSave(page);
  await page.getByLabel('导入 JSON 项目').setInputFiles({
    name: 'dangling.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    '门窗引用的墙体不存在（openings.0.wallId）',
  );
  await expect(page.getByRole('heading', { name: '暂无项目' })).toBeVisible();
});
