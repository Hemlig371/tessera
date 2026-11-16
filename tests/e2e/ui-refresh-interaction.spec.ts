import { expect, test } from '@playwright/test';

test('retained rows become interactive after the refreshed range and browse position are ready', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const result = await page.request.post('/__test-sqlite', { data: { op: 'history-seed' } });
  expect(result.ok(), await result.text()).toBe(true);
  const scope = (await result.json()).value as { library_name: string };
  await page.reload();
  await page.getByRole('button', { name: `Открыть библиотеку «${scope.library_name}»`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Редакции»', exact: true }).click();
  const row = page.locator('.entry').filter({ hasText: 'Вторая редакция' });
  await expect(row).toBeEnabled();
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  let release!: () => void, pending!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { pending = resolve; });
  let hold = true;
  await page.route('**/__test-sqlite', async route => {
    const body = route.request().postDataJSON() as { op?: string; sql?: string };
    if (hold && body.op === 'query' && body.sql?.startsWith('SELECT r.*,c.name')) { pending(); await gate; }
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
    await expect(page.locator('[data-editor]')).toHaveCount(0);
    await requested;
    await expect(row).toBeVisible();
    await expect(row).toBeDisabled();
  } finally { hold = false; release(); }
  await expect(row).toBeEnabled();
  await row.click();
  await expect(page.locator('.detail #record-title')).toHaveText('Вторая редакция');
});
