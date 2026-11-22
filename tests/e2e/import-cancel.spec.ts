import { showList } from '../support/ui-actions';
import { test, expect } from '../support/e2e-test';

test('CSV progress remains interactive; cancel rolls back, then the same checked file can be imported', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/'); await expect(page.locator('aside')).toBeVisible();
  await page.getByRole('button', { name: 'Создать библиотеку', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название библиотеки' }).fill('CSV cancellation');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: 'Создать коллекцию', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название коллекции' }).fill('Import');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const query = async (sql: string) => (await (await page.request.post('/__test-sqlite', { data: { op: 'query', sql } })).json()).value as unknown;
  await showList(page); await page.getByRole('button', { name: 'CSV', exact: true }).click();
  await page.getByLabel('Файл CSV', { exact: true }).setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.from('Название\n'+Array.from({ length: 5000 }, (_, index) => 'Импорт '+index).join('\n')) });
  await expect(page.getByRole('status')).toHaveText('Прочитано строк: 5000');
  await page.getByRole('button', { name: 'Проверить и показать предосмотр' }).click();
  await expect(page.getByRole('status')).toHaveText('Проверено строк: 5000. Показаны первые десять.');
  const before = await query('SELECT count(*) AS records,(SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log) AS changes FROM records');
  await page.getByRole('button', { name: 'Подтвердить импорт' }).click();
  await expect(page.getByRole('status')).toContainText(/Обработано записей: [1-9]/);
  await page.getByRole('button', { name: 'Отменить операцию CSV' }).click();
  await expect(page.getByRole('status')).toHaveText('Операция отменена. Данные базы не изменены.');
  expect(await query('SELECT count(*) AS records,(SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log) AS changes FROM records')).toEqual(before);
  await page.getByRole('button', { name: 'Подтвердить импорт' }).click();
  await expect(page.getByRole('status')).toHaveText('Импортировано записей: 5000', { timeout: 30000 });
  const [old] = before as { records: number; versions: number; changes: number }[];
  expect(await query('SELECT count(*) AS records,(SELECT count(*) FROM record_versions) AS versions FROM records')).toEqual([{ records: old!.records+5000, versions: old!.versions+5000 }]);
});
