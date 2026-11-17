import { expect, test, type Page } from '../support/e2e-test';

async function seed(page: Page, name: string) {
  await page.goto('/'); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const result = await page.request.post('/__test-sqlite', { data: { op: 'navigation-seed', params: [name] } });
  expect(result.ok(), await result.text()).toBe(true);
  const scope = (await result.json()).value as { library_id: string; collection_id: string; profile_id: string };
  await page.reload(); return scope;
}
async function openLibrary(page: Page, name: string) {
  await page.getByRole('button', { name: `Открыть библиотеку «${name}»`, exact: true }).click();
}
async function settings(page: Page) {
  const toggle = page.locator('#constructor-toggle');
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Стартовый экран библиотеки', exact: true }).click();
  await expect(page.locator('[data-editor]')).toBeVisible();
}
async function finishSettings(page: Page) {
  await page.locator('[data-editor]').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.locator('#constructor-toggle').click();
  await expect(page.locator('#constructor-toggle')).toHaveAttribute('aria-pressed', 'false');
}
test('mobile catalogs, record Back, configured profile and deleted start fallback work without the drawer', async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 390, height: 844 });
  const name = 'Навигация: телефон (dev/CI)', scope = await seed(page, name);
  await expect(page.locator('aside')).toBeHidden();
  await openLibrary(page, name); await expect(page.locator('[data-catalog=collections]')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть коллекцию «Материалы»', exact: true }).click();
  await expect(page.locator('.entry').first()).toContainText('Материал 001');
  await page.getByRole('button', { name: 'Варианты создания', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.entry').first()).toContainText('Материал 001');
  await page.locator('.entry').first().click(); await expect(page.locator('.detail')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('.detail')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('[data-catalog=collections]')).toBeVisible();
  await settings(page);
  await page.getByRole('combobox', { name: 'Стартовый экран библиотеки', exact: true }).selectOption('collection');
  await page.getByRole('combobox', { name: 'Выбранная коллекция', exact: true }).selectOption(scope.collection_id);
  await page.getByRole('combobox', { name: 'Представление', exact: true }).selectOption(scope.profile_id);
  await page.getByRole('combobox', { name: 'Каталог коллекций', exact: true }).selectOption('list');
  await finishSettings(page);
  await expect(page.locator('[data-catalog=collections] .catalog-list')).toBeVisible();
  await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click();
  await openLibrary(page, name);
  await expect(page.getByRole('combobox', { name: 'Представление', exact: true })).toHaveValue(scope.profile_id);
  await page.reload(); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await openLibrary(page, name);
  await expect(page.getByRole('combobox', { name: 'Представление', exact: true })).toHaveValue(scope.profile_id);
  await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click();
  const deleted = await page.request.post('/__test-sqlite', { data: { op: 'navigation-delete-profile', params: [scope.profile_id] } });
  expect(deleted.ok(), await deleted.text()).toBe(true);
  await openLibrary(page, name);
  await expect(page.locator('[data-catalog=collections] .catalog-list')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть входящие', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Входящие', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'К библиотекам', exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('global search returns to the deep profile; last section and creation drafts survive restart independently', async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 1280, height: 900 });
  const name = 'Навигация: контекст (dev/CI)', scope = await seed(page, name);
  await openLibrary(page, name); await page.getByRole('button', { name: 'Открыть коллекцию «Материалы»', exact: true }).click();
  await page.getByRole('combobox', { name: 'Представление', exact: true }).selectOption(scope.profile_id);
  await expect(page.locator('.entry').first()).toContainText('Материал 001');
  for (const count of [200, 250]) {
    await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await expect(page.getByText(`Загружено записей: ${count}`, { exact: true })).toBeVisible();
  }
  const scroller = page.locator('.entry-scroll'), height = (await page.locator('.entry').first().boundingBox())!.height;
  await scroller.evaluate((element, top) => { element.scrollTop = top; }, height * 219);
  const offset = await scroller.evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: 'Глобальный поиск', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Все записи', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('Материал 221');
  await expect(page.locator('.entry').first()).toContainText('Материал 221');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByText('Загружено записей: 250', { exact: true })).toBeVisible();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(offset);
  await expect(page.getByRole('combobox', { name: 'Представление', exact: true })).toHaveValue(scope.profile_id);
  await page.locator('.entry').filter({ hasText: 'Материал 220' }).click();
  await page.locator('.detail').getByRole('button', { name: /Материал 221/ }).click();
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 221');
  await page.getByRole('button', { name: 'Глобальный поиск', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('Материал 010');
  await expect(page.locator('.entry').first()).toContainText('Материал 010');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 221');
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('.detail #record-title')).toHaveText('Материал 220');
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('.detail')).toHaveCount(0);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(offset);
  await settings(page);
  await page.getByRole('combobox', { name: 'Стартовый экран библиотеки', exact: true }).selectOption('last');
  await finishSettings(page);
  await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await page.locator('[data-editor]').getByRole('textbox', { name: 'Название', exact: true }).fill('Черновик навигации');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click(); await page.reload();
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await openLibrary(page, name);
  await expect(page.getByRole('combobox', { name: 'Представление', exact: true })).toHaveValue(scope.profile_id);
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await expect(page.locator('[data-editor]').getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Черновик навигации');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'К коллекциям', exact: true }).click();
  await expect(page.locator('[data-catalog=collections]')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await openLibrary(page, name); await expect(page.locator('[data-catalog=collections]')).toBeVisible();
});
