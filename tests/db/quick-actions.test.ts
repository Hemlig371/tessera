import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import type { JsonValue } from '../../src/core/model';

describe.each(adapters)('%s quick actions', kind => {
  const opened: Awaited<ReturnType<typeof fixture>>[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.cleanup(); });
  async function setup() {
    const f = await fixture(kind); opened.push(f); const api = f.api!, library = await api.createLibrary('Действия'), collection = await api.createCollection(library.id, 'Записи', 'Название');
    const amount = await api.createField(collection.id, 'Количество', 'decimal', { step: '0.25', decimal_min: '0' }), done = await api.createField(collection.id, 'Готово', 'boolean', { required: true });
    const option = { id: crypto.randomUUID(), label: 'Готово' }, status = await api.createField(collection.id, 'Статус', 'select', { options: [option] });
    const result = await api.createField(collection.id, 'Расчёт', 'formula', { formula: `[${amount.id}]*2` }), unknown = crypto.randomUUID();
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Запись', [amount.id]: '0.1', [done.id]: false, [unknown]: { future: [false, 0, null] } });
    return { f, api, collection, amount, done, status, option, result, entry, unknown };
  }
  it('updates current state, HLC, formulas and record journal without creating history versions', async () => {
    const { f, api, collection, amount, done, status, option, result, entry, unknown } = await setup();
    await api.startLocalSync();
    const history = await api.getHistory(entry.id);
    let current = await api.quickAction(entry.id, amount.id, { kind: 'increment', direction: 1 }, entry.hlc);
    expect(current.data[amount.id]).toBe('0.35');
    current = await api.quickAction(entry.id, amount.id, { kind: 'increment', direction: 1 }, current.hlc);
    current = await api.quickAction(entry.id, done.id, { kind: 'toggle' }, current.hlc);
    current = await api.quickAction(entry.id, status.id, { kind: 'set', value: option.id }, current.hlc);
    expect(current.data).toMatchObject({ [amount.id]: '0.6', [done.id]: true, [status.id]: option.id, [unknown]: { future: [false, 0, null] } });
    expect(current.hlc > entry.hlc).toBe(true);
    expect((await api.getEntry(entry.id))!.computed![result.id]!.value).toBe('1.2');
    expect(await api.getHistory(entry.id)).toEqual(history);
    const versions = await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='record_version' AND json_extract(payload,'$.record_id')=?", [entry.id]));
    expect(versions).toHaveLength(1);
    const records = await f.db.read(s => s.query<{ payload: string }>("SELECT payload FROM change_log WHERE entity_type='record' AND entity_id=? ORDER BY seq", [entry.id]));
    expect(records).toHaveLength(5);
    expect((JSON.parse(records.at(-1)!.payload) as { data: Record<string, JsonValue> }).data[amount.id]).toBe('0.6');
    const unchanged = await api.quickAction(entry.id, status.id, { kind: 'set', value: option.id }, current.hlc);
    expect(unchanged.hlc).toBe(current.hlc);
    await api.saveEntry(collection.id, { [amount.id]: '1' }, current.id, current.hlc);
    expect((await api.getHistory(entry.id)).versions).toHaveLength(2);
  });
  it('rolls back source, clock, cache and journal together if the record event fails', async () => {
    const { f, api, amount, result, entry } = await setup();
    await api.startLocalSync();
    expect((await api.getEntry(entry.id))!.computed![result.id]!.value).toBe('0.2');
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'), clock: await s.query("SELECT value FROM local_settings WHERE key='hlc'"), log: await s.query('SELECT * FROM change_log') }));
    const before = await snapshot();
    await f.db.transaction(s => s.execute(`CREATE TRIGGER fail_quick_log BEFORE INSERT ON change_log WHEN NEW.entity_type='record' AND NEW.entity_id='${entry.id}' BEGIN SELECT RAISE(ABORT,'injected quick failure'); END`));
    await expect(api.quickAction(entry.id, amount.id, { kind: 'increment', direction: 1 }, entry.hlc)).rejects.toThrow('injected quick failure');
    expect(await snapshot()).toEqual(before);
  });
  it('rejects stale input and read-only actions without changing the latest state', async () => {
    const { f, api, amount, result, entry } = await setup();
    const current = await api.quickAction(entry.id, amount.id, { kind: 'increment', direction: 1 }, entry.hlc);
    await expect(api.quickAction(entry.id, amount.id, { kind: 'increment', direction: 1 }, entry.hlc)).rejects.toThrow('staleRecord');
    await expect(api.quickAction(entry.id, result.id, { kind: 'set', value: '7' }, current.hlc)).rejects.toThrow('invalidQuickAction');
    expect((await api.getEntry(entry.id))!.data[amount.id]).toBe('0.35');
    expect((await api.getHistory(entry.id)).versions).toHaveLength(1);
    expect(await api.getSyncMode()).toBe('never_configured');
    expect(await f.db.read(s => s.query('SELECT * FROM change_log'))).toEqual([]);
  });
  it('keeps card/profile action assignments independent and excludes actions from creation forms', async () => {
    const { api, collection, amount, done } = await setup();
    await api.saveUiConfig(collection.id, 'card', { fields: [], quick_actions: [{ field_id: done.id, control: 'toggle' }] });
    const first = await api.createDisplayProfile(collection.id, 'Счётчик', { fields: [], quick_actions: [{ field_id: amount.id, control: 'counter' }] });
    const second = await api.createDisplayProfile(collection.id, 'Переключатель', { fields: [], quick_actions: [{ field_id: done.id, control: 'toggle' }] });
    expect((await api.getUiConfig(collection.id, 'card')).quick_actions).toEqual([{ field_id: done.id, control: 'toggle' }]);
    expect((await api.getUiConfig(collection.id, 'list', first.id)).quick_actions).toEqual([{ field_id: amount.id, control: 'counter' }]);
    expect((await api.getUiConfig(collection.id, 'list', second.id)).quick_actions).toEqual([{ field_id: done.id, control: 'toggle' }]);
    await expect(api.saveUiConfig(collection.id, 'card', { fields: [], quick_actions: [{ field_id: done.id, control: 'counter' }] })).rejects.toThrow('invalidQuickAction');
    await expect(api.saveQuickForm(collection.id, { fields: [], quick_actions: [{ field_id: done.id, control: 'toggle' }] })).rejects.toThrow('invalidQuickAction');
    expect((await api.listEntries(collection.id)).items).toHaveLength(1);
  });
});
