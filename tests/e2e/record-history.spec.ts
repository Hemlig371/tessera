import { expect, test, type Page } from '../support/e2e-test';
type Scope = { library_name: string; collection_id: string; field_id: string; record_id: string; first_version_id: string; other_id: string };

async function seed(page: Page): Promise<Scope> {
  await page.goto('/'); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const result = await page.request.post('/__test-sqlite', { data: { op: 'history-seed' } });
  expect(result.ok(), await result.text()).toBe(true);
  const scope = (await result.json()).value as Scope;
  await page.reload();
  await page.getByRole('button', { name: `Открыть библиотеку «${scope.library_name}»`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Редакции»', exact: true }).click();
  await page.locator('.entry').filter({ hasText: 'Вторая редакция' }).click();
  return scope;
}
async function snapshot(page: Page) {
  const result = await page.request.post('/__test-sqlite', { data: { op: 'query', sql: "SELECT (SELECT count(*) FROM record_versions) AS versions,(SELECT value FROM local_settings WHERE key='hlc') AS hlc,(SELECT count(*) FROM change_log) AS changes" } });
  expect(result.ok(), await result.text()).toBe(true); return (await result.json()).value;
}
test('history preview and Back write nothing; explicit restore creates one version and record/global clear retain data', async ({ page }) => {
  test.setTimeout(60000); await page.setViewportSize({ width: 390, height: 844 });
  const scope = await seed(page), before = await snapshot(page);
  await page.getByRole('button', { name: 'История записи', exact: true }).click();
  await expect(page.locator('.history-versions button')).toHaveCount(2);
  await page.locator(`[data-version-id="${scope.first_version_id}"]`).click();
  await expect(page.getByRole('region', { name: 'Состояние версии', exact: true })).toContainText('Первая редакция');
  await expect(page.locator('.history-snapshot dt').filter({ hasText: /^Текст снимка$/ })).toHaveCount(1);
  await expect(page.locator('.history-snapshot')).toContainText('Коллекция: Редакции');
  await expect(page.locator('.history-snapshot')).toContainText('Конец полного снимка **без усечения**');
  await expect(page.locator('.history-snapshot script')).toHaveCount(0);
  // Re-selecting the same version keeps its field labels and hidden unknown values.
  await page.locator(`[data-version-id="${scope.first_version_id}"]`).click();
  await expect(page.locator('.history-snapshot dt').filter({ hasText: /^Название$/ })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.history-snapshot details')).not.toHaveAttribute('open');
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('.detail #record-title')).toHaveText('Вторая редакция');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'История записи', exact: true }).click();
  await page.locator(`[data-version-id="${scope.first_version_id}"]`).click();
  await page.getByRole('button', { name: 'Восстановить эту версию', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(page.locator('.detail #record-title')).toHaveText('Первая редакция');
  const restored = await snapshot(page); expect(restored[0].versions).toBe(before[0].versions + 1);
  await page.getByRole('button', { name: 'История записи', exact: true }).click();
  await expect(page.locator('.history-versions button')).toHaveCount(3);
  await page.getByRole('button', { name: 'Очистить историю записи', exact: true }).click();
  await page.locator('[data-editor]').getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await snapshot(page)).toEqual(restored);
  await page.getByRole('button', { name: 'Очистить историю записи', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить очистку истории', exact: true }).click();
  await expect(page.getByText('Сохранённых версий нет.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.detail #record-title')).toHaveText('Первая редакция');
  await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click();
  await page.locator('#constructor-toggle').click();
  await page.getByRole('button', { name: 'Очистить всю историю', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить очистку истории', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: `Открыть библиотеку «${scope.library_name}»`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Редакции»', exact: true }).click();
  await page.locator('.entry').filter({ hasText: 'Другая запись' }).click();
  await page.getByRole('button', { name: 'История записи', exact: true }).click();
  await expect(page.getByText('Сохранённых версий нет.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a stale restore keeps the preview and requires refreshing the current record before an explicit retry', async ({ page }) => {
  const scope = await seed(page);
  await page.getByRole('button', { name: 'История записи', exact: true }).click();
  await page.locator(`[data-version-id="${scope.first_version_id}"]`).click();
  const concurrent = await page.request.post('/__test-sqlite', { data: { op: 'history-concurrent-edit', params: [scope.record_id] } });
  expect(concurrent.ok(), await concurrent.text()).toBe(true);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Восстановить эту версию', exact: true }).click();
  await expect(page.locator('[data-editor] [role=alert]')).toContainText('Запись изменилась');
  await expect(page.locator('.history-snapshot')).toContainText('Первая редакция');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Обновить историю и запись', exact: true }).click();
  await expect(page.locator('.history-versions button')).toHaveCount(3);
  await expect(page.locator('.history-snapshot')).toContainText('Конкурентная правка');
  await page.locator(`[data-version-id="${scope.first_version_id}"]`).click();
  await page.getByRole('button', { name: 'Восстановить эту версию', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(page.locator('.detail #record-title')).toHaveText('Первая редакция');
  expect((await snapshot(page))[0].versions).toBe(before[0].versions + 1);
});
