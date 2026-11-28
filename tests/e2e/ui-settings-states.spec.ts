import { openApplicationAction, goToLibraries } from '../support/ui-actions';
import { expect, test, type Page } from '../support/e2e-test';

async function holdFailure(page: Page, matches: (sql: string, params: unknown[]) => boolean) {
  let held = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__test-sqlite', async route => {
    const body = route.request().postDataJSON() as { sql?: string; params?: unknown[] };
    if (!held && body.sql && matches(body.sql, body.params ?? [])) {
      held = true; await gate;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'readFailure' }) });
    } else await route.continue();
  });
  return { held: () => held, release };
}

test('settings retry unread metadata, keep a loading profile distinct from a missing one, and leave cancelled values unchanged', async ({ page }) => {
  // Seed 250 navigation records before opening the renderer: its SQLite lease
  // must not compete with the test-only fixture writer on the same connection.
  // The normal UI/error/retry assertions below remain unchanged.
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.request.post('/__test-sqlite', { data: { op: 'navigation-seed', params: ['Загрузка настроек (dev/CI)'] } });
  expect(response.ok(), await response.text()).toBe(true);
  const scope = (await response.json()).value as { library_id: string; collection_id: string; profile_id: string };
  await page.goto('/');
  await expect(page.locator('[data-catalog=libraries]')).toBeVisible();
  await openApplicationAction(page, 'Оформление');
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark');
  await page.getByRole('combobox', { name: 'Размер текста', exact: true }).selectOption('1.5');
  await page.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть библиотеку «Загрузка настроек (dev/CI)»', exact: true }).click();
  await openApplicationAction(page, 'Конструктор');
  const openStart = () => page.getByRole('button', { name: 'Стартовый экран библиотеки', exact: true }).click();
  await openStart();
  await page.getByRole('combobox', { name: 'Стартовый экран библиотеки', exact: true }).selectOption('collection');
  await page.getByRole('combobox', { name: 'Выбранная коллекция', exact: true }).selectOption(scope.collection_id);
  await page.getByRole('combobox', { name: 'Представление', exact: true }).selectOption(scope.profile_id);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  const snapshot = async () => {
    const result = await page.request.post('/__test-sqlite', { data: { op: 'query', sql: `SELECT l.config,l.hlc,
      (SELECT value FROM app_meta WHERE key='attachment:limit') AS threshold,
      (SELECT value FROM local_settings WHERE key='hlc') AS clock,
      (SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log) AS changes
      FROM libraries l WHERE l.id=?`, params: [scope.library_id] } });
    expect(result.ok(), await result.text()).toBe(true); return (await result.json()).value;
  };
  const before = await snapshot();
  const navigation = await holdFailure(page, (sql, params) => sql.includes('SELECT c.* FROM collections c JOIN libraries') && params[0] === scope.library_id);
  try {
    await openStart(); await expect.poll(navigation.held).toBe(true);
    await expect(page.getByText('Загружаем настройки…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
    navigation.release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить настройки старта');
    await page.screenshot({ path: 'test-results/library-start-error-phone.png', fullPage: true });
    expect(await snapshot()).toEqual(before);
  } finally { navigation.release(); }
  const profiles = await holdFailure(page, (sql, params) => sql.startsWith('SELECT * FROM display_profiles WHERE collection_id=') && params[0] === scope.collection_id);
  try {
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect.poll(profiles.held).toBe(true);
    const profile = page.getByRole('combobox', { name: 'Представление', exact: true });
    await expect(profile).toBeDisabled(); await expect(profile.locator('option:checked')).toHaveText('Загружаем представления…');
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Каталог коллекций', exact: true }).selectOption('list');
    await page.screenshot({ path: 'test-results/library-profiles-loading-phone.png', fullPage: true });
    profiles.release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить настройки старта');
    await expect(profile.locator('option:checked')).toHaveText('Представления не загружены');
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(profile).toBeEnabled(); await expect(profile).toHaveValue(scope.profile_id);
    await expect(profile.locator('option:checked')).toHaveText('Стартовый профиль');
    await expect(page.getByRole('combobox', { name: 'Каталог коллекций', exact: true })).toHaveValue('list');
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.locator('[data-editor]')).toHaveCount(0); expect(await snapshot()).toEqual(before);
  } finally { profiles.release(); }
  await goToLibraries(page);
  await openApplicationAction(page, 'Настройки');
  const files = await holdFailure(page, sql => sql === "SELECT value FROM app_meta WHERE key='attachment:limit'");
  try {
    await page.getByRole('button', { name: 'Настройки вложений', exact: true }).click(); await expect.poll(files.held).toBe(true);
    const limit = page.getByRole('spinbutton', { name: 'Порог полного переноса вложения, МиБ', exact: true });
    await expect(limit).toBeDisabled(); await expect(page.getByText('Загружаем настройки…', { exact: true })).toBeVisible();
    files.release();
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить настройки вложений');
    await expect(limit).toBeDisabled(); await expect(limit).toHaveValue('');
    await page.screenshot({ path: 'test-results/file-settings-error-phone.png', fullPage: true });
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(limit).toBeEnabled(); expect(await limit.inputValue()).not.toBe('');
    await limit.fill(''); await expect(limit).toBeEnabled();
    await expect(page.getByText('Загружаем настройки…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сохранить настройки вложений', exact: true })).toBeDisabled();
    await limit.fill('2.5'); await expect(page.getByRole('button', { name: 'Сохранить настройки вложений', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.locator('[data-editor]').getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await page.locator('[data-editor] .editor-heading button').click();
    await expect(page.locator('[data-editor]')).toHaveCount(0); expect(await snapshot()).toEqual(before);
  } finally { files.release(); }
  const protruding = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className).slice(0,12));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), protruding.join(', ')).toBe(true);
});
