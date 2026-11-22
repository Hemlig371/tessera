import { expect, type Page } from '@playwright/test';

export async function showList(page: Page) {
  // Closing a form may still be flushing its draft and private file staging.
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  const back = page.getByRole('button', { name: /^(К списку|Back to list)$/ }).filter({ visible: true }).first();
  if (await back.isVisible()) await back.click();
  // Data screens and the library builder are separate destinations in v4.
  const toggle = page.locator('#constructor-toggle');
  if (await toggle.count() && await toggle.getAttribute('aria-pressed') === 'true') {
    await page.locator('.constructor-banner').getByRole('button', { name: 'Готово, к данным', exact: true }).click();
  }
}
/** Find a visible action, or use the approved compact topbar menu on phones. */
export async function openApplicationAction(page: Page, label: string) {
  const direct = page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first();
  if (await direct.isVisible()) { await direct.click(); return; }
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
export async function goToLibraries(page: Page) {
  // Constructor is an independent destination. Exit it before navigating
  // across libraries, as a person does via "Done, back to data".
  const builder = page.locator('#constructor-toggle');
  if (await builder.count() && await builder.getAttribute('aria-pressed') === 'true') {
    await expect(page.locator('[data-editor]')).toHaveCount(0);
    await page.locator('.constructor-banner').getByRole('button', { name: 'Готово, к данным', exact: true }).click();
  }
  const direct = page.getByRole('button', { name: /^(Все библиотеки|Перейти к каталогу библиотек)$/ }).filter({ visible: true }).first();
  if (await direct.isVisible()) { await direct.click(); return; }
  const back = page.getByRole('button', { name: 'К списку', exact: true }).filter({ visible: true }).first();
  if (await back.isVisible()) await back.click();
  await page.locator('.nav-toggle').filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Перейти к каталогу библиотек', exact: true }).filter({ visible: true }).first().click();
}
export async function openConstructor(page: Page) {
  const toggle = page.locator('#constructor-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', /^(true|false)$/);
  if (await toggle.getAttribute('aria-pressed') !== 'true') {
    await showList(page);
    await openApplicationAction(page, 'Конструктор');
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}
export async function openQuickCreation(page: Page) {
  await showList(page);
  await page.getByRole('button', { name: 'Варианты создания', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Быстрая запись', exact: true }).click();
}

export async function captureToInbox(page: Page, language: 'ru' | 'en' = 'ru') {
  await openApplicationAction(page, language === 'ru' ? '+ Во входящие' : '+ Capture to inbox');
}
export async function expectInboxCaptureReachable(page: Page, language: string = 'ru') {
  const label = language === 'ru' ? '+ Во входящие' : '+ Capture to inbox';
  const direct = page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first();
  if (await direct.isVisible()) { await expect(direct).toBeInViewport(); return; }
  const more = page.getByRole('button', { name: language === 'ru' ? 'Ещё' : 'More options', exact: true });
  await expect(more).toBeInViewport();
  await more.click();
  await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  await more.click();
}

export async function finishConstructor(page: Page) {
  const toggle = page.locator('#constructor-toggle');
  if (await toggle.getAttribute('aria-pressed') === 'true') {
    await expect(page.locator('[data-editor]')).toHaveCount(0);
    await page.locator('.constructor-banner').getByRole('button', { name: 'Готово, к данным', exact: true }).click();
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
}
