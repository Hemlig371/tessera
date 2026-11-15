import type { Repository } from '../../src/core/repository';
import type { RecordData } from '../../src/core/model';
/** Dev/CI fixture only. Uses the production TS bulk-import API, never an in-memory storage substitute. */
export async function scaleScenario(api: Repository, size = 50_000) {
  const library = await api.createLibrary('Scale fixture');
  const collection = await api.createCollection(library.id, '50K × 20', 'Название');
  const fields = [
    await api.createField(collection.id, 'Описание', 'multiline'),
    await api.createField(collection.id, 'Метка', 'text'),
  ];
  for (let i = 0; i < 17; i++)
    fields.push(
      await api.createField(collection.id, 'Поле ' + i, i < 9 ? 'integer' : i < 13 ? 'boolean' : 'date')
    );
  const sort = fields[2]!;
  await api.saveUiConfig(collection.id, 'list', {
    fields: [],
    list: { sort_field: sort.id, direction: 'asc' },
  });
  function* data(): Generator<RecordData> {
    for (let i = 0; i < size; i++) {
      const row: RecordData = { [collection.primary_field_id]: 'Запись ' + i };
      fields.forEach((f, j) => {
        row[f.id] =
          f.type === 'integer'
            ? i + j
            : f.type === 'boolean'
              ? i % 2 === 0
              : f.type === 'date'
                ? '2026-11-14'
                : 'Описание метка' + i;
      });
      yield row;
    }
  }
  const start = performance.now();
  await api.importEntries(collection.id, data());
  const importMs = performance.now() - start;
  const beforeQuery = performance.now();
  const page = await api.queryEntries({ collection_id: collection.id, limit: 200 });
  const search = await api.queryEntries({ collection_id: collection.id, search: 'МЕТКА49999', limit: 200 });
  const queryMs = performance.now() - beforeQuery;
  if (
    page.items.length !== Math.min(size, 200) ||
    page.items[0]?.data[sort.id] !== 2 ||
    (size >= 50_000 && search.items.length !== 1)
  )
    throw new Error('scale data mismatch');
  return {
    library,
    collection,
    sort,
    fields,
    page,
    importMs: Math.round(importMs),
    queryMs: Math.round(queryMs),
  };
}
