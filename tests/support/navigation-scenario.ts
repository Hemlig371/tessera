import type { Repository } from '../../src/core/repository';

/** Small, idempotent native fixture; user configuration survives activity recreation. */
export async function navigationFixture(api: Repository) {
  const library = (await api.listLibraries()).find(row => row.name === 'Навигация (dev/CI)') ?? await api.createLibrary('Навигация (dev/CI)');
  const collection = (await api.listCollections(library.id)).find(row => row.name === 'Раздел') ?? await api.createCollection(library.id, 'Раздел', 'Название');
  const profile = (await api.listDisplayProfiles(collection.id)).find(row => row.name === 'Стартовый профиль') ??
    await api.createDisplayProfile(collection.id, 'Стартовый профиль');
  const entry = (await api.listEntries(collection.id)).items[0] ?? await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Нативная навигация' });
  return { library_id: library.id, collection_id: collection.id, profile_id: profile.id, record_id: entry.id };
}
