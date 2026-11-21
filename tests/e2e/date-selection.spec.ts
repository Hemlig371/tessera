import { test, expect } from '../support/e2e-test';
import { openConstructor } from '../support/ui-actions';

// M7: verify the previously quarantined date-filter path using current catalog labels.
test('profile date conditions persist and change the common record query', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '+ Во входящие', exact: true })).toBeVisible({ timeout: 30000 });
  const seed = await page.request.post('/__test-sqlite', { data: { op: 'profiles-seed' } });
  expect(seed.ok(), await seed.text()).toBe(true);
  const reopen = async () => {
    // Dispose the old test renderer before releasing its HTTP transaction lease.
    await page.goto('about:blank');
    const cleanup = await page.request.post('/__test-sqlite', { data: { op: 'renderer-cleanup' } });
    expect(cleanup.ok(), await cleanup.text()).toBe(true);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '+ Во входящие', exact: true })).toBeVisible({ timeout: 30000 });
  };
  const navigate = async () => {
    await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть библиотеку «Заметки: профили (dev/CI)»', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть коллекцию «Заметки»', exact: true }).click();
  };
  await reopen(); await navigate();
  await expect(page.locator('.entry')).toHaveCount(2);
  const edit = async () => {
    await openConstructor(page);
    await page.getByRole('button', { name: 'Список', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Период', exact: true })).toBeVisible();
  };
  const save = async () => {
    await page.getByRole('button', { name: 'Сохранить настройку', exact: true }).click();
    await expect(page.locator('[data-editor]')).toHaveCount(0);
  };
  await edit();
  await page.getByRole('combobox', { name: 'Период', exact: true }).selectOption('range');
  await page.getByRole('combobox', { name: 'Поле даты', exact: true }).selectOption({ label: 'Дата' });
  await page.getByLabel('С даты (включительно)', { exact: true }).fill('2026-11-16');
  await page.getByLabel('По дату (включительно)', { exact: true }).fill('2026-11-16');
  await save(); await expect(page.locator('.entry')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ничего не найдено', exact: true })).toBeVisible();
  await edit();
  await expect(page.getByRole('combobox', { name: 'Период', exact: true })).toHaveValue('range');
  await page.getByLabel('С даты (включительно)', { exact: true }).fill('2026-11-15');
  await page.getByLabel('По дату (включительно)', { exact: true }).fill('2026-11-15');
  await save(); await expect(page.locator('.entry')).toHaveCount(2);
  await edit();
  await page.getByRole('combobox', { name: 'Период', exact: true }).selectOption('today');
  await save();
  const profile = await page.getByRole('combobox', { name: 'Представление', exact: true }).inputValue();
  const response = await page.request.post('/__test-sqlite', { data: { op: 'query', sql: 'SELECT config FROM display_profiles WHERE id=?', params: [profile] } });
  expect(response.ok(), await response.text()).toBe(true);
  const saved = (await response.json()).value as { config: string }[];
  expect(JSON.parse(saved[0]!.config).list.date_selection).toEqual({ field_id: expect.any(String), period: 'today' });
  await reopen(); await navigate();
  await edit();
  await expect(page.getByRole('combobox', { name: 'Период', exact: true })).toHaveValue('today');
});
