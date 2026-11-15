import { expect, type Page } from '@playwright/test';

export async function openConstructor(page: Page) {
  const button = page.getByRole('button', { name: 'Конструктор', exact: true });
  await expect(button).toBeEnabled();
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
export async function openQuickCreation(page: Page) {
  await page.getByRole('button', { name: 'Варианты создания', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Быстрая запись', exact: true }).click();
}
