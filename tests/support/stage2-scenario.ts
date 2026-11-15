import type { Repository } from '../../src/core/repository';
import { csvRecords, exportCsv, parseCsv } from '../../src/core/csv';
/** Shared native acceptance scenario; included only by dedicated test entry points. */
export async function stage2Scenario(api: Repository) {
  const library = await api.createLibrary('Проверка этапа 2');
  const collection = await api.createCollection(library.id, 'Типы и CSV', 'Название');
  const notes = await api.createField(collection.id, 'Описание', 'multiline');
  const count = await api.createField(collection.id, 'Число', 'integer', {
    indexed: true,
    required: true,
    default: 0,
  });
  const flag = await api.createField(collection.id, 'Готово', 'boolean', { required: true, default: false });
  const day = await api.createField(collection.id, 'Дата', 'date');
  await api.saveUiConfig(collection.id, 'card', { fields: [{ field_id: notes.id, visible: false }] });
  await api.saveUiConfig(collection.id, 'list', {
    fields: [],
    list: { sort_field: count.id, direction: 'asc' },
  });
  const record = await api.saveEntry(collection.id, {
    [collection.primary_field_id]: 'Проверка ЮНИКОД',
    [notes.id]: 'Ёлка\n🦔',
    [day.id]: '2024-02-29',
  });
  if (record.data[count.id] !== 0 || record.data[flag.id] !== false)
    throw new Error('stage2 defaults failed');
  if ((await api.queryEntries({ collection_id: collection.id, search: 'юни ёл' })).items[0]?.id !== record.id)
    throw new Error('stage2 FTS failed');
  await api.updateField(notes.id, { name: 'Заметка', config: { fts: false } });
  if ((await api.queryEntries({ collection_id: collection.id, search: 'ёл' })).items.length)
    throw new Error('stage2 FTS disable failed');
  const fields = await api.listFields(collection.id);
  await api.importEntries(
    collection.id,
    csvRecords(parseCsv('Название;Число\nCSV;12\n'), [collection.primary_field_id, count.id], fields, 'ru')
  );
  let rejected = false;
  try {
    await api.importEntries(
      collection.id,
      csvRecords(
        parseCsv('Название;Число\nНе сохранить;1\nОшибка;1.5\n'),
        [collection.primary_field_id, count.id],
        fields,
        'ru'
      )
    );
  } catch {
    rejected = true;
  }
  if (!rejected || (await api.queryEntries({ collection_id: collection.id })).items.length !== 2)
    throw new Error('stage2 atomic import failed');
  let text = '',
    finished = false;
  await exportCsv(api, { collection_id: collection.id }, fields, 'ru', ';', {
    async write(part) {
      text += part;
    },
    async finish() {
      finished = true;
    },
    async abort() {
      throw new Error('unexpected export abort');
    },
  });
  if (!finished || parseCsv(text).rows.length !== 2 || !text.includes('Ёлка'))
    throw new Error('stage2 export failed');
  await api.setDeleted('field', notes.id, true);
  await api.setDeleted('field', notes.id, false);
  if ((await api.getEntry(record.id))?.data[notes.id] !== 'Ёлка\n🦔') throw new Error('stage2 undo failed');
  return collection;
}
