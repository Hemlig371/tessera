import { expect, type Page } from '@playwright/test';

export async function showList(page: Page) {
  const back = page.getByRole('button', { name: /^(К списку|Back to list)$/ });
  if (await back.isVisible()) await back.click();
}
export async function openConstructor(page: Page) {
  await showList(page);
  const button = page.getByRole('button', { name: 'Конструктор', exact: true });
  await expect(button).toBeEnabled();
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
export async function openQuickCreation(page: Page) {
  await showList(page);
  await page.getByRole('button', { name: 'Варианты создания', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Быстрая запись', exact: true }).click();
}
