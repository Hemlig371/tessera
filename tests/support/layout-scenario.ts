import type { Repository } from '../../src/core/repository';
import type { UiDefinition } from '../../src/core/model';

/** Notes acceptance data, built entirely through the generic repository API. */
export async function layoutScenario(api: Repository) {
  const name = 'Заметки: строки (dev/CI)';
  let library = (await api.listLibraries()).find(item => item.name === name);
  const fresh = !library; library ??= await api.createLibrary(name);
  const collection = (await api.listCollections(library.id))[0] ?? await api.createCollection(library.id, 'Заметки', 'Название');
  if (fresh) {
    await api.createField(collection.id, 'Приоритет', 'integer', { default: 0 });
    await api.createField(collection.id, 'Избранное', 'boolean', { default: false });
    await api.createField(collection.id, 'Текст', 'markdown');
    await api.createField(collection.id, 'Дата', 'date');
  }
  const fields = await api.listFields(collection.id);
  const find = (label: string) => { const field = fields.find(item => item.name === label); if (!field) throw new Error('Incomplete layout fixture'); return field; };
  const primary = collection.primary_field_id, count = find('Приоритет').id, flag = find('Избранное').id, body = find('Текст').id, date = find('Дата').id;
  if (fresh) {
    const form: UiDefinition = { fields: fields.map(field => ({ field_id: field.id, visible: true, collapsed: [primary, date].includes(field.id) })), rows: [
      { id: primary, columns: 3, field_ids: [primary, count, flag], group: 'Основное' },
      { id: body, columns: 1, field_ids: [body], group: 'Текст' },
      { id: date, columns: 1, field_ids: [date], group: 'Служебное' },
    ] };
    const card: UiDefinition = { fields: fields.map(field => ({ field_id: field.id, visible: true })), rows: [
      { id: body, columns: 1, field_ids: [body], group: 'Чтение' },
      { id: primary, columns: 3, field_ids: [primary, count, flag] },
      { id: date, columns: 1, field_ids: [date] },
    ] };
    await api.saveUiConfig(collection.id, 'form', form); await api.saveUiConfig(collection.id, 'card', card);
    await api.saveQuickForm(collection.id, { fields: fields.map(field => ({ field_id: field.id, visible: field.id === primary || field.id === body })),
      rows: [{ id: primary, columns: 2, field_ids: [primary, body] }] });
    await api.saveEntry(collection.id, { [primary]: 'Компоновка исходная', [body]: '# Сырой Markdown\r\n\r\nОригинал 🦔', [crypto.randomUUID()]: { preserve: [false, 0, 'unknown'] } });
  }
  if (!(await api.getUiConfig(collection.id, 'form')).rows) throw new Error('Incomplete row configuration');
  return { library_id: library.id, collection_id: collection.id, primary, count, flag, body, date };
}
