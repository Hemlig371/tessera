import type { Repository } from '../../src/core/repository';

export async function quickFormFixture(api: Repository) {
  const library = await api.createLibrary('acceptance.quick');
  const collection = await api.createCollection(library.id, 'Быстрые записи', 'Название');
  const number = await api.createField(collection.id, 'Количество', 'integer', { required: true, default: 0 });
  const note = await api.createField(collection.id, 'Заметка', 'multiline');
  await api.saveUiConfig(collection.id, 'form', { fields: [{ field_id: collection.primary_field_id, visible: true }, { field_id: number.id, visible: true, default: 7 }] });
  return { library, collection, number, note };
}
export async function quickScenario(api: Repository) {
  const { collection, number } = await quickFormFixture(api);
  await api.saveQuickForm(collection.id, await api.getQuickForm(collection.id));
  const row = await api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Quick bridge save' });
  if (row.data[number.id] !== 7 || (await api.getEntry(row.id))?.id !== row.id) throw new Error('quick native save failed');
  let failed = false;
  try { await api.saveQuickEntry(collection.id, { [collection.primary_field_id]: '' }); }
  catch { failed = true; }
  if (!failed || (await api.queryEntries({ collection_id: collection.id })).items.length !== 1) throw new Error('quick native validation failed');
}
