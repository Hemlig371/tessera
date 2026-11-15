import type { Repository } from '../../src/core/repository';

/** Real native connection: cooperative cancellation must roll back every affected table. */
export async function importCancellationScenario(api: Repository) {
  const name = 'Отмена CSV (dev/CI)';
  const existing = (await api.listLibraries()).find(library => library.name === name);
  const library = existing ?? await api.createLibrary(name);
  const collection = (await api.listCollections(library.id))[0] ?? await api.createCollection(library.id, 'Импорт', 'Название');
  const completed = (await api.queryEntries({ collection_id: collection.id })).items;
  if (completed.length === 1 && completed[0]!.data[collection.primary_field_id] === 'После отмены') return;
  if (completed.length) throw new Error('native cancellation left partial rows');
  const snapshot = () => api.db.read(async s => JSON.stringify({
    records: await s.query('SELECT * FROM records WHERE collection_id=? ORDER BY id', [collection.id]),
    versions: await s.query('SELECT v.* FROM record_versions v JOIN records r ON r.id=v.record_id WHERE r.collection_id=? ORDER BY v.id', [collection.id]),
    changes: await s.query('SELECT count(*) AS n,max(seq) AS last FROM change_log'),
    clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"),
    fts: await s.query('SELECT count(*) AS n FROM records_fts'),
  }));
  const before = await snapshot(), controller = new AbortController();
  let cancelled = false, progressed = false;
  try {
    await api.importEntries(collection.id, Array.from({ length: 180 }, (_, index) => ({ [collection.primary_field_id]: 'Отмена ' + index })), count => {
      if (count === 120) { progressed = true; controller.abort(); }
    }, controller.signal);
  } catch (error) { if (!(error instanceof Error) || error.message !== 'operationCancelled') throw error; cancelled = true; }
  if (!cancelled || !progressed || await snapshot() !== before) throw new Error('native import cancellation was not atomic');
  await api.importEntries(collection.id, [{ [collection.primary_field_id]: 'После отмены' }]);
  if ((await api.queryEntries({ collection_id: collection.id, search: 'после' })).items.length !== 1) throw new Error('native import retry failed');
}
