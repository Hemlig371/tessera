import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { fieldIndexName } from '../../src/core/search-keys';

describe.each(adapters)('%s display profiles', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('keeps independent named configs over the same records, defaults, stable IDs, order and indexes', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Профили');
    const collection = await api.createCollection(library.id, 'Общие записи', 'Название');
    const number = await api.createField(collection.id, 'Число', 'integer');
    const a = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'А', [number.id]: 0 });
    const b = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Б', [number.id]: 7 });
    const [initial] = await api.listDisplayProfiles(collection.id);
    expect(initial!.id).toBe(collection.default_profile_id);
    const all = { fields: [{ field_id: collection.primary_field_id, visible: true }], list: { sort_field: collection.primary_field_id, direction: 'desc' as const, mode: 'cards' as const } };
    await api.updateDisplayProfile(initial!.id, { name: 'Все', definition: all });
    const filtered = await api.createDisplayProfile(collection.id, 'Ненулевые', {
      fields: [{ field_id: number.id, visible: true }], list: { mode: 'table', sort_field: number.id, group_field: number.id, filters: [{ field_id: number.id, op: 'gt', value: 0 }] },
    });
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id') }));
    const before = await snapshot(), logs = await f.db.read(s => s.query('SELECT * FROM change_log ORDER BY seq'));
    expect((await api.queryEntries({ collection_id: collection.id, profile_id: initial!.id })).items.map(row => row.id)).toEqual([b.id, a.id]);
    expect((await api.queryEntries({ collection_id: collection.id, profile_id: filtered.id })).items.map(row => row.id)).toEqual([b.id]);
    expect(await snapshot()).toEqual(before); expect(await f.db.read(s => s.query('SELECT * FROM change_log ORDER BY seq'))).toEqual(logs);
    await api.updateDisplayProfile(filtered.id, { name: 'С числом', position: 0, make_default: true });
    expect((await api.getCollection(collection.id)).default_profile_id).toBe(filtered.id);
    expect(await api.getUiConfig(collection.id, 'list', initial!.id)).toEqual(all);
    expect((await api.queryEntries({ collection_id: collection.id })).items.map(row => row.id)).toEqual([b.id]);
    const indexes = () => f.db.read(s => s.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'"));
    expect((await indexes()).map(row => row.name)).toContain(fieldIndexName(collection.primary_field_id));
    expect((await indexes()).map(row => row.name)).toContain(fieldIndexName(number.id));
    await api.deleteDisplayProfile(initial!.id);
    expect((await indexes()).map(row => row.name)).not.toContain(fieldIndexName(collection.primary_field_id));
    await expect(api.deleteDisplayProfile(filtered.id)).rejects.toThrow('lastProfile');
    expect(await snapshot()).toEqual(before);
  });
  it('rejects a foreign profile, invalid settings and stale cursors; rolls metadata/default/index changes back atomically', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Атомарность');
    await api.startLocalSync();
    const a = await api.createCollection(library.id, 'A', 'Название'), b = await api.createCollection(library.id, 'B', 'Название');
    await api.importEntries(a.id, Array.from({ length: 3 }, (_, n) => ({ [a.primary_field_id]: String(n) })));
    const profile = await api.createDisplayProfile(a.id, 'Другой');
    const page = await api.queryEntries({ collection_id: a.id, limit: 1 });
    await expect(api.queryEntries({ collection_id: a.id, profile_id: profile.id, cursor: page.next })).rejects.toThrow('invalidCursor');
    await expect(api.queryEntries({ collection_id: b.id, profile_id: profile.id })).rejects.toThrow('notFound');
    await expect(api.createDisplayProfile(a.id, 'Ошибка', { fields: [{ field_id: b.primary_field_id, visible: true }] })).rejects.toThrow('invalidUiConfig');
    const snapshot = () => f.db.read(async s => ({ profiles: await s.query('SELECT * FROM display_profiles ORDER BY id'), collections: await s.query('SELECT * FROM collections ORDER BY id'), log: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"), indexes: await s.query("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name") }));
    const before = await snapshot();
    await f.db.transaction(s => s.execute("CREATE TRIGGER reject_profile BEFORE INSERT ON change_log WHEN NEW.entity_type='collection' BEGIN SELECT RAISE(ABORT,'profile failure'); END"));
    await expect(api.updateDisplayProfile(profile.id, { name: 'Не записывать', make_default: true })).rejects.toThrow('profile failure');
    expect(await snapshot()).toEqual(before);
    await expect(api.deleteDisplayProfile(a.default_profile_id!)).rejects.toThrow('profile failure');
    expect(await snapshot()).toEqual(before);
    await f.db.transaction(s => s.execute('DROP TRIGGER reject_profile'));
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = work => transaction(s => work({ ...s, execute: async (sql, params) => {
      if (sql.startsWith('CREATE INDEX IF NOT EXISTS field_')) throw new Error('profile index failure');
      return s.execute(sql, params);
    } }));
    await expect(api.updateDisplayProfile(profile.id, { make_default: true, definition: { fields: [], list: { sort_field: a.primary_field_id } } })).rejects.toThrow('profile index failure');
    expect(await snapshot()).toEqual(before); f.db.transaction = transaction;
    await api.deleteDisplayProfile(a.default_profile_id!);
    expect((await api.getCollection(a.id)).default_profile_id).toBe(profile.id);
  });
});
