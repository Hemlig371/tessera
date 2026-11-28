import { expect, test } from '../support/e2e-test';
import { goToLibraries, openApplicationAction, openConstructor } from '../support/ui-actions';

test('reference libraries, recipes and project can be read and edited across window sizes', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await page.evaluate(async () => {
    // Execute the image fixture inside Vite so attachment URLs and SQLite use the normal UI ports.
    const load = (path: string) => import(path);
    const {Repository} = await load('/src/core/repository.ts') as typeof import('../../src/core/repository');
    const {openDatabase} = await load('/tests/support/open-e2e.ts') as typeof import('../support/open-e2e');
    const {openBinaryFiles} = await load('/tests/support/binary-files-e2e.ts') as typeof import('../support/binary-files-e2e');
    const {seedReferenceExamples} = await load('/src/acceptance/reference-examples.ts') as typeof import('../../src/acceptance/reference-examples');
    const db = await openDatabase();
    try {
      const api = await Repository.open(db,openBinaryFiles());
      const nutrition = await api.createLibrary('Питание',{icon:'🍴',color:'#53875e'});
      const projects = await api.createLibrary('Проекты и задачи',{icon:'☑',color:'#7662a4'});
      for (const [name, icon, color] of [
        ['База знаний','▱','#477ea9'],['Заметки','✎','#9c743b'],['Личные финансы','▣','#528578'],
        ['Медиаархив','▧','#77609e'],['Контакты и события','♧','#527ba4'],['Каталог типов полей','⊞','#658547'],
      ] as const) await api.createLibrary(name,{icon,color});
      await seedReferenceExamples(api,nutrition.id,projects.id);
    } finally { await db.close(); }
  });
  await page.reload();
  const nutrition = page.getByRole('button',{name:'Открыть библиотеку «Питание»',exact:true});
  await expect(nutrition.locator('small')).toContainText('5');
  await page.screenshot({path:'test-results/tessera-v4-libraries-phone.png'});
  await nutrition.click();
  await expect(page.locator('.entry img').first()).toBeVisible();
  await page.screenshot({path:'test-results/tessera-v4-collection-phone.png'});
  await page.getByRole('button',{name:/Овсяная каша с ягодами/}).first().click();
  await expect(page.locator('.detail .tessera-record-cover')).toBeVisible();
  await page.screenshot({path:'test-results/tessera-v4-record-phone.png'});
  await page.getByRole('button',{name:'Редактировать',exact:true}).click();
  await expect(page.locator('.record-form')).toBeVisible();
  await page.screenshot({path:'test-results/tessera-v4-editor-phone.png',fullPage:true});
  await page.setViewportSize({width:1280,height:844});
  await page.screenshot({path:'test-results/tessera-v4-editor-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  for (const width of [320,390,760,800,1280]) {
    await page.setViewportSize({width,height:844});
    await expect(page.locator('.detail #record-title')).toHaveText('Овсяная каша с ягодами');
    await expect(page.locator('.split-record')).toHaveCount(width >= 780 ? 1 : 0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.screenshot({path:'test-results/tessera-v4-record-desktop.png'});
  await page.reload();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Открыть библиотеку «Проекты и задачи»'}).click();
  await page.getByRole('button',{name:/Обновление Tessera v4.0/}).first().click();
  await expect(page.locator('.detail .tessera-record-cover')).toBeVisible();
  const task = page.getByRole('checkbox',{name:'Тестирование'});
  await expect(task).not.toBeChecked();
  await expect(page.locator('.property-choice[data-tone=red]')).toHaveValue(/.+/);
  await expect(page.locator('.choice-values [data-initials=true]')).toHaveCount(2);
  await page.screenshot({path:'test-results/tessera-v4-project-phone.png', fullPage:true});
  await page.getByRole('button',{name:'Ещё',exact:true}).last().click();
  await page.getByRole('menuitem',{name:'История записи'}).click();
  await expect(page.locator('.history-versions')).toBeVisible();
  await page.screenshot({path:'test-results/tessera-v4-history-phone.png',fullPage:true});
  await page.locator('.editor-heading button').click();
  await task.check();
  await expect(task).toBeChecked();

  const button = (name: string) => page.getByRole('button', {name, exact:true});
  const close = async () => {
    await page.locator('.editor-heading button').click();
    await expect(page.locator('[data-editor]')).toHaveCount(0);
  };
  const take = async (name: string) => {
    for (const [size, width] of [['phone',390],['desktop',1280]] as const) {
      await page.setViewportSize({width,height:844});
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({path:`test-results/tessera-v4-${name}-${size}.png`,fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
  };

  await button('К списку').click();
  await button('К коллекциям').click();
  await expect(page.locator('[data-catalog=collections]')).toBeVisible();
  await take('catalog');
  await button('Открыть коллекцию «Обновления»').click();
  await button('Фильтры').click();
  await take('filters');
  await button('Фильтры').click();
  await button('+ Новая запись').click();
  await expect(page.locator('.record-form')).toBeVisible();
  const title = page.getByRole('textbox',{name:'Название',exact:true});
  await title.fill('Черновик для проверки');
  await take('create');
  await expect(title).toHaveValue('Черновик для проверки');
  await close();

  await openConstructor(page);
  await take('constructor');
  for (const [label, name] of [
    ['Настройки библиотеки','library-settings'],['Настройки коллекции','collection-settings'],
    ['Поля','fields'],['Представления','profiles'],['Карточка','card-layout'],
    ['Макеты записи','named-cards'],['Быстрая форма','quick-form'],['Пресеты создания','presets'],
  ]) {
    await button(label!).click();
    await expect(page.locator('[data-editor]')).toBeVisible();
    await take(name!);
    if (name === 'fields') {
      await page.locator('.field-list > div').filter({hasText:'Приоритет'}).getByRole('button').click();
      await expect(page.locator('.field-properties')).toBeVisible();
      await take('choice-editor');
      await page.keyboard.press('Escape');
      await button('+ Новое поле').click();
      await page.getByRole('combobox',{name:'Тип поля',exact:true}).selectOption('formula');
      await expect(page.locator('.formula-editor')).toBeVisible();
      await take('formula');
      await page.keyboard.press('Escape');
    }
    await close();
  }
  await button('Готово, к данным').click();
  await openApplicationAction(page,'CSV');
  await take('csv');
  await close();
  await openApplicationAction(page,'Входящие');
  await take('inbox');
  await openApplicationAction(page,'Корзина');
  await take('trash');
  await close();
  await goToLibraries(page);
  await openApplicationAction(page,'Настройки');
  await take('settings');
  await close();
  await button('Глобальный поиск').click();
  await take('search');
  await goToLibraries(page);
  await openApplicationAction(page,'Оформление');
  await page.getByRole('combobox',{name:'Тема',exact:true}).selectOption('dark');
  await button('Сохранить оформление').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await take('dark-libraries');
  await page.getByRole('button',{name:'Открыть библиотеку «Проекты и задачи»'}).click();
  await page.getByRole('button',{name:/Обновление Tessera v4.0/}).first().click();
  await expect(page.locator('.tessera-record-cover')).toBeVisible();
  await take('dark-project');
});
