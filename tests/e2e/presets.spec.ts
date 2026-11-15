import { test, expect } from '@playwright/test';

test('creation choices, quick/standard presets and defaults respect one shared creation draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('button', { name: '+ Во входящие', exact: true })).toBeVisible();
  const request = async (data: object) => {
    const response = await page.request.post('/__test-sqlite', { data }); expect(response.ok(), await response.text()).toBe(true); return (await response.json()).value as unknown;
  };
  const scope = await request({ op: 'presets-seed' }) as { library_id: string; collection_id: string; preset_id: string };
  const records = () => request({ op: 'query', sql: 'SELECT * FROM records WHERE collection_id=?', params: [scope.collection_id] });
  const navigate = async () => {
    await page.getByRole('button', { name: 'Библиотеки', exact: true }).click();
    await page.getByRole('button', { name: 'Проекты и задачи (dev/CI)', exact: true }).click();
    await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  };
  await page.reload(); await navigate();
  const primary = page.getByRole('button', { name: '+ Новая запись', exact: true });
  const alternatives = page.getByRole('button', { name: 'Варианты создания', exact: true });
  await alternatives.click(); await page.getByRole('menuitem', { name: 'Новый баг', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Описание', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Черновик важнее пресета');
  expect(await records()).toEqual([]);
  await page.locator('form').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await alternatives.click(); await page.getByRole('menuitem', { name: 'Новый баг', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Описание', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Черновик важнее пресета');
  await expect(page.getByRole('spinbutton', { name: 'Приоритет', exact: true })).toHaveValue('0');
  await expect(page.getByRole('combobox', { name: 'Готово', exact: true })).toHaveValue('false');
  await expect(page.getByRole('textbox', { name: 'Тип', exact: true })).toHaveValue('Ошибка');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await records()).toHaveLength(1);
  await page.getByRole('button', { name: 'Пресеты создания', exact: true }).click();
  await page.getByRole('combobox', { name: 'Короткое нажатие +', exact: true }).selectOption({ label: 'Новый баг' });
  await page.getByRole('button', { name: 'Сохранить действие создания', exact: true }).click();
  await page.getByRole('dialog').press('Escape'); await page.reload(); await navigate();
  await primary.click(); await expect(page.getByRole('textbox', { name: 'Описание', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Назначенный пресет');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await records()).toHaveLength(2);
  // Context menu and touch hold expose alternatives without starting creation.
  await primary.click({ button: 'right' }); await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); await primary.press('Escape');
  const box = (await primary.boundingBox())!; await page.mouse.move(box.x+10, box.y+10); await page.mouse.down();
  await expect(page.getByRole('menu')).toBeVisible(); await page.mouse.up(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Обычная форма', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Тип', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Обычная');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await primary.focus(); await primary.press('ArrowDown'); await expect(page.getByRole('menu')).toBeVisible();
  await primary.press('Escape'); await primary.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Описание', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('С клавиатуры');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  // Build a new standard preset using the same generic field controls.
  await page.getByRole('button', { name: 'Пресеты создания', exact: true }).click();
  await page.getByRole('combobox', { name: 'Настраиваемый пресет' }).selectOption('new');
  await page.getByRole('textbox', { name: 'Название пресета', exact: true }).fill('Рабочая задача');
  const type = page.getByRole('group', { name: 'Тип', exact: true });
  await type.getByRole('checkbox', { name: 'Предзаполнять поле' }).check();
  await type.getByRole('textbox', { name: 'Тип', exact: true }).fill('Работа');
  await page.getByRole('button', { name: 'Сохранить пресет', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await alternatives.click(); await page.getByRole('menuitem', { name: 'Рабочая задача' }).click();
  await expect(page.getByRole('textbox', { name: 'Тип', exact: true })).toHaveValue('Работа');
  expect(await records()).toHaveLength(4);
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Пятая');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await records()).toHaveLength(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
