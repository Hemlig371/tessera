import { openConstructor, showList, goToLibraries } from '../support/ui-actions';
import { expect, test } from '../support/e2e-test';

test('mobile single/multiple relations, reverse card, linked creation, cancel and deleted targets', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать библиотеку', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название библиотеки' }).fill('Связи');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  async function navigate(name: string) {
    await goToLibraries(page);
    await page.getByRole('button', { name: `Открыть библиотеку «${name}»`, exact: true }).click();
  }
  async function newCollection(name: string) {
    await page.getByRole('button', { name: 'Создать коллекцию', exact: true }).click();
    await page.getByRole('textbox', { name: 'Название коллекции' }).fill(name);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
  }
  await newCollection('Проекты');
  await showList(page); await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Проект Tessera');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'К коллекциям', exact: true }).click();
  await newCollection('Задачи');
  async function field(name: string, type: string, selectLabel: string, option: string, multiple = false) {
    await openConstructor(page); await page.getByRole('button', { name: 'Поля', exact: true }).click();
    await page.getByRole('button', { name: '+ Новое поле', exact: true }).click();
    await page.getByRole('textbox', { name: 'Название поля' }).fill(name);
    await page.getByRole('combobox', { name: 'Тип поля' }).selectOption(type);
    await page.getByRole('combobox', { name: selectLabel, exact: true }).selectOption({ label: option });
    if (multiple) await page.getByRole('checkbox', { name: 'Несколько записей' }).check();
    await page.getByRole('button', { name: 'Сохранить поле', exact: true }).click();
    await expect(
      page.locator('.field-list b').filter({ hasText: new RegExp('^' + name + '$') })
    ).toBeVisible();
    await page.locator('[data-editor]').getByRole('button', { name: 'Назад', exact: true }).click();
  }
  await field('Проект', 'relation', 'Целевая коллекция', 'Проекты');
  await field('Рекомендации', 'relation', 'Целевая коллекция', 'Проекты', true);
  await showList(page); await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Задача разработки');
  await page
    .getByRole('group', { name: 'Проект', exact: true })
    .getByRole('button', { name: 'Проект Tessera', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Рекомендации', exact: true })
    .getByRole('button', { name: 'Проект Tessera', exact: true })
    .click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.entry')).toContainText('Проект Tessera');
  await navigate('Проекты');
  await field('Задачи проекта', 'backlink', 'Исходное поле связи', 'Задачи · Проект');
  await showList(page); await page.locator('.entry').click();
  const block = page.locator('.detail').getByLabel('Задачи проекта', { exact: true });
  await expect(block.getByRole('button', { name: /Задача разработки/ })).toBeVisible();
  await block.getByRole('button', { name: /Задача разработки/ }).click();
  await expect(page.locator('.detail #record-title')).toHaveText('Задача разработки');
  await page.getByRole('button', { name: 'Назад к записи', exact: true }).click();
  await expect(page.locator('.detail #record-title')).toHaveText('Проект Tessera');
  await block.getByRole('button', { name: 'Создать связанную запись', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Отмена связанной');
  await page.locator('form').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(block.getByRole('button', { name: /Отмена связанной/ })).toHaveCount(0);
  await block.getByRole('button', { name: 'Создать связанную запись', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Создана из проекта');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(block.getByRole('button', { name: /Создана из проекта/ })).toBeVisible();
  await page.locator('.detail').getByRole('button', { name: 'Удалить', exact: true }).click();
  await navigate('Задачи');
  await showList(page); await page.locator('.entry').filter({ hasText: 'Задача разработки' }).click();
  await expect(page.locator('.detail').getByLabel('Проект', { exact: true })).toContainText('Удалено');
  await page.locator('.detail').getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Ссылка сохранена');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.detail').getByLabel('Проект', { exact: true })).toContainText('Удалено');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/stage3-relations-mobile.png', fullPage: true });
});

test('relation target selector pages backwards and searches in SQLite', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible();
  const response = await page.request.post('/__test-sqlite', { data: { op: 'relation-page-seed' } });
  expect(response.ok(), await response.text()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Связи этапа 3', exact: true }).click();
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await showList(page); await page.getByRole('button', { name: '+ Новая запись', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Выбрана после страницы');
  const picker = page.getByRole('group', { name: 'Проект', exact: true });
  await expect(picker.locator('.relation-options button')).toHaveCount(50);
  await picker.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect(picker.locator('.relation-options button')).toHaveCount(2);
  await picker.getByRole('button', { name: 'Предыдущая страница', exact: true }).click();
  await expect(picker.locator('.relation-options button')).toHaveCount(50);
  await picker.getByRole('searchbox', { name: 'Поиск связанных записей', exact: true }).fill('Цель 50');
  await expect(picker.locator('.relation-options button')).toHaveCount(1);
  await picker.getByRole('searchbox',{name:'Поиск связанных записей',exact:true}).press('Enter');
  await expect(page.locator('[data-editor]').getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled();
  await picker.getByRole('button', { name: 'Цель 50', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.entry').filter({ hasText: 'Выбрана после страницы' })).toContainText('Цель 50');
});
