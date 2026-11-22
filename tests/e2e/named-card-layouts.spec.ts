import { test, expect } from '../support/e2e-test';
import { openConstructor, showList } from '../support/ui-actions';

test('named record layouts are view-specific and leave shared record history untouched', async ({ page }) => {
  test.setTimeout(90000);
  const seed = await page.request.post('/__test-sqlite', { data: { op: 'profiles-seed' } });
  expect(seed.ok(), await seed.text()).toBe(true);
  const libraryId = (await seed.json()).value as string;
  const snapshot = async (table: string) => {
    const res = await page.request.post('/__test-sqlite', { data: {
      op: 'query', sql: `SELECT r.* FROM ${table} r JOIN records e ON e.id=${table === 'records' ? 'r.id' : 'r.record_id'} JOIN collections c ON c.id=e.collection_id WHERE c.library_id=? ORDER BY r.id`,
      params: [libraryId],
    } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).value as unknown;
  };
  const before = await snapshot('records');
  const history = await snapshot('record_versions');
  await page.goto('/');
  await page.getByRole('button', { name: 'Заметки: профили (dev/CI)', exact: true }).click();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await openConstructor(page);
  await page.getByRole('button', { name: 'Макеты записи', exact: true }).click();
  await page.getByRole('textbox', { name: 'Новый именованный макет', exact: true }).fill('Компактный');
  await page.getByRole('button', { name: 'Создать копию макета', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Макет подробной записи', exact: true })).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Редактировать макет', exact: true }).click();
  await page.locator('.hybrid-field-palette').getByRole('button', { name: /^Текст/ }).click();
  await page.getByRole('group', { name: 'Текст', exact: true }).getByRole('checkbox', { name: 'Показывать' }).uncheck();
  await page.getByRole('button', { name: 'Сохранить настройку', exact: true }).click();
  await page.locator('.named-card-editor > .form-actions').getByRole('button', { name: 'Сохранить настройку' }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await openConstructor(page); await page.getByRole('button', { name: 'Представления', exact: true }).click();
  await page.getByRole('combobox', { name: 'Настраиваемое представление' }).selectOption({ label: 'Только Бета' });
  await page.getByRole('combobox', { name: 'Макет подробной записи для представления' }).selectOption({ label: 'Компактный' });
  const saveProfile = page.getByRole('button', { name: 'Сохранить представление', exact: true });
  await saveProfile.click();
  // Saving a profile intentionally keeps the editor open; wait for Repository reload
  // before triggering Escape, which is ignored while a write is in flight.
  await expect(saveProfile).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Макет подробной записи для представления' })).toHaveValue(/.+/);
  await page.locator('[data-editor]').press('Escape');
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Готово, к данным' }).click();
  const profile = page.getByRole('combobox', { name: 'Представление', exact: true });
  await profile.selectOption({ label: 'Только Бета' });
  await page.locator('.entry').first().click();
  await expect(page.locator('.detail')).toContainText('Бета');
  await expect(page.locator('.detail')).not.toContainText('Вторая заметка');
  await showList(page);
  await profile.selectOption({ label: 'Все' });
  await page.locator('.entry').first().click();
  await expect(page.locator('.detail')).toContainText('Длинный текст первой заметки');
  expect(await snapshot('records')).toEqual(before);
  expect(await snapshot('record_versions')).toEqual(history);
});
