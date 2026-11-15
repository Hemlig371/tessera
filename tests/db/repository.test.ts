import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';
import { migrate } from '../../src/core/migrate';
import { sqliteContract } from '../support/sqlite-contract';

describe.each(adapters)('%s native SQLite contract', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind); const api = f.api!;
    const library = await api.createLibrary('Личное');
    const collection = await api.createCollection(library.id, 'Заметки', 'Название');
    await api.startLocalSync();
    return { api, library, collection };
  }
  it('passes all mandatory SQLite probes through the adapter', async () => {
    f = await fixture(kind); await sqliteContract(f.db);
  });
  it('creates library/collection/text field/entry and reopens the on-disk database', async () => {
    const { api, collection, library } = await setup();
    const record = await api.saveEntry(collection.id, { [collection.primary_field_id]: "Моя запись ' ?" });
    expect((await api.getEntry(record.id))?.data).toEqual(record.data);
    expect((await api.listLibraries())[0]?.id).toBe(library.id);
    expect((await api.listCollections(library.id))[0]?.id).toBe(collection.id);
    const [counts] = await f.db.read(s => s.query<{ versions: number; changes: number }>('SELECT (SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log) AS changes'));
    expect(counts).toMatchObject({ versions: 1, changes: 6 });
    await f.db.close();
    const reopened = await f.reopen();
    try {
      await migrate(reopened); const again = await Repository.open(reopened);
      expect(again.deviceId).toBe(api.deviceId); expect(again.datasetId).toBe(api.datasetId);
      expect(await again.getEntry(record.id)).toEqual(record);
    } finally { await reopened.close(); }
  });
  it('rolls back records, version, FTS and clock when the journal fails', async () => {
    const { api, collection } = await setup();
    await f.db.read(s => s.execute("CREATE TRIGGER reject_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'injected journal failure'); END"));
    const before = await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='hlc'"));
    await expect(api.saveEntry(collection.id, { [collection.primary_field_id]: 'Не сохранится' })).rejects.toThrow('injected journal failure');
    for (const table of ['records', 'record_versions', 'records_fts']) expect((await f.db.read(s => s.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)))[0]?.n).toBe(0);
    expect(await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='hlc'"))).toEqual(before);
  });
  it('rejects invalid data and a missing parent without creating partial objects', async () => {
    const { api, collection } = await setup();
    await expect(api.saveEntry(collection.id, { [collection.primary_field_id]: '  ' })).rejects.toThrow('requiredText');
    await expect(api.saveEntry(collection.id, { [collection.primary_field_id]: 42 })).rejects.toThrow('requiredText');
    await expect(api.createCollection(crypto.randomUUID(), 'Нет', 'Название')).rejects.toThrow('notFound');
    await expect(api.createLibrary(' ')).rejects.toThrow('invalidName');
    await expect(api.listEntries(collection.id, null, 1000)).rejects.toThrow('invalidLimit');
    expect((await api.listEntries(collection.id)).items).toHaveLength(0);
  });
  it('keeps unknown field values and avoids a version/journal entry for unchanged saves', async () => {
    const { api, collection } = await setup(), unknown = crypto.randomUUID();
    const row = await api.saveEntry(collection.id, { [unknown]: { keep: true }, [collection.primary_field_id]: 'Первое' });
    const unchanged = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Первое' }, row.id, (await api.getEntry(row.id))!.hlc);
    expect(unchanged.hlc).toBe(row.hlc);
    const changed = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Второе' }, row.id, (await api.getEntry(row.id))!.hlc);
    expect(changed.created_at).toBe(row.created_at); expect(changed.data[unknown]).toEqual({ keep: true });
    expect(changed.hlc > row.hlc).toBe(true);
    expect((await f.db.read(s => s.query<{ n: number }>('SELECT count(*) AS n FROM record_versions')))[0]?.n).toBe(2);
    await expect(f.db.read(s => s.execute("UPDATE record_versions SET snapshot='{}'"))).rejects.toThrow('immutable version');
  });
  it('serializes concurrent writers and paginates with a stable id tie-break', async () => {
    const { api, collection } = await setup();
    const rows = await Promise.all(Array.from({ length: 25 }, (_, n) => api.saveEntry(collection.id, { [collection.primary_field_id]: String(n) })));
    expect(new Set(rows.map(r => r.hlc)).size).toBe(25);
    await f.db.read(s => s.execute("UPDATE records SET updated_at='2026-01-01T00:00:00.000Z'"));
    let cursor = null; const ids: string[] = [];
    do { const page = await api.listEntries(collection.id, cursor, 7); ids.push(...page.items.map(r => r.id)); cursor = page.next; } while (cursor);
    expect(ids).toEqual(rows.map(r => r.id).sort().reverse());
    const plan = await f.db.read(s => s.query<{ detail: string }>('EXPLAIN QUERY PLAN SELECT * FROM records WHERE collection_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 100', [collection.id]));
    expect(plan.some(r => r.detail.includes('records_page'))).toBe(true);
    expect(await f.db.read(s => s.query('PRAGMA foreign_key_check'))).toEqual([]);
  });
});
