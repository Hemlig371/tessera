import { openConstructor, showList } from '../support/ui-actions';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('mobile field builder, typed records, independent layouts, search and CSV roundtrip', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Библиотеки', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая библиотека', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название библиотеки' }).fill('Этап два');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая коллекция', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название коллекции' }).fill('Склад');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  async function addField(name: string, type: string) {
    await openConstructor(page); await page.getByRole('button', { name: 'Поля', exact: true }).click();
    await page.getByRole('button', { name: '+ Новое поле', exact: true }).click();
    await page.getByRole('textbox', { name: 'Название поля' }).fill(name);
    await page.getByRole('combobox', { name: 'Тип поля' }).selectOption(type);
    await page.getByRole('button', { name: 'Сохранить поле', exact: true }).click();
    await expect(
      page.locator('.field-list b').filter({ hasText: new RegExp('^' + name + '$') })
    ).toBeVisible();
    await page.locator('[data-editor]').getByRole('button', { name: 'Назад', exact: true }).click();
  }
  await addField('Описание', 'multiline');
  await addField('Остаток', 'integer');
  await addField('Готово', 'boolean');
  await addField('Дата', 'date');
  await openConstructor(page); await page.getByRole('button', { name: 'Форма', exact: true }).click();
  const formCount = page.getByRole('group', { name: 'Остаток', exact: true });
  await formCount.getByRole('checkbox', { name: 'Обязательное', exact: true }).check();
  await formCount.getByRole('checkbox', { name: 'Задать значение по умолчанию для формы' }).check();
  await formCount.getByRole('spinbutton', { name: 'Значение по умолчанию' }).fill('0');
  await page.getByRole('button', { name: 'Сохранить настройку' }).click();
  await showList(page); await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Остаток', exact: true })).toHaveValue('0');
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Красный блокнот');
  await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Строка\nВторая строка');
  await page.getByRole('combobox', { name: 'Готово', exact: true }).selectOption('false');
  await page.getByLabel('Дата', { exact: true }).fill('2024-02-29');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.entry')).toContainText('Красный блокнот');
  await openConstructor(page); await page.getByRole('button', { name: 'Карточка', exact: true }).click();
  await page
    .getByRole('group', { name: 'Описание', exact: true })
    .getByRole('checkbox', { name: 'Показывать' })
    .uncheck();
  await page.getByRole('button', { name: 'Сохранить настройку' }).click();
  await showList(page); await page.locator('.entry').click();
  await expect(page.locator('.detail')).not.toContainText('Вторая строка');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Описание', exact: true })).toHaveValue(
    'Строка\nВторая строка'
  );
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await showList(page); await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('КРАС');
  await expect(page.locator('.entry')).toHaveCount(1);
  await showList(page); await page.getByRole('combobox', { name: 'Где искать', exact: true }).selectOption('all');
  await expect(page.locator('.entry')).toContainText('Красный блокнот');
  await expect(page.locator('.entry')).toContainText('Склад');
  await showList(page); await page.getByRole('combobox', { name: 'Где искать', exact: true }).selectOption('collection');
  await showList(page); await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('несуществующее');
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await showList(page); await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('');
  await showList(page); await page.getByRole('button', { name: 'CSV', exact: true }).click();
  await page
    .getByLabel('Файл CSV', { exact: true })
    .setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Название;Остаток;Описание;Готово;Дата\nИмпорт;12;"Раз;два";нет;01.12.2026\n',
        'utf8'
      ),
    });
  await page.getByRole('button', { name: 'Проверить и показать предосмотр' }).click();
  await expect(page.getByRole('status')).toContainText('Проверено строк: 1');
  await page.getByRole('button', { name: 'Подтвердить импорт' }).click();
  await expect(page.getByRole('status')).toContainText('Импортировано записей: 1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить CSV', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('Красный блокнот');
  expect(csv).toContain('Импорт');
  expect(csv).toContain('"Раз;два"');
  await page.locator('[data-editor]').getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.locator('.entry')).toHaveCount(2);
  await showList(page); await page.locator('.entry').filter({ hasText: 'Импорт' }).click();
  await page.locator('.detail').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить удаление' }).click();
  await expect(page.locator('.entry')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/stage2-mobile.png', fullPage: true });
});

test('50,000 native SQLite records stay paged and virtualized in UI', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  // The seed endpoint owns a transaction; bootstrap must have released the WebView's transaction first.
  await expect(page.locator('aside')).toBeVisible();
  const response = await page.request.post('/__test-sqlite', { data: { op: 'scale' }, timeout: 150000 });
  expect(response.ok(), await response.text()).toBe(true);
  const result = await response.json();
  console.info('Browser scale fixture', result.value.importMs, result.value.queryMs);
  await page.reload();
  await page.getByRole('button', { name: 'Scale fixture', exact: true }).click();
  await page.getByRole('button', { name: '50K × 21', exact: true }).click();
  await expect(page.getByText('Загружено записей: 100', { exact: true })).toBeVisible();
  expect(await page.locator('.entry').count()).toBeLessThan(30);
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
  await expect(page.getByText('Загружено записей: 200', { exact: true })).toBeVisible();
  expect(await page.locator('.entry').count()).toBeLessThan(30);
  await showList(page); await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('метка49999');
  await expect(page.getByText('Загружено записей: 1', { exact: true })).toBeVisible();
  await expect(page.locator('.entry')).toContainText('Запись 49999');
});
