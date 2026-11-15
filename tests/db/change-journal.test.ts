import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';
import type { JournalCheckpoint } from '../../src/core/change-journal';

describe.each(adapters)('%s change journal lifecycle', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Журнал');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Начало' });
    return { api, library, collection, entry };
  }
  const logs = () => f.db.read(s => s.query('SELECT * FROM change_log ORDER BY seq'));
  const userData = () => f.db.read(async s => ({
    records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id'),
    libraries: await s.query('SELECT * FROM libraries ORDER BY id'), fields: await s.query('SELECT * FROM fields ORDER BY id'),
    meta: await s.query("SELECT * FROM app_meta WHERE key<>'dataset_id' ORDER BY key"),
  }));
  it('bounds thousands of offline edits, then builds an atomic baseline from current tables once', async () => {
    const { api, collection, entry } = await setup(); let row = entry;
    for (let n = 0; n < 1000; n++) row = await api.saveEntry(collection.id, { [collection.primary_field_id]: String(n) }, row.id, row.hlc);
    await api.importEntries(collection.id, Array.from({ length: 300 }, (_, n) => ({ [collection.primary_field_id]: 'Импорт ' + n })));
    expect(await api.getSyncMode()).toBe('never_configured');
    expect(await logs()).toEqual([]);
    expect((await api.getHistory(row.id)).versions).toHaveLength(20);
    const before = await userData(), checkpoint = await api.startLocalSync();
    expect(await userData()).toEqual(before);
    const baseline = await logs();
    expect(baseline).toHaveLength(4 + 301 + 320 + 1); // Structure, current records, retained history, cutoff.
    const recordPayloads = await f.db.read(s => s.query<{ payload: string }>("SELECT payload FROM change_log WHERE entity_type='record' AND entity_id=?", [row.id]));
    expect(recordPayloads.map(v => JSON.parse(v.payload))).toEqual([row]);
    expect(await api.startLocalSync()).toEqual(checkpoint);
    expect(await logs()).toEqual(baseline);
    const reopened = await Repository.open(f.db);
    expect(await reopened.getSyncMode()).toBe('active'); expect(await logs()).toEqual(baseline);
  }, 60000);
  it('preserves pause/resume deltas and compact only the prefix acknowledged by every peer', async () => {
    const { api, collection, entry } = await setup(); const initial = await api.startLocalSync();
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    await api.acknowledgeLocalChanges(a, { ...initial, seq: 0 });
    await api.acknowledgeLocalChanges(b, { ...initial, seq: 0 });
    await api.pauseLocalSync(true);
    let row = entry;
    for (let n = 0; n < 35; n++) row = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Пауза ' + n }, row.id, row.hlc);
    await api.importEntries(collection.id, [{ [collection.primary_field_id]: 'CSV на паузе' }]);
    const pending = await logs(); expect(pending).toHaveLength(initial.seq + 72);
    await api.compactLocalChanges(); expect(await logs()).toEqual(pending);
    const again = await Repository.open(f.db);
    expect(await again.getSyncMode()).toBe('paused');
    await expect(again.startLocalSync()).rejects.toThrow('invalidSyncState');
    await again.pauseLocalSync(false); expect(await logs()).toEqual(pending);
    const last = { ...initial, seq: pending.at(-1)!.seq as number };
    await again.acknowledgeLocalChanges(a, last);
    await again.acknowledgeLocalChanges(b, initial);
    const data = await userData();
    await again.compactLocalChanges();
    expect(await userData()).toEqual(data);
    expect((await logs()).length).toBe(72);
    await expect(again.readLocalChanges({ ...initial, seq: 0 })).rejects.toThrow('journalGap');
    expect(await again.readLocalChanges(initial, 5)).toHaveLength(5);
    await again.acknowledgeLocalChanges(b, last); await again.compactLocalChanges();
    expect(await logs()).toEqual([]);
    expect(await again.readLocalChanges(last)).toEqual([]);
    await expect(again.acknowledgeLocalChanges(a, { ...last, seq: last.seq + 1 })).rejects.toThrow('journalGap');
    await expect(again.readLocalChanges({ ...last, dataset_id: crypto.randomUUID() })).rejects.toThrow('datasetMismatch');
  });
  it('does not compact an active journal without connected peers and never substitutes current payloads for old events', async () => {
    const { api, collection, entry } = await setup(); const start = await api.startLocalSync();
    const changed = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Новое' }, entry.id, entry.hlc);
    const before = await logs(); await api.compactLocalChanges(); expect(await logs()).toEqual(before);
    const deltas = await api.readLocalChanges(start);
    expect(JSON.parse(deltas[0]!.payload)).toEqual(changed);
    expect(JSON.parse((before.find(row => row.entity_type === 'record')!.payload as string))).toEqual(entry);
  });
  it('rolls activation and prefix deletion back after failures, then safely retries', async () => {
    const { api } = await setup();
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_baseline BEFORE INSERT ON change_log WHEN NEW.entity_type='record_version' BEGIN SELECT RAISE(ABORT,'baseline failure'); END"));
    await expect(api.startLocalSync()).rejects.toThrow('baseline failure');
    expect(await api.getSyncMode()).toBe('never_configured'); expect(await logs()).toEqual([]);
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_baseline'));
    const checkpoint = await api.startLocalSync();
    await api.acknowledgeLocalChanges(crypto.randomUUID(), checkpoint);
    const before = await logs();
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_floor BEFORE UPDATE ON local_settings WHEN NEW.key='sync_journal_floor' BEGIN SELECT RAISE(ABORT,'floor failure'); END"));
    await expect(api.compactLocalChanges()).rejects.toThrow('floor failure'); expect(await logs()).toEqual(before);
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_floor'));
    await api.compactLocalChanges(); expect(await logs()).toEqual([]);
    const again = await Repository.open(f.db); expect(await again.readLocalChanges(checkpoint)).toEqual([]);
  });
  it('detaches atomically into a new dataset and keeps user records, history and markers', async () => {
    const { api, collection, entry } = await setup(); const checkpoint = await api.startLocalSync();
    await api.acknowledgeLocalChanges(crypto.randomUUID(), { ...checkpoint, seq: 0 });
    await api.clearHistory(entry.id);
    const before = await userData(), oldId = api.datasetId, oldLog = await logs();
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_detach BEFORE UPDATE ON app_meta WHEN NEW.key='dataset_id' BEGIN SELECT RAISE(ABORT,'detach failure'); END"));
    await expect(api.detachLocalSync()).rejects.toThrow('detach failure');
    expect(api.datasetId).toBe(oldId); expect(await logs()).toEqual(oldLog); expect(await api.getSyncMode()).toBe('active');
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_detach'));
    await api.detachLocalSync();
    expect(api.datasetId).not.toBe(oldId); expect(await api.getSyncMode()).toBe('detached');
    expect(await logs()).toEqual([]); expect(await userData()).toEqual(before);
    expect(await f.db.read(s => s.query("SELECT * FROM local_settings WHERE key LIKE 'sync_peer:%'"))).toEqual([]);
    await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Независимо' });
    expect(await logs()).toEqual([]);
    await expect(api.readLocalChanges(checkpoint)).rejects.toThrow('datasetMismatch');
    const again = await Repository.open(f.db); expect(again.datasetId).toBe(api.datasetId);
    const fresh: JournalCheckpoint = await again.startLocalSync(); expect(fresh.dataset_id).toBe(api.datasetId);
    expect(await again.getSyncMode()).toBe('active'); expect((await logs()).length).toBeGreaterThan(0);
  });
});
