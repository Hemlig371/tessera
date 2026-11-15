import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
describe.each(adapters)('%s stale form A-01', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('rejects an outdated form without a record/version/clock/journal write and accepts only the explicitly refreshed revision', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('A-01');
    const collection = await api.createCollection(library.id, 'Редакции', 'Название');
    const initial = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Исходная' });
    const current = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Свежая' }, initial.id, initial.hlc);
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'),
      changes: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"), fts: await s.query('SELECT * FROM records_fts') }));
    const before = await snapshot();
    await expect(api.saveEntry(collection.id, { [collection.primary_field_id]: 'Старая форма' }, initial.id, initial.hlc)).rejects.toThrow('staleRecord');
    expect(await snapshot()).toEqual(before);
    expect(await api.getEntry(initial.id)).toEqual(current);
    const explicit = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Моя подтверждённая редакция' }, initial.id, current.hlc);
    expect(explicit.hlc > current.hlc).toBe(true);
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=?', [initial.id]))).toHaveLength(3);
  });
});
