import { afterEach, describe, expect, it } from 'vitest';
import { fixture, adapters } from '../support/fixture';
describe.each(adapters)('%s reserved draft IDs', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('creates only on explicit save and deduplicates a retry without changing history, journal or HLC', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Черновики');
    const collection = await api.createCollection(library.id, 'Записи', 'Название'), id = crypto.randomUUID();
    expect(await api.getDraftTarget(id)).toBeNull();
    const row = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Сохранить' }, id);
    const before = await f.db.read(async s => ({ versions: await s.query('SELECT * FROM record_versions'), log: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'") }));
    expect(await api.saveNewEntry(collection.id, row.data, id)).toEqual(row);
    expect(await f.db.read(async s => ({ versions: await s.query('SELECT * FROM record_versions'), log: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'") }))).toEqual(before);
    await api.setDeleted('record', id, true);
    expect((await api.getDraftTarget(id))?.deleted_at).not.toBeNull(); expect(await api.getEntry(id)).toBeNull();
    await expect(api.saveNewEntry(collection.id, row.data, id)).rejects.toThrow('staleRecord');
  });
});
