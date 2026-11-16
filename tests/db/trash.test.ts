import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { trashScenario } from '../support/trash-scenario';
import { Repository } from '../../src/core/repository';
import { mergeHistory } from '../../src/core/history';
import { nextHlc } from '../../src/core/hlc';
import type { Entry } from '../../src/core/model';

describe.each(adapters)('%s shared trash and permanent tombstones', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { vi.useRealTimers(); await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind); const api = f.api!;
    const library = await api.createLibrary('Корзина');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'ПоискКорзина' });
    return { api, library, collection, entry };
  }
  it('passes the cross-platform acceptance scenario', async () => {
    f = await fixture(kind); await trashScenario(f.api!);
  });
  it('atomically hides/restores search and links, retains UUID/data/history and has no extra user versions', async () => {
    const { api, collection, entry } = await setup();
    const relation = await api.createField(collection.id, 'Ссылка', 'relation', { target_collection_id: collection.id });
    const source = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Источник', [relation.id]: entry.id });
    const history = await api.getHistory(entry.id);
    await api.startLocalSync();
    await api.setDeleted('record', entry.id, true, entry.hlc);
    expect(await api.getEntry(entry.id)).toBeNull();
    expect((await api.queryEntries({ search: 'ПоискКорзина' })).items).toEqual([]);
    expect((await api.getRelationPage(source.id, relation.id)).items[0]?.status).toBe('deleted');
    const deleted = (await api.queryTrash()).items[0]!;
    expect(deleted.data).toEqual(entry.data); expect(deleted.hlc > entry.hlc).toBe(true);
    await api.setDeleted('record', entry.id, false, deleted.hlc);
    expect((await api.getRelationPage(source.id, relation.id)).items[0]?.status).toBe('available');
    const restored = await api.getEntry(entry.id);
    expect(restored).toMatchObject({ id: entry.id, data: entry.data, created_at: entry.created_at, deleted_at: null });
    expect(await api.getHistory(entry.id)).toEqual(history);
    expect((await api.queryEntries({ search: 'ПоискКорзина' })).items.map(row => row.id)).toEqual([entry.id]);
  });
  it('paginates the global trash with library filters including Inbox and deleted containers', async () => {
    const { api, library, collection, entry } = await setup();
    const inbox = await api.getInbox();
    const incoming = await api.saveEntry(inbox.id, { [inbox.primary_field_id]: 'Входящее' });
    for (const id of [entry.id, incoming.id]) await api.setDeleted('record', id, true);
    const first = await api.queryTrash(null, null, 1), second = await api.queryTrash(null, first.next, 1);
    expect(new Set([...first.items, ...second.items].map(row => row.id))).toEqual(new Set([entry.id, incoming.id]));
    expect(second.next).toBeNull();
    await api.setDeleted('collection', collection.id, true);
    expect((await api.queryTrash(library.id)).items).toHaveLength(1);
    expect((await api.queryTrash(library.id)).items[0]?.restorable).toBe(false);
    await expect(api.setDeleted('record', entry.id, false)).rejects.toThrow('notFound');
    expect(await api.listTrashLibraries()).toHaveLength(2);
    expect(() => api.queryTrash(null, null, 201)).toThrow('invalidQuery');
  });
  it('permanently removes content/versions/indexes, preserves incoming UUID links and rejects every resurrection path', async () => {
    const { api, collection, entry } = await setup();
    const history = await api.getHistory(entry.id);
    await api.setDeleted('record', entry.id, true);
    const deleted = (await api.queryTrash()).items[0]!;
    await api.purgeEntry(entry.id, deleted.hlc);
    const tombstone = await f.db.read(s => s.query<Entry>('SELECT * FROM records WHERE id=?', [entry.id]));
    expect(tombstone[0]).toMatchObject({ purged: 1, data: '{}', sort_data: '{}', search_data: '{}' });
    expect(tombstone[0]!.hlc > deleted.hlc).toBe(true);
    expect((await api.queryTrash()).items).toEqual([]);
    expect((await api.getHistory(entry.id)).versions).toEqual([]);
    await f.db.transaction(s => mergeHistory(s, { ...history, versions: history.versions.map(v => ({ ...v,
      hlc: nextHlc(v.device_id, 8e12), snapshot: { ...v.snapshot, hlc: nextHlc(v.device_id, 8e12) } })) }));
    expect((await api.getHistory(entry.id)).versions).toEqual([]);
    expect(await api.mergeEntryState({ ...entry, hlc: nextHlc(entry.device_id, 8e12) })).toBe(false);
    await expect(api.setDeleted('record', entry.id, false)).rejects.toThrow('purgedRecord');
    await expect(api.saveNewEntry(collection.id, entry.data, entry.id)).rejects.toThrow();
    await expect(api.restoreEntryVersion(entry.id, history.versions[0]!.id, deleted.hlc)).rejects.toThrow('notFound');
    expect(await f.db.read(s => s.query('SELECT * FROM search_documents WHERE record_id=?', [entry.id]))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM records_fts WHERE record_id=?', [entry.id]))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM relation_index WHERE source_record_id=?', [entry.id]))).toEqual([]);
    const reopened = await Repository.open(f.db);
    expect(await reopened.mergeEntryState(entry)).toBe(false);
    await reopened.purgeEntry(entry.id, deleted.hlc); // idempotent retry
  });
  it('retains required active/paused events and exports tombstones in the first baseline', async () => {
    const { api, entry } = await setup();
    await api.setDeleted('record', entry.id, true);
    await api.purgeEntry(entry.id, (await api.queryTrash()).items[0]!.hlc);
    expect(await f.db.read(s => s.query('SELECT * FROM change_log'))).toEqual([]);
    await api.startLocalSync(); await api.pauseLocalSync(true);
    const before = await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='record' AND entity_id=?", [entry.id]));
    expect(JSON.parse(String(before[0]?.payload))).toMatchObject({ purged: 1, data: {} });
    await api.cleanTrash();
    expect(await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='record' AND entity_id=?", [entry.id]))).toEqual(before);
  });
  it.each([7, 14, 30, 90, null] as const)('honors %s days, exact expiry and startup cleanup without expiring tombstones', async days => {
    const { api, entry } = await setup(); expect(await api.getTrashRetention()).toBe(30);
    await api.saveTrashRetention(days);
    vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now();
    await api.setDeleted('record', entry.id, true);
    if (days !== null) {
      vi.setSystemTime(now + days * 86400000 - 1); expect(await api.cleanTrash()).toBe(0);
      vi.setSystemTime(now + days * 86400000);
    } else vi.setSystemTime(now + 1000 * 86400000);
    const reopened = await Repository.open(f.db);
    expect(await reopened.getTrashRetention()).toBe(days);
    expect((await reopened.queryTrash()).items.length).toBe(days === null ? 1 : 0);
    vi.setSystemTime(now + 2000 * 86400000); await reopened.cleanTrash();
    expect(await f.db.read(s => s.query('SELECT id FROM records WHERE id=?', [entry.id]))).toHaveLength(1);
  });
  it('resumes bounded retention cleanup after a failed second batch without losing committed tombstones', async () => {
    const { api, collection } = await setup();
    await api.importEntries(collection.id, Array.from({ length: 54 }, (_, n) => ({ [collection.primary_field_id]: 'Порция ' + n })));
    const entries = (await api.queryEntries({ collection_id: collection.id })).items;
    vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now();
    for (const entry of entries) await api.setDeleted('record', entry.id, true);
    vi.setSystemTime(now + 30 * 86400000);
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_second_batch BEFORE UPDATE OF purged ON records WHEN NEW.purged=1 AND (SELECT count(*) FROM records WHERE purged=1)>=50 BEGIN SELECT RAISE(ABORT,'second batch'); END"));
    await expect(api.cleanTrash()).rejects.toThrow('second batch');
    expect((await api.queryTrash()).items).toHaveLength(5);
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_second_batch'));
    const reopened = await Repository.open(f.db);
    expect((await reopened.queryTrash()).items).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT id FROM records WHERE purged=1'))).toHaveLength(55);
  });
  it('converges independent SQLite stores through reordered live/delete/restore/purge states and duplicate delivery', async () => {
    const { api, library, entry } = await setup();
    const other = await fixture(kind);
    try {
      const structure = await f.db.read(async s => {
        const result = [];
        for (const table of ['libraries', 'collections', 'fields', 'display_profiles']) result.push({ table, rows: await s.query(`SELECT * FROM ${table}`) });
        return result;
      });
      // Replica bootstrap copies the metadata graph; user records use the public merge API.
      await other.db.transaction(async s => {
        await s.execute('PRAGMA defer_foreign_keys=ON');
        for (const { table, rows } of structure) for (const row of rows)
          await s.execute(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row));
      });
      const b = other.api!;
      await b.mergeEntryState(entry);
      await api.setDeleted('record', entry.id, true);
      const deleted = (await api.queryTrash(library.id)).items[0]!;
      await api.setDeleted('record', entry.id, false, deleted.hlc);
      const restored = (await api.getEntry(entry.id))!;
      await b.mergeEntryState(restored); await b.mergeEntryState(deleted); await b.mergeEntryState(entry);
      expect(await b.getEntry(entry.id)).toEqual(restored);
      await api.setDeleted('record', entry.id, true);
      await api.purgeEntry(entry.id, (await api.queryTrash()).items[0]!.hlc);
      const [stored] = await f.db.read(s => s.query<Record<string, string | number | null>>('SELECT * FROM records WHERE id=?', [entry.id]));
      const tombstone = { ...restored, ...stored, data: {} } as Entry;
      await b.mergeEntryState({ ...restored, hlc: nextHlc(restored.device_id, 8e12) });
      await b.mergeEntryState(tombstone); await b.mergeEntryState(tombstone); await b.mergeEntryState(restored);
      const [remote] = await other.db.read(s => s.query<Record<string, string | number | null>>('SELECT * FROM records WHERE id=?', [entry.id]));
      await api.mergeEntryState({ ...tombstone, ...remote, data: {} } as Entry);
      expect(await f.db.read(s => s.query('SELECT * FROM records WHERE id=?', [entry.id]))).toEqual(await other.db.read(s => s.query('SELECT * FROM records WHERE id=?', [entry.id])));
      expect(await b.getEntry(entry.id)).toBeNull();
    } finally { await other.cleanup(); }
  });
  it('rejects stale destructive operations and rolls data/history/HLC/journal/FTS back on log failure', async () => {
    const { api, entry } = await setup();
    await expect(api.purgeEntry(entry.id, entry.hlc)).rejects.toThrow('recordNotDeleted');
    await api.setDeleted('record', entry.id, true);
    const deleted = (await api.queryTrash()).items[0]!;
    await expect(api.purgeEntry(entry.id, entry.hlc)).rejects.toThrow('staleRecord');
    await expect(api.setDeleted('record', entry.id, false, entry.hlc)).rejects.toThrow('staleRecord');
    await api.startLocalSync();
    const snapshot = () => f.db.read(async s => ({ rows: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'),
      settings: await s.query('SELECT * FROM local_settings ORDER BY key'), meta: await s.query('SELECT * FROM app_meta ORDER BY key'), changes: await s.query('SELECT * FROM change_log') }));
    const before = await snapshot();
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_purge BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'injected purge failure'); END"));
    await expect(api.purgeEntry(entry.id, deleted.hlc)).rejects.toThrow('injected purge failure');
    expect(await snapshot()).toEqual(before);
    await expect(api.setDeleted('record', entry.id, false)).rejects.toThrow('injected purge failure');
    expect(await snapshot()).toEqual(before);
  });
});
