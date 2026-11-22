import { openApplicationAction, captureToInbox } from '../support/ui-actions';
import { expect, test, type Page } from '../support/e2e-test';

async function holdFailure(page: Page, matches: (sql: string, params: unknown[]) => boolean) {
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__test-sqlite', async route => {
    const body = route.request().postDataJSON() as { sql?: string; params?: unknown[] };
    if (!held && body.sql && matches(body.sql, body.params ?? [])) {
      held = true; await gate;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'readFailure' }) });
    } else await route.continue();
  });
  return { held: () => held, release };
}

test('Inbox move waits for its destination, retries failed reads without writes and preserves the original Markdown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const response = await page.request.post('/__test-sqlite', { data: { op: 'markdown-seed' } });
  expect(response.ok(), await response.text()).toBe(true);
  const scope = (await response.json()).value as { library_id: string; collection_id: string };
  await page.reload();
  await openApplicationAction(page, 'Оформление');
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  const original = '# Перенос **после ошибки** 🦔\n\nТекст без потери <script>window.inboxUnsafe=true</script>';
  await captureToInbox(page);
  await page.getByRole('textbox', { name: 'Содержимое', exact: true }).fill(original);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  const row = page.locator('.entry').filter({ hasText: 'Перенос после ошибки' });
  await expect(row.locator('strong')).toHaveText('Перенос после ошибки 🦔');
  const recordId = await row.getAttribute('data-entry-id'); expect(recordId).toBeTruthy();
  const snapshot = async () => {
    const result = await page.request.post('/__test-sqlite', { data: { op: 'query', sql: `SELECT r.*,
      (SELECT count(*) FROM record_versions WHERE record_id=r.id) AS versions,
      (SELECT value FROM local_settings WHERE key='hlc') AS clock,
      (SELECT count(*) FROM change_log) AS changes FROM records r WHERE r.id=?`, params: [recordId] } });
    expect(result.ok(), await result.text()).toBe(true); return (await result.json()).value;
  };
  const before = await snapshot();
  expect(Object.values(JSON.parse(before[0].data))).toContain(original);
  await row.click(); await expect(page.locator('.detail #record-title')).toHaveText('Перенос после ошибки 🦔');
  await page.getByRole('button', { name: 'Перенести в коллекцию', exact: true }).click();
  const target = page.getByRole('combobox', { name: 'Коллекция назначения', exact: true });
  const libraries = await holdFailure(page, (sql, params) => sql.includes('SELECT c.* FROM collections c JOIN libraries') && params[0] === scope.library_id);
  try {
    await page.getByRole('combobox', { name: 'Библиотека назначения', exact: true }).selectOption(scope.library_id);
    await expect.poll(libraries.held).toBe(true);
    await expect(page.getByText('Загружаем коллекции…', { exact: true })).toBeVisible();
    await expect(target).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/move-collections-loading-phone.png', fullPage: true });
    libraries.release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить назначение переноса');
    await expect(target).toBeDisabled();
    await expect(page.getByText('В этой библиотеке нет доступных коллекций. Выберите другую библиотеку.', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(target).toBeEnabled();
    expect(await snapshot()).toEqual(before);
  } finally { libraries.release(); }
  const fields = await holdFailure(page, (sql, params) => sql.startsWith('SELECT * FROM fields WHERE collection_id=') && params[0] === scope.collection_id);
  try {
    await target.selectOption(scope.collection_id); await expect.poll(fields.held).toBe(true);
    await expect(page.getByText('Готовим поля для переноса…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
    fields.release();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: 'test-results/move-preview-error-phone.png', fullPage: true });
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Перенос после ошибки 🦔');
    await expect(page.getByRole('textbox', { name: 'Текст', exact: true })).toHaveValue(original.slice(original.indexOf('\n') + 1));
    const title = page.getByRole('textbox', { name: 'Название', exact: true });
    await title.fill('Несохранённый предпросмотр');
    await target.selectOption(scope.collection_id);
    await page.getByRole('combobox', { name: 'Библиотека назначения', exact: true }).selectOption(scope.library_id);
    await expect(title).toHaveValue('Несохранённый предпросмотр');
    expect(await snapshot()).toEqual(before);
    await page.locator('.move-original summary').click();
    await expect(page.locator('.move-original .original-content')).toHaveText(original);
    await expect(page.locator('.move-original script')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.locator('[data-editor]')).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
  } finally { fields.release(); }
});
