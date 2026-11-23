import { seedReferenceExamples } from './reference-examples';
import type { Repository } from '../core/repository';
import type { RecordData } from '../core/model';
import type { ByteSource } from '../core/attachments';
import { createNutritionFixture } from '../../tests/fixtures/nutrition';
import { createProjectsLibrary } from '../../tests/fixtures/projects';
import { createKnowledgeFixture } from '../../tests/fixtures/knowledge';
import { createNotesLibrary } from '../../tests/fixtures/notes';

// Only reachable from import.meta.env.MODE === 'qa' on an uninitialized, isolated database.
// Never seed a regular install, an imported database, or a previously initialized QA database.
export async function seedAcceptanceLibraries(api: Repository): Promise<void> {
  const nutrition = await createNutritionFixture(api, '01 · Питание (QA)');
  const extraProduct = await api.saveEntry(nutrition.products.id, {
    [nutrition.products.primary_field_id]: 'Яблоко',
    ...Object.fromEntries(nutrition.nutrients.map(n => [n.source.id, n.source.name.startsWith('Ккал') ? '52' : '0.2'])),
  });
  const lunch = await api.saveEntry(nutrition.meals.id, {
    [nutrition.meals.primary_field_id]: 'Обед', [nutrition.date.id]: '2026-11-22', [nutrition.time.id]: '13:15',
  });
  await api.saveEntry(nutrition.portions.id, {
    [nutrition.portions.primary_field_id]: 'Яблоко, 150 г',
    [nutrition.productRef.id]: extraProduct.id, [nutrition.mealRef.id]: lunch.id,
    [nutrition.grams.id]: '150', [nutrition.done.id]: false,
  });

  const projects = await createProjectsLibrary(api, '02 · Проекты и задачи (QA)');
  const project = await api.saveEntry(projects.projects.id, { [projects.projects.primary_field_id]: 'Релиз Tessera' });
  const choices = ['Запланировано', 'В работе', 'Готово'].map(label => ({ id: crypto.randomUUID(), label }));
  const stage = await api.createField(projects.tasks.id, 'Этап Kanban', 'select', { options: choices });
  const tasks = [];
  for (let n = 0; n < 10; n++) {
    const task = await api.saveEntry(projects.tasks.id, {
      [projects.tasks.primary_field_id]: 'Задача ' + String(n + 1).padStart(2, '0'),
      [projects.project.id]: project.id,
      [projects.status.id]: choices[n % 3]!.label,
      [stage.id]: choices[n % 3]!.id,
      [projects.priority.id]: n % 4,
      [projects.done.id]: n % 3 === 2,
      [projects.due.id]: '2026-12-' + String(n + 1).padStart(2, '0'),
      [projects.description.id]: '# Проверка\n\nИзмените этап, срок и приоритет.',
    });
    tasks.push(task);
  }
  await api.saveEntry(projects.tasks.id, { [projects.parent.id]: tasks[0]!.id }, tasks[1]!.id, tasks[1]!.hlc);
  const taskTitle = { field_id: projects.tasks.primary_field_id, visible: true };
  await api.createDisplayProfile(projects.tasks.id, 'Kanban', {
    fields: [taskTitle], list: { mode: 'kanban', mode_field: stage.id },
  });
  await api.createDisplayProfile(projects.tasks.id, 'Календарь', {
    fields: [taskTitle], list: { mode: 'calendar', mode_field: projects.due.id },
  });
  await api.createDisplayProfile(projects.tasks.id, 'Дерево', {
    fields: [taskTitle], list: { mode: 'tree', mode_field: projects.parent.id },
  });

  await createKnowledgeFixture(api, '03 · База знаний (QA)');
  const notes = await createNotesLibrary(api, '04 · Заметки (QA)', '2026-11-22');
  const topic = await api.saveEntry(notes.topics.id, { [notes.topics.primary_field_id]: 'Приёмка' });
  for (let n = 1; n <= 6; n++) await api.saveEntry(notes.notes.id, {
    [notes.notes.primary_field_id]: 'Заметка ' + n,
    [notes.body.id]: '# Тест Markdown ' + n + '\n\n**Жирный**, _курсив_, ёжик 🦔 и длинная строка.\n\n- список\n- пункт',
    [notes.topic.id]: topic.id, [notes.date.id]: '2026-11-22',
  });

  const finance = await api.createLibrary('05 · Личные финансы (QA)');
  const accounts = await api.createCollection(finance.id, 'Счета', 'Название');
  const categories = await api.createCollection(finance.id, 'Категории', 'Название');
  const operations = await api.createCollection(finance.id, 'Операции', 'Название');
  const account = await api.saveEntry(accounts.id, { [accounts.primary_field_id]: 'Тестовый счёт' });
  const category = await api.saveEntry(categories.id, { [categories.primary_field_id]: 'Тестовые расходы' });
  const amount = await api.createField(operations.id, 'Сумма, ₽', 'money', { currency: '₽', precision: 2, indexed: true });
  const date = await api.createField(operations.id, 'Дата', 'date');
  const accountRef = await api.createField(operations.id, 'Счёт', 'relation', { target_collection_id: accounts.id });
  const categoryRef = await api.createField(operations.id, 'Категория', 'relation', { target_collection_id: categories.id });
  const amounts = ['1000.00', '-100.50', '0.1', '0.2', '-20', '50', '0', '12.34'];
  for (let i = 0; i < amounts.length; i++) await api.saveEntry(operations.id, {
    [operations.primary_field_id]: 'Операция ' + (i + 1),
    [amount.id]: amounts[i]!, [date.id]: '2026-11-' + String(10 + i),
    [accountRef.id]: account.id, [categoryRef.id]: category.id,
  });
  await api.saveUiConfig(operations.id, 'list', {
    fields: [{ field_id: operations.primary_field_id, visible: true }, { field_id: amount.id, visible: true }],
    list: { mode: 'table', sort_field: date.id, direction: 'desc' },
    totals: [{ operation: 'sum', field_id: amount.id }, { operation: 'count' }],
  });

  const media = await api.createLibrary('06 · Медиаархив (QA)');
  const albums = await api.createCollection(media.id, 'Альбомы', 'Название');
  const materials = await api.createCollection(media.id, 'Материалы', 'Название');
  const album = await api.saveEntry(albums.id, { [albums.primary_field_id]: 'Примеры' });
  const albumRef = await api.createField(materials.id, 'Альбом', 'relation', { target_collection_id: albums.id });
  const image = await api.createField(materials.id, 'Фото', 'image', { multiple: true });
  const file = await api.createField(materials.id, 'Файлы', 'file', { multiple: true });
  const owner = crypto.randomUUID();
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSFcAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  const readme = new TextEncoder().encode('Tessera QA: тестовый документ для экспорта и восстановления.\n');
  const source = (bytes: Uint8Array, name: string, mime: string): ByteSource => ({
    name, mime, size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length),
  });
  const photo = await api.stageAttachment(materials.id, owner, source(png, 'qa-photo.png', 'image/png'));
  const document = await api.stageAttachment(materials.id, owner, source(readme, 'qa-document.txt', 'text/plain'));
  await api.saveNewEntry(materials.id, {
    [materials.primary_field_id]: 'Фото и документ · проверьте ZIP',
    [albumRef.id]: album.id, [image.id]: [photo.id], [file.id]: [document.id],
  }, owner);

  const contacts = await api.createLibrary('07 · Контакты и события (QA)');
  const people = await api.createCollection(contacts.id, 'Контакты', 'Имя');
  const events = await api.createCollection(contacts.id, 'События', 'Название');
  const phone = await api.createField(people.id, 'Телефон', 'phone');
  const email = await api.createField(people.id, 'Email', 'email');
  const address = await api.createField(people.id, 'Адрес', 'address');
  const person = await api.saveEntry(people.id, {
    [people.primary_field_id]: 'Анна Тестовая', [phone.id]: '+7 900 000-00-01',
    [email.id]: 'qa@example.org', [address.id]: 'Тестовая улица, 1',
  });
  const when = await api.createField(events.id, 'Дата', 'date');
  const time = await api.createField(events.id, 'Время', 'time');
  const personRef = await api.createField(events.id, 'Контакт', 'relation', { target_collection_id: people.id });
  for (let n = 1; n <= 3; n++) await api.saveEntry(events.id, {
    [events.primary_field_id]: 'Встреча ' + n, [when.id]: '2026-12-0' + n,
    [time.id]: '10:30', [personRef.id]: person.id,
  });
  await api.createDisplayProfile(events.id, 'Календарь', {
    fields: [{ field_id: events.primary_field_id, visible: true }],
    list: { mode: 'calendar', mode_field: when.id },
  });

  const catalog = await api.createLibrary('08 · Каталог типов полей (QA)');
  const values = await api.createCollection(catalog.id, 'Значения полей', 'Название');
  const linked = await api.createCollection(catalog.id, 'Связанные элементы', 'Название');
  const create = (name: string, type: string, config = {}) => api.createField(values.id, name, type, config);
  const text = await create('Текст', 'text');
  const multiline = await create('Многострочный', 'multiline');
  const markdown = await create('Markdown', 'markdown');
  const bool = await create('Boolean', 'boolean');
  const integer = await create('Integer', 'integer');
  const decimal = await create('Decimal', 'decimal', { precision: 3 });
  const money = await create('Money', 'money', { currency: '₽' });
  const firstChoice = crypto.randomUUID(), secondChoice = crypto.randomUUID();
  const options = [{ id: firstChoice, label: 'Первый' }, { id: secondChoice, label: 'Второй' }];
  const select = await create('Select', 'select', { options });
  const multiple = await create('Multiselect', 'multiselect', { options });
  const catalogDate = await create('Date', 'date');
  const catalogTime = await create('Time', 'time');
  const local = await create('Local datetime', 'local_datetime');
  const range = await create('Date range', 'date_range');
  const duration = await create('Duration', 'duration');
  const url = await create('URL', 'url');
  const catalogEmail = await create('Email', 'email');
  const catalogPhone = await create('Phone', 'phone');
  const barcode = await create('Barcode', 'barcode', { barcode_label: 'Тестовый код' });
  const secret = await create('Secret', 'secret');
  const catalogAddress = await create('Address', 'address');
  const coordinates = await create('Coordinates', 'coordinates');
  const color = await create('Color', 'color');
  const icon = await create('Icon', 'icon');
  const json = await create('JSON', 'json');
  await create('Формула ×2', 'formula', { formula: '[' + decimal.id + ']*2' });
  const relation = await create('Relation', 'relation', { target_collection_id: linked.id });
  const targetLink = await api.createField(linked.id, 'Значение', 'relation', { target_collection_id: values.id });
  const targetCount = await api.createField(linked.id, 'Количество', 'integer');
  const reverse = await create('Backlink', 'backlink', { source_field_id: targetLink.id });
  await create('Aggregate', 'aggregate', { formula: 'SUM([' + reverse.id + '].[' + targetCount.id + '])' });
  await create('File', 'file', { multiple: true });
  await create('Image', 'image', { multiple: true });
  const target = await api.saveEntry(linked.id, { [linked.primary_field_id]: 'Тестовая связь' });
  const data: RecordData = {
    [values.primary_field_id]: 'Все типы · пример',
    [text.id]: 'Русский текст / Unicode ёж', [multiline.id]: 'Первая строка\nВторая строка',
    [markdown.id]: '# Заголовок\n\n**Жирный** и _курсив_.',
    [bool.id]: false, [integer.id]: 0, [decimal.id]: '0.1', [money.id]: '123.45',
    [select.id]: firstChoice, [multiple.id]: [firstChoice, secondChoice],
    [catalogDate.id]: '2026-11-22', [catalogTime.id]: '09:45', [local.id]: '2026-11-22T09:45',
    [range.id]: { start: '2026-11-22', end: '2026-11-29' }, [duration.id]: '90.5',
    [url.id]: 'https://example.org/', [catalogEmail.id]: 'qa@example.org', [catalogPhone.id]: '+7 900 000-00-02',
    [barcode.id]: 'ABC-123', [secret.id]: 'QA_FAKE_NOT_A_PASSWORD',
    [catalogAddress.id]: 'Тестовая улица', [coordinates.id]: { latitude: '55.7558', longitude: '37.6173' },
    [color.id]: '#336699', [icon.id]: '★', [json.id]: { nested: [false, 0, 'ёж'] },
    [relation.id]: target.id,
  };
  const entry = await api.saveEntry(values.id, data);
  await api.saveEntry(linked.id, { [targetLink.id]: entry.id, [targetCount.id]: 7 }, target.id, target.hlc);
  // The secret field must never be visible in the collection list.
  await api.saveUiConfig(values.id, 'list', {
    fields: [{ field_id: values.primary_field_id, visible: true }, { field_id: decimal.id, visible: true },
      { field_id: secret.id, visible: false }],
    list: { mode: 'rows' },
  });
  await seedReferenceExamples(api, nutrition.library.id, projects.library.id);
}
