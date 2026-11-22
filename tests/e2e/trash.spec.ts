import { expect, test, type Page } from '../support/e2e-test';
import { nextHlc } from '../../src/core/hlc';
type Scope = { library_id: string; library_name: string; record_id: string; collection_id: string };
async function seed(page: Page): Promise<Scope> {
  const response = await page.request.post('/__test-sqlite', { data: { op: 'history-seed' } });
  expect(response.ok(), await response.text()).toBe(true); return (await response.json()).value;
}
async function openRecord(page: Page, scope: Scope) {
  await page.getByRole('button', { name: `Открыть библиотеку «${scope.library_name}»`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Редакции»', exact: true }).click();
  await page.locator('.entry').filter({ hasText: 'Вторая редакция' }).click();
}
async function trash(page: Page) {
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await expect(page.locator('[data-trash]')).toBeVisible();
  // A transient zero count is not enough: cleanTrash()/revision can start another
  // read immediately after opening the editor. Wait for actual settled data.
  await expect(page.locator('[data-trash]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeEnabled();
}
async function rows(page: Page, sql: string) {
  const response = await page.request.post('/__test-sqlite', { data: { op: 'query', sql } });
  expect(response.ok(), await response.text()).toBe(true); return (await response.json()).value;
}
test('mobile shared Trash filters libraries, restores, confirms purge, persists retention and returns to the prior section', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const first = await seed(page), second = await seed(page); await page.reload();
  for (const scope of [first, second]) {
    await openRecord(page, scope); await page.locator('.detail').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.locator('.detail')).toHaveCount(0);
    await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click();
  }
  const before = await rows(page, 'SELECT count(*) AS n FROM record_versions');
  await trash(page);
  await page.getByLabel('Библиотека в корзине', { exact: true }).selectOption(first.library_id);
  await expect(page.locator('.trash-list > li')).toHaveCount(1);
  await page.locator('.trash-list').getByRole('button', { name: 'Восстановить', exact: true }).click();
  await expect(page.getByText('Корзина пуста.', { exact: true })).toBeVisible();
  expect(await rows(page, 'SELECT count(*) AS n FROM record_versions')).toEqual(before);
  await page.getByLabel('Библиотека в корзине', { exact: true }).selectOption(second.library_id);
  await expect(page.locator('.trash-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Удалить окончательно', exact: true }).click();
  await page.getByRole('region', { name: 'Подтвердить окончательное удаление', exact: true }).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.trash-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Удалить окончательно', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить окончательное удаление', exact: true }).click();
  await expect(page.getByText('Корзина пуста.', { exact: true })).toBeVisible();
  expect(await rows(page, `SELECT purged,data FROM records WHERE id='${second.record_id}'`)).toEqual([{ purged: 1, data: '{}' }]);
  await page.getByLabel('Срок хранения в корзине', { exact: true }).selectOption('forever');
  await page.getByRole('button', { name: 'Сохранить срок хранения', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить срок хранения', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Срок хранения в корзине', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await page.reload(); await trash(page);
  await expect(page.getByLabel('Срок хранения в корзине', { exact: true })).toHaveValue('forever');
  await expect(page.locator('[data-trash]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await openRecord(page, first);
  await expect(page.locator('.detail #record-title')).toHaveText('Вторая редакция');
});

test('expired records are purged on startup, a stale confirmation preserves concurrent changes', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const scope = await seed(page); await page.reload(); await openRecord(page, scope);
  await page.locator('.detail').getByRole('button', { name: 'Удалить', exact: true }).click();
  await trash(page); await page.getByLabel('Срок хранения в корзине', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: 'Сохранить срок хранения', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить срок хранения', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Срок хранения в корзине', exact: true })).toBeEnabled();
  const row = page.locator(`[data-trash-id="${scope.record_id}"]`);
  await row.getByRole('button', { name: 'Удалить окончательно', exact: true }).click();
  // A concurrent local/replica change invalidates the opened destructive confirmation.
  await rows(page, `UPDATE records SET hlc='${nextHlc(scope.record_id, 8e12)}' WHERE id='${scope.record_id}'`);
  await page.getByRole('button', { name: 'Подтвердить окончательное удаление', exact: true }).click();
  await expect(page.locator('[data-editor] [role=alert]')).toBeVisible();
  expect(await rows(page, `SELECT purged FROM records WHERE id='${scope.record_id}'`)).toEqual([{ purged: 0 }]);
  await rows(page, `UPDATE records SET deleted_at='2000-01-01T00:00:00.000Z' WHERE id='${scope.record_id}'`);
  await page.reload(); await trash(page);
  await expect(page.locator(`[data-trash-id="${scope.record_id}"]`)).toHaveCount(0);
  expect(await rows(page, `SELECT purged,data FROM records WHERE id='${scope.record_id}'`)).toEqual([{ purged: 1, data: '{}' }]);
});
