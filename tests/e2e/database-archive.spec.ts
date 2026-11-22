import { expect, test, type Page } from '../support/e2e-test';
async function query(page: Page, sql: string, params: unknown[] = []) {
  const response = await page.request.post('/__test-sqlite', { data: { op: 'query', sql, params } }); expect(response.ok()).toBe(true);
  return (await response.json()).value as Record<string, string | number>[];
}
async function openArchiveSettings(page: Page) {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Архив базы данных', exact: true }).click();
}
test('offline ZIP export and verified replacement preserve data/files while fresh installation import gets a new identity', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/__test-archive', { data: { op: 'reset' } })).ok()).toBe(true);
  await page.goto('/'); await expect(page.getByTestId('database-welcome')).toBeVisible();
  await page.getByTestId('database-create').click(); await openArchiveSettings(page);
  await expect(page.getByTestId('archive-progress')).toHaveCount(0);
  const seedResponse = await page.request.post('/__test-archive', { data: { op: 'seed' } }); expect(seedResponse.ok()).toBe(true);
  const seed = (await seedResponse.json()).value as { id: string; hlc: string; attachment: string; device_id: string; dataset_id: string };
  await expect(page.getByTestId('archive-unencrypted')).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await page.getByTestId('archive-export').click();
  const archive = await downloadPromise; const path = (await archive.path())!;
  await expect(page.getByTestId('archive-exported')).toBeVisible();
  expect((await page.request.post('/__test-sqlite', { data: { op: 'stale-update', params: [seed.id, 'После экспорта'] } })).ok()).toBe(true);
  const before = (await query(page, 'SELECT data,hlc FROM records WHERE id=?', [seed.id]))[0]!;
  await page.getByTestId('archive-input').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByTestId('archive-prepare')).toBeDisabled();
  await page.getByTestId('archive-input').setInputFiles(path); await expect(page.getByTestId('archive-prepare')).toBeEnabled();
  await page.getByTestId('archive-prepare').click(); await expect(page.getByTestId('archive-ready')).toBeVisible();
  expect((await query(page, 'SELECT data,hlc FROM records WHERE id=?', [seed.id]))[0]).toEqual(before);
  await expect(page.getByTestId('archive-activate')).toBeDisabled(); await page.getByTestId('archive-replace-confirm').check();
  await page.getByTestId('archive-activate').click(); await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
  expect((await query(page, 'SELECT hlc FROM records WHERE id=?', [seed.id]))[0]!.hlc).toBe(seed.hlc);
  expect((await query(page, "SELECT value FROM app_meta WHERE key='dataset_id'"))[0]!.value).toBe(seed.dataset_id);
  const firstDevice = (await query(page, "SELECT value FROM local_settings WHERE key='device_id'"))[0]!.value;
  expect(firstDevice).not.toBe(seed.device_id);
  // A clean installation offers Import directly, with no second confirmation of nonexistent data.
  await openArchiveSettings(page); await expect(page.getByTestId('archive-progress')).toHaveCount(0);
  await page.goto('about:blank');
  expect((await page.request.post('http://127.0.0.1:1420/__test-archive', { data: { op: 'reset' } })).ok()).toBe(true);
  await page.goto('/'); await expect(page.getByTestId('database-welcome')).toBeVisible(); await page.getByTestId('database-import').click();
  await expect(page.getByTestId('archive-progress')).toHaveCount(0); await page.getByTestId('archive-input').setInputFiles(path);
  await page.getByTestId('archive-prepare').click(); await expect(page.getByTestId('archive-ready')).toBeVisible();
  await expect(page.getByTestId('archive-replace-confirm')).toHaveCount(0); await page.getByTestId('archive-activate').click();
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
  expect((await query(page, "SELECT value FROM local_settings WHERE key='device_id'"))[0]!.value).not.toBe(firstDevice);
  expect((await query(page, 'SELECT state FROM attachment_local WHERE id=?', [seed.attachment]))[0]!.state).toBe('present');
  const file = await page.request.post('/__test-sqlite', { data: { op: 'binary-read', file: { id: seed.attachment, offset: 0, length: 4 } } });
  expect(Buffer.from((await file.json()).value, 'base64')).toEqual(Buffer.from([0,255,17,99]));
});
