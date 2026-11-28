import { expect, test } from '../support/e2e-test';

test('explicit save refreshes the loaded deep range and restores search, profile, scroll and focus', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const library = 'База знаний: сохранение (dev/CI)';
  const seeded = await page.request.post('/__test-sqlite', { data: { op: 'knowledge-seed', params: [library] } });
  expect(seeded.ok(), await seeded.text()).toBe(true);
  const scope = (await seeded.json()).value as { collection_id: string; first: string };
  const versions = async () => (await (await page.request.post('/__test-sqlite', { data: { op: 'query', sql: 'SELECT count(*) AS n FROM record_versions WHERE record_id=?', params: [scope.first] } })).json()).value as { n: number }[];
  await page.reload(); await page.getByRole('button', { name: `Открыть библиотеку «${library}»`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Материалы»', exact: true }).click();
  const searched = page.waitForResponse(response => response.url().endsWith('/__test-sqlite') &&
    !!(response.request().postDataJSON() as { sql?: string })?.sql?.includes('MATCH'));
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('ёж'); await searched;
  await expect(page.locator('.entry').first()).toContainText('Материал 001');
  for (const count of [200, 250]) {
    await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await expect(page.getByText(`Загружено записей: ${count}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Загружено записей: 250', { exact: true })).toBeVisible();
  const scroller = page.locator('.entry-scroll'), height = (await page.locator('.entry').first().boundingBox())!.height;
  await scroller.evaluate((element, top) => { element.scrollTop = top; }, height * 219);
  const row = page.locator('.entry').filter({ hasText: 'Материал 220' }); await expect(row).toBeVisible();
  const offset = await scroller.evaluate(element => element.scrollTop);
  const activeProfile = page.getByRole('group', { name: 'Представление', exact: true }).getByRole('button', {pressed:true});
  const profile = await activeProfile.getAttribute('value');
  const before = await versions();
  await row.click(); await page.locator('.detail').getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.locator('[data-editor]').getByRole('combobox', { name: 'Прочитано', exact: true }).selectOption('true');
  await page.locator('[data-editor]').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 220');
  await page.getByRole('button', { name: 'К списку', exact: true }).click();
  await expect(page.getByText('Загружено записей: 250', { exact: true })).toBeVisible();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(offset);
  await expect(row).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Поиск', exact: true })).toHaveValue('ёж');
  await expect(activeProfile).toHaveAttribute('value', profile!);
  expect((await versions())[0]!.n).toBe(before[0]!.n + 1);
  await row.click(); await expect(page.locator('.detail').getByRole('checkbox', { name: 'Прочитано', exact: true })).toBeChecked();
});
