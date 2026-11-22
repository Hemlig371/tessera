import { test, expect } from '../support/e2e-test';
import { openConstructor, openApplicationAction, showList } from '../support/ui-actions';

test('builder isolates schema tools, preserves collection context and uses back without touching records or drafts', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const mode = page.locator('#constructor-toggle');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Создать библиотеку', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название библиотеки' }).fill('Конструктор dev');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: 'Создать коллекцию', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название коллекции' }).fill('Записи');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Готово, к данным' }).click();
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  for (const name of ['Поля','Форма','Карточка','Список','Представления','Настройки коллекции','Пресеты создания']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await showList(page); await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Черновик конструктора');
  await page.locator('form').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  const snapshot = async () => (await (await page.request.post('/__test-sqlite', { data: { op: 'query', sql: "SELECT (SELECT count(*) FROM records) AS records,(SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log) AS changes,(SELECT value FROM local_settings WHERE key='hlc') AS hlc" } })).json()).value as unknown;
  const before = await snapshot();
  const profile = await page.getByRole('combobox', { name: 'Представление', exact: true }).inputValue();
  await showList(page); await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('контекст');
  await openConstructor(page);
  await expect(page.getByRole('heading', { name: 'Предпросмотр записей', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Поля', exact: true }).click();
  await expect(page.locator('.field-list')).toContainText('Название');
  // First back closes the editor; second exits the builder.
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('searchbox', { name: 'Поиск', exact: true })).toHaveValue('контекст');
  await expect(page.getByRole('combobox', { name: 'Представление', exact: true })).toHaveValue(profile);
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await showList(page); await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Черновик конструктора');
  await page.locator('form').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await page.reload(); await expect(mode).toHaveAttribute('aria-pressed', 'false');
});

test('field properties replace the phone list, cancel without writes and return focus through Escape and system Back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  const seeded = await page.request.post('/__test-sqlite', { data: { op: 'knowledge-seed', params: ['Свойства полей (dev/CI)'] } });
  expect(seeded.ok(), await seeded.text()).toBe(true);
  await page.reload();
  await openApplicationAction(page, 'Оформление');
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark');
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть библиотеку «Свойства полей (dev/CI)»', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть коллекцию «Материалы»', exact: true }).click();
  await openConstructor(page); await page.getByRole('button', { name: 'Поля', exact: true }).click();
  const snapshot = async () => {
    const response = await page.request.post('/__test-sqlite', { data: { op: 'query', sql: `SELECT
      (SELECT json_group_array(json_object('id',id,'name',name,'config',config,'hlc',hlc)) FROM fields) AS fields,
      (SELECT count(*) FROM records) AS records,(SELECT count(*) FROM record_versions) AS versions,
      (SELECT count(*) FROM change_log) AS changes,(SELECT value FROM local_settings WHERE key='hlc') AS hlc` } });
    expect(response.ok(), await response.text()).toBe(true); return (await response.json()).value;
  };
  const before = await snapshot(), edit = page.locator('.field-list button').last();
  await edit.focus(); const top = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  const properties = page.getByRole('form', { name: 'Свойства поля', exact: true });
  await expect(properties).toBeVisible();
  await expect(page.locator('.fields-master')).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название поля', exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('textbox', { name: 'Название поля', exact: true }).fill('Несохранённое имя');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(properties).toHaveCount(0); await expect(edit).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(top);
  expect(await snapshot()).toEqual(before);
  await page.keyboard.press('Enter'); await expect(properties).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(properties).toHaveCount(0); await expect(edit).toBeFocused();
  await page.keyboard.press('Enter'); await expect(properties).toBeVisible();
  await page.getByRole('button', { name: 'К списку полей', exact: true }).click();
  await expect(properties).toHaveCount(0); await expect(edit).toBeFocused();
  expect(await snapshot()).toEqual(before);
  await page.evaluate(() => window.dispatchEvent(new Event('tessera-back')));
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(page.locator('#constructor-toggle')).toHaveAttribute('aria-pressed', 'true');
});
