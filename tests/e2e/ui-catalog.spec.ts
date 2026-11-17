import { expect, test } from '@playwright/test';

test('catalog creation and global actions stay reachable with large text and after scrolling', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать библиотеку', exact: true }).click();
  await expect(page.locator('.topbar')).toBeHidden();
  const name = 'Каталог — длинное название библиотеки с материалами и планами ' + crypto.randomUUID().slice(0,8);
  await page.getByRole('textbox', { name: 'Название библиотеки', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть навигацию', exact: true }).click();
  await page.getByRole('button', { name: 'Создать коллекцию', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название коллекции', exact: true }).fill('Материалы каталога');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Все библиотеки', exact: true }).click();
  for (let i = 0; i < 6; i++) {
    const result = await page.request.post('/__test-sqlite', { data: { op: 'attachment-seed' } });
    expect(result.ok(), await result.text()).toBe(true);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--font-scale'))).toBe('1.5');
  for (const width of [320, 390, 760, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 760) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.getByRole('button', { name: '+ Во входящие', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Глобальный поиск', exact: true })).toBeInViewport();
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const library = page.getByRole('button', { name: `Открыть библиотеку «${name}»`, exact: true });
  await library.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Открыть коллекцию «Материалы каталога»', exact: true })).toBeVisible();
});
