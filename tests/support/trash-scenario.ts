import type { Repository } from '../../src/core/repository';

/** Runs unchanged on Node, rusqlite and the real Capacitor bridge. */
export async function trashScenario(api: Repository) {
  const library = await api.createLibrary('Корзина (dev/CI) ' + crypto.randomUUID().slice(0, 8));
  const collection = await api.createCollection(library.id, 'Удалённые записи', 'Название');
  const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Корзина проверка' });
  await api.setDeleted('record', entry.id, true, entry.hlc);
  let trash = await api.queryTrash(library.id);
  if (trash.items[0]?.id !== entry.id || (await api.queryEntries({ collection_id: collection.id, search: 'проверка' })).items.length)
    throw new Error('native trash visibility failed');
  await api.setDeleted('record', entry.id, false, trash.items[0].hlc);
  if ((await api.getEntry(entry.id))?.data[collection.primary_field_id] !== 'Корзина проверка' || (await api.getHistory(entry.id)).versions.length !== 1)
    throw new Error('native trash restore failed');
  await api.setDeleted('record', entry.id, true);
  trash = await api.queryTrash(library.id);
  await api.purgeEntry(entry.id, trash.items[0]!.hlc);
  if (await api.mergeEntryState(entry) || (await api.queryTrash(library.id)).items.length || (await api.getHistory(entry.id)).versions.length)
    throw new Error('native terminal purge failed');
  return { library_id: library.id, collection_id: collection.id, record_id: entry.id };
}
