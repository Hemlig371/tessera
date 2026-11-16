import { test, expect } from '@playwright/test';

test('record and editor pages keep list position, relation trail, unsaved edits and creation drafts', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await expect(page.locator('aside')).toBeVisible();
  await page.locator('.topbar').getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('combobox', { name: 'Плотность', exact: true }).selectOption('compact');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  // Restoration must also work in WebViews without browser scroll anchoring.
  await page.addStyleTag({ content: 'html { overflow-anchor: none; }' });
  let delayRelations = false;
  await page.route('**/__test-sqlite', async route => {
    const sql = (route.request().postDataJSON() as { sql?: string }).sql;
    if (delayRelations && sql?.includes('relation_index')) await new Promise(resolve => setTimeout(resolve, 250));
    await route.continue();
  });
  const seeded = await page.request.post('/__test-sqlite', { data: { op: 'knowledge-seed' } });
  expect(seeded.ok(), await seeded.text()).toBe(true);
  const scope = (await seeded.json()).value as { collection_id: string; first: string };
  const snapshot = async () => (await (await page.request.post('/__test-sqlite', { data: { op: 'query', sql: "SELECT r.id,r.hlc,r.data,(SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log) AS changes FROM records r WHERE r.collection_id=? ORDER BY r.id", params: [scope.collection_id] } })).json()).value as unknown;
  const before = await snapshot();
  await page.reload(); await page.getByRole('button', { name: 'База знаний (dev/CI)', exact: true }).click();
  await page.getByRole('button', { name: 'Материалы', exact: true }).click();
  const searched = page.waitForResponse(response => {
    if (!response.url().endsWith('/__test-sqlite')) return false;
    const request = response.request().postDataJSON() as { sql?: string } | null;
    return !!request?.sql?.includes('MATCH');
  });
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('ёж');
  await searched;
  await expect(page.locator('.entry').first()).toContainText('Материал 001');
  for (let i = 0; i < 2; i++) {
    const more = page.getByRole('button', { name: 'Показать ещё', exact: true });
    if (await more.isVisible()) await more.click();
  }
  await expect(page.getByText('Загружено записей: 250', { exact: true })).toBeVisible();
  const scroller = page.locator('.entry-scroll');
  const height = (await page.locator('.entry').first().boundingBox())!.height;
  await scroller.evaluate((element, top) => { element.scrollTop = top; }, height * 219);
  const entry = page.locator('.entry').filter({ hasText: 'Материал 220' });
  await expect(entry).toBeVisible();
  await entry.scrollIntoViewIfNeeded();
  const offset = await scroller.evaluate(element => element.scrollTop);
  const profile = await page.getByRole('combobox', { name: 'Представление', exact: true }).inputValue();
  await entry.click();
  await expect(page.getByRole('region', { name: 'Материал 220', exact: true })).toBeVisible();
  await expect(page.locator('.shade,[role=dialog],[aria-modal=true]')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Поиск', exact: true })).toHaveCount(0);
  await page.locator('.detail').getByRole('button', { name: /Материал 221/ }).click();
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 221');
  await page.locator('.detail').getByRole('button', { name: /Материал 220/ }).click();
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 220');
  for (const title of ['Материал 221','Материал 220']) {
    await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
    await expect(page.locator('.detail #record-title')).toHaveText(title);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('.detail')).toHaveCount(0);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(offset);
  await expect(entry).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Поиск', exact: true })).toHaveValue('ёж');
  await expect(page.getByRole('combobox', { name: 'Представление', exact: true })).toHaveValue(profile);
  await entry.click();
  const edit = page.locator('.detail').getByRole('button', { name: 'Редактировать', exact: true });
  await expect(page.locator('.detail .relation-block[aria-busy=true]')).toHaveCount(0);
  await expect.poll(() => page.locator('.detail .relation-row').evaluateAll(rows => rows.every(row => row.scrollHeight <= row.clientHeight))).toBe(true);
  await edit.focus(); const cardScroll = await page.evaluate(() => scrollY);
  // Capture the actual focused viewport; pointer auto-scrolling may move it
  // again between a pre-click measurement and activation on a tall card.
  await page.keyboard.press('Enter');
  const editor = page.getByRole('region', { name: 'Редактировать', exact: true });
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  // The page has an ordinary heading and document flow, with no modal layer.
  await expect(page.locator('[data-editor] h1')).toBeVisible();
  await expect(page.locator('.shade,[role=dialog],[aria-modal=true]')).toHaveCount(0);
  await page.locator('[data-editor]').getByRole('textbox', { name: 'Название', exact: true }).fill('Не сохранять');
  delayRelations = true;
  await page.locator('[data-editor]').getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 220');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(cardScroll);
  delayRelations = false;
  expect(await snapshot()).toEqual(before);
  await page.getByRole('button', { name: 'К списку', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await page.locator('[data-editor]').getByRole('textbox', { name: 'Название', exact: true }).fill('Страничный черновик');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(offset);
  expect(await snapshot()).toEqual(before);
  await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await expect(page.locator('[data-editor]').getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Страничный черновик');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
});
