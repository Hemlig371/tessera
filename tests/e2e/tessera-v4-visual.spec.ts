import { expect, test } from '../support/e2e-test';

test('Tessera v4 visual contract: adaptive libraries, collection and record form', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-catalog="libraries"]')).toBeVisible();
  const fixture = await page.request.post('/__test-sqlite', { data: { op: 'navigation-seed', params: ['Tessera v4 · UI QA'] } });
  expect(fixture.ok(), await fixture.text()).toBe(true);
  await page.reload();
  await expect(page.locator('[data-catalog="libraries"] .catalog-item').first()).toBeVisible();
  await expect(page.locator('.tessera-bottom-nav')).toBeVisible();
  await page.screenshot({ path: 'test-results/tessera-v4-libraries-phone.png', fullPage: true });
  await page.getByRole('button', { name: 'Открыть библиотеку «Tessera v4 · UI QA»' }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Материалы»' }).click();
  await expect(page.locator('.entry').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/tessera-v4-collection-phone.png', fullPage: true });
  await page.locator('.entry').first().click();
  await expect(page.locator('.tessera-record-topline')).toBeVisible();
  await expect(page.locator('.detail #record-title')).toBeVisible();
  await page.screenshot({ path: 'test-results/tessera-v4-record-phone.png', fullPage: true });
  await page.locator('.detail').getByRole('button', { name: 'Редактировать' }).click();
  await expect(page.locator('[data-editor] .hybrid-record-form')).toBeVisible();
  await page.screenshot({ path: 'test-results/tessera-v4-editor-phone.png', fullPage: true });
  await page.locator('.hybrid-record-form').getByRole('button', { name: 'Отмена' }).click();
  await expect(page.locator('.detail')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('aside.sidebar')).toBeVisible();
  await page.screenshot({ path: 'test-results/tessera-v4-record-desktop.png', fullPage: true });
  for (const width of [320, 390, 760, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const measure = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      protruding: [...document.querySelectorAll('body *')].map(element => ({
        tag: element.tagName.toLowerCase(),
        cls: element.getAttribute('class')?.slice(0,90) ?? '',
        right: Math.round(element.getBoundingClientRect().right),
      })).filter(item => item.right > window.innerWidth + 1).slice(0,8),
    }));
    expect(measure.scrollWidth, JSON.stringify(measure)).toBeLessThanOrEqual(measure.viewport);
  }
});
