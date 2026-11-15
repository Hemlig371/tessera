import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';

describe.each(adapters)('%s A-04 atomic cancellation', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('rolls back all rows, versions, clocks and indexes on batch cancellation, late failure and cancellation immediately before commit', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('A-04');
    const collection = await api.createCollection(library.id, 'Импорт', 'Название');
    const number = await api.createField(collection.id, 'Число', 'integer');
    await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Сохранить', [number.id]: 0 });
    const source = Array.from({ length: 180 }, (_, index) => ({ [collection.primary_field_id]: 'Строка ' + index, [number.id]: index }));
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id'),
      log: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"),
      fts: await s.query('SELECT * FROM records_fts ORDER BY rowid'), documents: await s.query('SELECT * FROM search_documents ORDER BY id'), relations: await s.query('SELECT * FROM relation_index') }));
    const before = await snapshot();
    for (const late of [false,true]) {
      const controller = new AbortController(), counts: number[] = [];
      await expect(api.importEntries(collection.id, source, (count, phase) => {
        counts.push(count); if (late ? phase === 'committing' : count === 120) controller.abort();
      }, controller.signal)).rejects.toThrow('operationCancelled');
      expect(counts).toContain(late ? 180 : 120); expect(await snapshot()).toEqual(before);
    }
    await expect(api.importEntries(collection.id, [...source, { [collection.primary_field_id]: 'Плохая последняя', [number.id]: 'не число' }])).rejects.toThrow('invalidInteger');
    expect(await snapshot()).toEqual(before);
    const checking = new AbortController(); checking.abort();
    await expect(api.previewImport(collection.id, source, undefined, checking.signal)).rejects.toThrow('operationCancelled');
    expect(await api.importEntries(collection.id, source)).toBe(180);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'строка', limit: 200 })).items).toHaveLength(180);
  });
});
