import type { Repository } from '../../src/core/repository';
import type { RecordData } from '../../src/core/model';
/** Dev/CI only: real API, 50K records, 21 fields and ~5K relations, including reverse queries. */
export async function scaleScenario(api: Repository, size = 50_000) {
  const library = await api.createLibrary('Scale fixture');
  const collection = await api.createCollection(library.id, '50K × 21', 'Название');
  const fields = [
    await api.createField(collection.id, 'Описание', 'multiline'),
    await api.createField(collection.id, 'Метка', 'text'),
  ];
  for (let i = 0; i < 16; i++)
    fields.push(
      await api.createField(collection.id, 'Поле ' + i, i < 9 ? 'integer' : i < 13 ? 'boolean' : 'date')
    );
  const relation = await api.createField(collection.id, 'Родитель', 'relation', {
    target_collection_id: collection.id,
  });
  fields.push(relation);
  const backlink = await api.createField(collection.id, 'Потомки', 'backlink', {
    source_field_id: relation.id,
  });
  const sort = fields[2]!;
  await api.saveUiConfig(collection.id, 'list', {
    fields: [],
    list: { sort_field: sort.id, direction: 'asc' },
  });
  let rootId = '';
  function data(i: number): RecordData {
    const row: RecordData = { [collection.primary_field_id]: 'Запись ' + i };
    fields.forEach((f, j) => {
      row[f.id] =
        f.type === 'integer'
          ? i + j
          : f.type === 'boolean'
            ? i % 2 === 0
            : f.type === 'date'
              ? '2026-11-14'
              : f.type === 'relation'
                ? i > 0 && i % 10 === 0
                  ? rootId
                  : null
                : 'Описание метка' + i;
    });
    return row;
  }
  const start = performance.now();
  const root = await api.saveEntry(collection.id, data(0));
  rootId = root.id;
  function* rows() {
    for (let i = 1; i < size; i++) yield data(i);
  }
  const imported = await api.importEntries(collection.id, rows());
  if (imported !== size - 1) throw new Error('scale import count mismatch');
  const importMs = performance.now() - start,
    beforeQuery = performance.now();
  const page = await api.queryEntries({ collection_id: collection.id, limit: 200 });
  const search = await api.queryEntries({ collection_id: collection.id, search: 'МЕТКА49999', limit: 200 });
  const reverse = await api.getRelationPage(root.id, backlink.id, null, 50);
  const queryMs = performance.now() - beforeQuery;
  const [counts] = await api.db.read((s) =>
    s.query<{ n: number; edges: number }>(
      'SELECT (SELECT count(*) FROM records WHERE collection_id=?) AS n,(SELECT count(*) FROM relation_index WHERE field_id=?) AS edges',
      [collection.id, relation.id]
    )
  );
  const edges = Math.floor((size - 1) / 10);
  if (
    page.items.length !== Math.min(size, 200) ||
    page.items[0]?.data[sort.id] !== 2 ||
    (size >= 50000 && search.items.length !== 1) ||
    counts?.n !== size ||
    counts.edges !== edges ||
    reverse.items.length !== Math.min(50, edges)
  )
    throw new Error('scale data mismatch');
  return {
    library,
    collection,
    sort,
    fields,
    backlink,
    relation,
    root,
    page,
    edges,
    importMs: Math.round(importMs),
    queryMs: Math.round(queryMs),
  };
}
