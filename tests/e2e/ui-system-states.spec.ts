import { expect, test, type Page } from '../support/e2e-test';

async function holdRead(page: Page, matches: (sql: string) => boolean) {
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__test-sqlite', async route => {
    const sql = (route.request().postDataJSON() as { sql?: string }).sql;
    if (!held && sql && matches(sql)) {
      held = true; await gate;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'readFailure' }) });
    } else await route.continue();
  });
  return { held: () => held, release };
}
async function snapshot(page: Page) {
  const response = await page.request.post('/__test-sqlite', { data: { op: 'query', sql: `SELECT
    (SELECT count(*) FROM record_versions) AS versions,
    (SELECT value FROM local_settings WHERE key='hlc') AS hlc,
    (SELECT count(*) FROM change_log) AS changes,
    (SELECT value FROM app_meta WHERE key='trash:retention') AS retention` } });
  expect(response.ok(), await response.text()).toBe(true); return (await response.json()).value;
}

test('history and Trash distinguish a failed read from empty data, retry safely and keep unread retention disabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const response = await page.request.post('/__test-sqlite', { data: { op: 'history-seed' } });
  expect(response.ok(), await response.text()).toBe(true);
  const scope = (await response.json()).value as { library_id: string; library_name: string; record_id: string };
  await page.reload();
  await page.locator('.topbar').getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark');
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await page.getByRole('button', { name: `Открыть библиотеку «${scope.library_name}»`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Редакции»', exact: true }).click();
  await page.locator('.entry').filter({ hasText: 'Вторая редакция' }).click();
  const beforeHistory = await snapshot(page);
  const history = await holdRead(page, sql => sql.startsWith('SELECT * FROM record_versions WHERE record_id='));
  try {
    await page.getByRole('button', { name: 'История записи', exact: true }).click();
    await expect.poll(history.held).toBe(true);
    await expect(page.getByText('Загружаем историю…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить историю и запись', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'test-results/history-loading-phone.png', fullPage: true });
    history.release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить историю');
    await expect(page.getByText('Сохранённых версий нет.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/history-error-phone.png', fullPage: true });
    await page.getByRole('button', { name: 'Обновить историю и запись', exact: true }).click();
    await expect(page.locator('.history-versions button')).toHaveCount(2);
    expect(await snapshot(page)).toEqual(beforeHistory);
  } finally { history.release(); }
  await page.keyboard.press('Escape');
  await page.locator('.detail').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.detail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await expect(page.locator(`[data-trash-id="${scope.record_id}"]`)).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Библиотека в корзине', exact: true })).toBeEnabled();
  const beforeTrash = await snapshot(page);
  const trash = await holdRead(page, sql => sql.includes(' AS restorable') && sql.includes('FROM records r'));
  try {
    await page.getByRole('combobox', { name: 'Библиотека в корзине', exact: true }).selectOption(scope.library_id);
    await expect.poll(trash.held).toBe(true);
    const retention = page.getByRole('combobox', { name: 'Срок хранения в корзине', exact: true });
    await expect(page.getByText('Загружаем корзину…', { exact: true })).toBeVisible();
    await expect(retention).toBeDisabled();
    await page.screenshot({ path: 'test-results/trash-loading-phone.png', fullPage: true });
    trash.release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить корзину');
    await expect(page.getByText('Корзина пуста.', { exact: true })).toHaveCount(0);
    await expect(retention).toBeDisabled();
    await expect(retention).toHaveValue('unread');
    await expect(page.getByRole('button', { name: 'Сохранить срок хранения', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'test-results/trash-error-phone.png', fullPage: true });
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.locator('.trash-list > li')).toHaveCount(1);
    await expect(retention).toBeEnabled();
    expect(await snapshot(page)).toEqual(beforeTrash);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { trash.release(); }
});
