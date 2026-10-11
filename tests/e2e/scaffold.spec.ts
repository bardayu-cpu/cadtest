import { expect, test } from '@playwright/test';

test('home page renders a project list empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '暂无项目' })).toBeVisible();
});

test('project and share placeholders link back to the home page', async ({
  page,
}) => {
  await page.goto('/project/example');
  await expect(page.getByRole('heading', { name: '项目编辑器' })).toBeVisible();
  await page.getByRole('link', { name: '返回项目列表' }).click();
  await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();

  await page.goto('/s/example');
  await expect(page.getByRole('heading', { name: '全景查看' })).toBeVisible();
});

test('unfinished API routes explicitly reject requests', async ({
  request,
}) => {
  for (const route of ['recognize', 'layout', 'render', 'publish']) {
    const response = await request.post(`/api/${route}`, { data: {} });
    expect(response.status()).toBe(501);
    expect(await response.json()).toEqual({ error: '此功能尚未实现。' });
  }
});
