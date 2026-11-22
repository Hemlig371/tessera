import { captureToInbox } from '../support/ui-actions';
import { test, expect } from '../support/e2e-test';

test('capture waits for its own field metadata before constructing a draft session', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('aside')).toBeVisible();
  await page.getByRole('button', { name: '+ Новая библиотека', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название библиотеки' }).fill('Metadata isolation');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая коллекция', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название коллекции' }).fill('Other fields');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ Новая запись', exact: true })).toBeEnabled();
  const response = await page.request.post('/__test-sqlite', { data: { op: 'inbox-context' } });
  expect(response.ok()).toBe(true); const inbox = (await response.json()).value as { id: string };
  let delayed = 0;
  await page.route('**/__test-sqlite', async route => {
    const body = route.request().postDataJSON() as { op: string; sql?: string; params?: unknown[] };
    if (body.op === 'query' && body.sql?.includes('SELECT * FROM fields WHERE collection_id=') && body.params?.[0] === inbox.id) {
      const result = await route.fetch(); delayed++; await new Promise(resolve => setTimeout(resolve, 400)); await route.fulfill({ response: result });
    } else await route.continue();
  });
  await captureToInbox(page);
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  expect(delayed).toBeGreaterThan(0);
  await page.getByRole('textbox', { name: 'Содержимое', exact: true }).fill('Capture metadata draft 🦔');
  await page.locator('form').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0); await page.unrouteAll({ behavior: 'wait' });
  await captureToInbox(page);
  await expect(page.getByRole('textbox', { name: 'Содержимое', exact: true })).toHaveValue('Capture metadata draft 🦔');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.locator('[data-editor]')).toHaveCount(0);
});
