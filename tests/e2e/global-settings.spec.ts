import { expect, test } from '../support/e2e-test';

test('global settings open without choosing a library or enabling constructor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const constructor = page.locator('#constructor-toggle');
  await expect(constructor).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const editor = page.locator('[data-editor]');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Оформление' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Настройки вложений' })).toBeVisible();
  await editor.getByRole('button', { name: 'Оформление' }).click();
  await expect(page.getByRole('combobox', { name: 'Тема' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(constructor).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
