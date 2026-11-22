import { test, expect } from '../support/e2e-test';
import { openConstructor } from '../support/ui-actions';

test('Hybrid canvas previews changes and undo/redo without writing records', async ({ page }) => {
  test.setTimeout(90000);
  const seed = await page.request.post('/__test-sqlite', { data: { op: 'layout-seed' } });
  expect(seed.ok(), await seed.text()).toBe(true);
  const scope = (await seed.json()).value as { collection_id: string; body: string };
  const snapshot = async () => {
    const result = await page.request.post('/__test-sqlite', { data: {
      op: 'query', sql: "SELECT config FROM ui_configs WHERE collection_id=? AND kind='card'",
      params: [scope.collection_id],
    } });
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).value;
  };
  const original = await snapshot();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Заметки: строки (dev/CI)', exact: true }).click();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await openConstructor(page);
  await page.getByRole('button', { name: 'Карточка', exact: true }).click();
  await expect(page.locator('.hybrid-designer')).toBeVisible();
  await expect(page.locator('.hybrid-palette')).toBeVisible();
  await expect(page.locator('.hybrid-canvas-column')).toBeVisible();
  await expect(page.locator('.hybrid-inspector')).toBeVisible();
  await page.getByRole('button', { name: 'Телефон', exact: true }).click();
  await expect(page.locator('.hybrid-preview-phone')).toBeVisible();
  await page.getByRole('button', { name: 'Планшет', exact: true }).click();
  await expect(page.locator('.hybrid-preview-tablet')).toBeVisible();
  await page.locator('.hybrid-field-palette').getByRole('button', { name: /^Текст/ }).click();
  await expect(page.locator(`[data-preview-field="${scope.body}"]`)).toBeVisible();
  await page.getByRole('group', { name: 'Текст', exact: true }).getByRole('checkbox', { name: 'Показывать' }).uncheck();
  await expect(page.locator(`[data-preview-field="${scope.body}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: '↶ Отменить' }).click();
  await expect(page.locator(`[data-preview-field="${scope.body}"]`)).toBeVisible();
  await page.getByRole('button', { name: '↷ Повторить' }).click();
  await expect(page.locator(`[data-preview-field="${scope.body}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  expect(await snapshot()).toEqual(original);
});
