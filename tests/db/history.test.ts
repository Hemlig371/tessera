import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { adapters, fixture } from '../support/fixture';
import { applyHistoryClear, mergeHistory, type HistoryState, type RecordVersion } from '../../src/core/history';
import { nextHlc } from '../../src/core/hlc';
import { Repository } from '../../src/core/repository';

const device = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe.each(adapters)('%s deterministic Top-20 history', kind => {
  const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.cleanup())); });
  async function setup(recordId: string = crypto.randomUUID()) {
    const f = await fixture(kind); fixtures.push(f);
    const api = f.api!, library = await api.createLibrary('История');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Начало' }, recordId);
    return { ...f, api, collection, entry };
  }
  it('rotates explicit saves atomically, keeps latest 20 and does not count unchanged saves', async () => {
    const f = await setup(); let entry = f.entry;
    for (let n = 1; n <= 34; n++) entry = await f.api.saveEntry(f.collection.id, { [f.collection.primary_field_id]: String(n) }, entry.id, entry.hlc);
    const history = await f.api.getHistory(entry.id);
    expect(history.versions).toHaveLength(20);
    expect(history.versions.map(v => v.snapshot.data[f.collection.primary_field_id])).toEqual(Array.from({ length: 20 }, (_, i) => String(34 - i)));
    expect(history.trimmed_through).not.toBeNull();
    await f.api.saveEntry(f.collection.id, entry.data, entry.id, entry.hlc);
    expect(await f.api.getHistory(entry.id)).toEqual(history);
    await f.db.read(s => s.execute("CREATE TRIGGER fail_history_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'injected history failure'); END"));
    await expect(f.api.saveEntry(f.collection.id, { [f.collection.primary_field_id]: 'Откат' }, entry.id, entry.hlc)).rejects.toThrow('injected history failure');
    expect(await f.api.getEntry(entry.id)).toEqual(entry);
    expect(await f.api.getHistory(entry.id)).toEqual(history);
  });
  it('converges across independent stores with shuffled delivery, duplicates, ties and a late old batch', async () => {
    const a = await setup(), b = await setup(a.entry.id), c = await setup(a.entry.id);
    for (const f of [a, b, c]) await f.db.transaction(s => s.execute('DELETE FROM record_versions'));
    const versions: RecordVersion[] = Array.from({ length: 55 }, (_, n) => {
      // Deliberately old wall times and three stable IDs at each HLC.
      const hlc = nextHlc(device, Math.floor(n / 3));
      return { id: id(n + 10), record_id: a.entry.id, hlc, device_id: device,
        saved_at: '2000-01-01T00:00:00.000Z', snapshot: { ...a.entry, hlc, device_id: device } };
    });
    const state = (items: RecordVersion[]): HistoryState => ({ record_id: a.entry.id, versions: items, trimmed_through: null, cleared_through: null });
    const orders = fc.sample(fc.shuffledSubarray(versions, { minLength: versions.length, maxLength: versions.length }), { seed: 142, numRuns: 3 });
    for (const [index, f] of [a, b, c].entries()) {
      for (const version of orders[index]!) await f.db.transaction(s => mergeHistory(s, state([version, version])));
    }
    const expected = versions.slice(-20).reverse().map(v => v.id);
    for (const f of [a, b, c]) expect((await f.api.getHistory(a.entry.id)).versions.map(v => v.id)).toEqual(expected);
    const history = await a.api.getHistory(a.entry.id);
    await b.db.transaction(s => mergeHistory(s, history));
    await b.db.transaction(s => mergeHistory(s, state(versions.slice(0, 25))));
    expect(await b.api.getHistory(a.entry.id)).toEqual(history);
    // A disconnected replica can catch up using only retained Top-20 and the floor.
    await c.db.transaction(s => s.execute('DELETE FROM record_versions'));
    await c.db.transaction(s => mergeHistory(s, history));
    expect(await c.api.getHistory(a.entry.id)).toEqual(history);
    expect(await a.api.getEntry(a.entry.id)).toEqual(a.entry);
  });
  it('merges Top-20 of disjoint parts and rejects an altered immutable version', async () => {
    const a = await setup(), b = await setup(a.entry.id);
    const original = (await a.api.getHistory(a.entry.id)).versions[0]!;
    const versions = Array.from({ length: 60 }, (_, n) => {
      const hlc = nextHlc(device, 8_000_000_000_000 + n);
      return { ...original, id: id(n + 100), hlc, device_id: device, snapshot: { ...original.snapshot, hlc, device_id: device } };
    });
    for (const [i, f] of [a, b].entries()) await f.db.transaction(s => mergeHistory(s, {
      record_id: a.entry.id, versions: versions.filter((_, n) => n % 2 === i), trimmed_through: null, cleared_through: null,
    }));
    const left = await a.api.getHistory(a.entry.id), right = await b.api.getHistory(a.entry.id);
    await a.db.transaction(s => mergeHistory(s, right)); await b.db.transaction(s => mergeHistory(s, left));
    expect(await a.api.getHistory(a.entry.id)).toEqual(await b.api.getHistory(a.entry.id));
    const state = await a.api.getHistory(a.entry.id);
    await expect(a.db.transaction(s => mergeHistory(s, { ...state, versions: [{ ...state.versions[0]!, saved_at: '2001-01-01' }] }))).rejects.toThrow('immutableVersion');
    expect(await a.api.getHistory(a.entry.id)).toEqual(state);
  });
  it('synchronizes explicit clear markers, rejects replay and allows later explicit saves', async () => {
    const a = await setup(), b = await setup(a.entry.id);
    const oldA = await a.api.getHistory(a.entry.id), oldB = await b.api.getHistory(a.entry.id);
    await a.db.transaction(s => mergeHistory(s, oldB));
    const marker = await a.api.clearHistory(a.entry.id);
    await b.db.transaction(s => applyHistoryClear(s, marker));
    for (const f of [a, b]) {
      await f.db.transaction(s => mergeHistory(s, oldA)); await f.db.transaction(s => mergeHistory(s, oldB));
      expect((await f.api.getHistory(a.entry.id)).versions).toEqual([]);
      expect(await f.api.getEntry(a.entry.id)).toEqual(f.entry);
    }
    const updated = await b.api.saveEntry(b.collection.id, { [b.collection.primary_field_id]: 'После очистки' }, b.entry.id, b.entry.hlc);
    expect(updated.hlc > marker.hlc).toBe(true);
    expect((await b.api.getHistory(b.entry.id)).versions).toHaveLength(1);
    await b.db.transaction(s => applyHistoryClear(s, marker));
    expect((await b.api.getHistory(b.entry.id)).versions).toHaveLength(1);
  });
  it('retains a global clear after restart and observes future remote clocks before saving', async () => {
    const f = await setup(), old = await f.api.getHistory(f.entry.id);
    const marker = { record_id: null, hlc: nextHlc(device, 8_000_000_000_000) };
    await f.db.transaction(s => applyHistoryClear(s, marker));
    const api = await Repository.open(f.db);
    await f.db.transaction(s => mergeHistory(s, old));
    expect((await api.getHistory(f.entry.id)).versions).toEqual([]);
    const created = await api.saveEntry(f.collection.id, { [f.collection.primary_field_id]: 'Новая' });
    expect(created.hlc > marker.hlc).toBe(true);
    expect((await api.getHistory(created.id)).versions).toHaveLength(1);
    await api.clearHistory();
    expect((await api.getHistory(created.id)).versions).toEqual([]);
    expect(await api.getEntry(created.id)).toEqual(created);
  });
});
