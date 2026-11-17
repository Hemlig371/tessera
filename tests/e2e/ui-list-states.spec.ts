import { expect, test } from '../support/e2e-test';

test('a delayed failed list read shows loading and Retry, without claiming the collection is empty', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await page.locator('.topbar').getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  const result = await page.request.post('/__test-sqlite', { data: { op: 'knowledge-seed', params: ['Состояния списка (dev/CI)'] } });
  expect(result.ok(), await result.text()).toBe(true);
  const scope = (await result.json()).value as { collection_id: string };
  const records = async () => (await (await page.request.post('/__test-sqlite', { data: { op: 'query', sql: 'SELECT id,data,hlc FROM records WHERE collection_id=? ORDER BY id', params: [scope.collection_id] } })).json()).value;
  const before = await records();
  await page.reload();
  await page.getByRole('button', { name: 'Открыть библиотеку «Состояния списка (dev/CI)»', exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
  await page.route('**/__test-sqlite', async route => {
    const sql = (route.request().postDataJSON() as { sql?: string }).sql;
    if (!held && sql?.includes('FROM records r') && sql.includes('ORDER BY')) {
      held = true; await gate;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'readFailure' }) });
    } else await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Открыть коллекцию «Материалы»', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.locator('.list-meta')).toHaveText('Загружаем записи…');
    await expect(page.locator('.browse-screen .empty')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/list-loading-phone.png', fullPage: true });
    release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить записи');
    await expect(page.locator('.browse-screen .empty')).toHaveCount(0);
    await expect(page.locator('.entry')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/list-error-phone.png', fullPage: true });
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.entry').first()).toBeEnabled();
    await expect(page.locator('.entry').first()).toContainText('Материал 001');
    expect(await records()).toEqual(before);
    await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('неттакогоматериала');
    await expect(page.getByRole('heading', { name: 'Ничего не найдено', exact: true })).toBeVisible();
    await expect(page.getByText('Измените запрос или фильтры.', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/list-no-results-phone.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});
