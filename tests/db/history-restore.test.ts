import { afterEach, describe, expect, it } from 'vitest';
import { historyRestoreScenario } from '../support/history-scenario';
import { adapters, fixture } from '../support/fixture';

describe.each(adapters)('%s explicit version restoration', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!, library = await api.createLibrary('История');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const unknown = crypto.randomUUID();
    const original = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Исходная', [unknown]: { keep: true } });
    const version = (await api.getHistory(original.id)).versions[0]!;
    const laterField = crypto.randomUUID();
    const current = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Новая', [laterField]: 'later' }, original.id, original.hlc);
    return { api, library, collection, original, version, current };
  }
  it('runs the shared native acceptance scenario', async () => {
    f = await fixture(kind); await historyRestoreScenario(f.api!);
  });
  it('restores the complete data snapshot with a new version/HLC and keeps old versions immutable', async () => {
    const { api, collection, original, version, current } = await setup();
    await api.startLocalSync(); const before = await api.getHistory(current.id);
    const restored = await api.restoreEntryVersion(current.id, version.id, current.hlc);
    expect(restored.data).toEqual(original.data);
    expect(restored.id).toBe(original.id);
    expect(restored.created_at).toBe(original.created_at);
    expect(restored.created_local).toBe(original.created_local);
    expect(restored.hlc > current.hlc).toBe(true);
    const after = await api.getHistory(current.id);
    expect(after.versions).toHaveLength(3);
    expect(after.versions.slice(1)).toEqual(before.versions);
    expect(after.versions[0]!.snapshot).toEqual(restored);
    const checkpoint = await api.startLocalSync();
    // Repeating an unchanged restore does not create a duplicate user version or event.
    expect(await api.restoreEntryVersion(current.id, version.id, restored.hlc)).toEqual(restored);
    expect(await api.getHistory(current.id)).toEqual(after);
    expect(await api.startLocalSync()).toEqual(checkpoint);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'Исходная' })).items.map(v => v.id)).toEqual([original.id]);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'Новая' })).items).toEqual([]);
  });
  it('rejects stale, cleared and foreign versions without changing data, and rolls back a failed journal write', async () => {
    const { api, collection, original, version, current } = await setup();
    await api.startLocalSync(); const before = await api.getHistory(current.id), checkpoint = await api.startLocalSync();
    await expect(api.restoreEntryVersion(current.id, version.id, original.hlc)).rejects.toThrow('staleRecord');
    const other = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Другая' });
    await expect(api.restoreEntryVersion(other.id, version.id, other.hlc)).rejects.toThrow('notFound');
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_restore BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'restore failure'); END"));
    const checkpointWithOther = await api.startLocalSync();
    await expect(api.restoreEntryVersion(current.id, version.id, current.hlc)).rejects.toThrow('restore failure');
    expect(await api.getEntry(current.id)).toEqual(current);
    expect(await api.getHistory(current.id)).toEqual(before);
    expect(await api.startLocalSync()).toEqual(checkpointWithOther);
    expect(checkpointWithOther).not.toEqual(checkpoint);
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_restore'));
    await api.clearHistory(current.id);
    await expect(api.restoreEntryVersion(current.id, version.id, current.hlc)).rejects.toThrow('notFound');
    expect(await api.getEntry(current.id)).toEqual(current);
  });
  it('validates historical data against the current schema and does not silently add new defaults', async () => {
    const { api, collection, version, current } = await setup();
    const required = await api.createField(collection.id, 'Обязательное', 'text', { required: true, default: 'Default' });
    const changed = await api.saveEntry(collection.id, { [required.id]: 'Current' }, current.id, current.hlc);
    const history = await api.getHistory(current.id);
    await expect(api.restoreEntryVersion(current.id, version.id, changed.hlc)).rejects.toThrow('required');
    expect(await api.getEntry(current.id)).toEqual(changed);
    expect(await api.getHistory(current.id)).toEqual(history);
  });
  it('rotates restored snapshots in the same deterministic Top-20 and cannot restore an evicted version', async () => {
    const { api, collection, version, current } = await setup();
    let row = current;
    for (let n = 0; n < 24; n++) row = await api.saveEntry(collection.id, { [collection.primary_field_id]: `Правка ${n}` }, row.id, row.hlc);
    const before = await api.getHistory(row.id), oldest = before.versions.at(-1)!;
    await expect(api.restoreEntryVersion(row.id, version.id, row.hlc)).rejects.toThrow('notFound');
    const restored = await api.restoreEntryVersion(row.id, oldest.id, row.hlc), after = await api.getHistory(row.id);
    expect(restored.data).toEqual(oldest.snapshot.data);
    expect(after.versions).toHaveLength(20);
    expect(after.versions.slice(1)).toEqual(before.versions.slice(0, 19));
    expect(after.trimmed_through).toEqual({ hlc: oldest.hlc, id: oldest.id });
  });
  it('restores an inbox snapshot after a move, preserving identity and original dates; rejects a deleted target', async () => {
    const { api, collection } = await setup(), inbox = await api.getInbox();
    const original = await api.saveEntry(inbox.id, { [inbox.primary_field_id]: 'Исходный текст' });
    const initialVersion = (await api.getHistory(original.id)).versions[0]!;
    const moved = await api.moveInboxEntry(original.id, collection.id, { [collection.primary_field_id]: 'Перенесено' }, original.hlc);
    const movedVersion = (await api.getHistory(original.id)).versions[0]!;
    const restored = await api.restoreEntryVersion(original.id, initialVersion.id, moved.hlc);
    expect(restored.collection_id).toBe(inbox.id);
    expect(restored.data).toEqual(original.data);
    expect(restored.created_at).toBe(original.created_at);
    expect((await api.queryEntries({ collection_id: collection.id })).items.some(v => v.id === original.id)).toBe(false);
    expect((await api.queryEntries({ collection_id: inbox.id, search: 'Исходный' })).items.map(v => v.id)).toEqual([original.id]);
    await api.setDeleted('collection', collection.id, true);
    await expect(api.restoreEntryVersion(original.id, movedVersion.id, restored.hlc)).rejects.toThrow('notFound');
    expect(await api.getEntry(original.id)).toEqual(restored);
  });
});
