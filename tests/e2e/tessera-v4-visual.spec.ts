import { expect, test } from '../support/e2e-test';

test('reference libraries, recipes and project can be read and edited across window sizes', async ({ page }) => {
  test.setTimeout(150000);
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
  await page.screenshot({path:'test-results/tessera-v4-editor-phone.png'});
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
  await page.screenshot({path:'test-results/tessera-v4-project-phone.png'});
  await task.check();
  await expect(task).toBeChecked();
});
