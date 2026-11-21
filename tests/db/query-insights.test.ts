import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { readProfileQuery, summarizeEntries } from '../../src/core/query-insights';

describe.each(adapters)('%s M3 all-query insights', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('totals the whole filtered profile despite caller pagination and keeps source/history unchanged', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Итоги'), collection = await api.createCollection(library.id, 'Строки', 'Название');
    const amount = await api.createField(collection.id, 'Сумма', 'money', { currency: '₽' });
    const doubled = await api.createField(collection.id, 'Расчёт', 'formula', { formula: `[${amount.id}]*2` });
    await api.importEntries(collection.id, Array.from({ length: 411 }, (_, index) => ({ [collection.primary_field_id]: String(index), [amount.id]: '0.1' })));
    const profile = await api.createDisplayProfile(collection.id, 'Все суммы', { fields: [], list: { sort_field: doubled.id, direction: 'desc', filters: [{ field_id: doubled.id, op: 'gt', value: '0' }] } });
    const before = await f.db.read(async s => ({ records: await s.query('SELECT id,data,hlc FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id') }));
    const result = await f.db.transaction(async s => summarizeEntries(s, { ...await readProfileQuery(s, collection.id, profile.id), limit: 1 }, [{ operation: 'sum', field_id: amount.id }, { operation: 'sum', field_id: doubled.id }, { operation: 'count' }]));
    expect(result).toEqual([{ value: '41.1', error: null, matched: 411 }, { value: '82.2', error: null, matched: 411 }, { value: '411', error: null, matched: 411 }]);
    expect(await f.db.read(async s => ({ records: await s.query('SELECT id,data,hlc FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id') }))).toEqual(before);
    await api.updateDisplayProfile(profile.id, { definition: { fields: [], list: { filters: [{ field_id: amount.id, op: 'lt', value: '0' }] } } });
    expect(await f.db.transaction(async s => summarizeEntries(s, await readProfileQuery(s, collection.id, profile.id), [{ operation: 'count' }]))).toEqual([{ value: '0', error: null, matched: 0 }]);
  });
  it('exposes full-query totals, projection and persisted library widgets through Repository', async () => {
    f = await fixture(kind);
    const api = f.api!;
    const library = await api.createLibrary('Виджеты');
    const collection = await api.createCollection(library.id, 'Задачи', 'Название');
    const amount = await api.createField(collection.id, 'Стоимость', 'decimal');
    const status = await api.createField(collection.id, 'Этап', 'select', { options: [{ id: 'todo', label: 'План' }] });
    await api.importEntries(collection.id, Array.from({ length: 211 }, (_, index) => ({
      [collection.primary_field_id]: String(index), [amount.id]: '0.1', [status.id]: 'todo',
    })));
    await api.saveUiConfig(collection.id, 'list', {
      fields: [], list: { mode: 'kanban', mode_field: status.id },
      totals: [{ operation: 'sum', field_id: amount.id }],
    });
    expect(await api.queryTotals({ collection_id: collection.id, limit: 1 }, [
      { operation: 'sum', field_id: amount.id }, { operation: 'count' },
    ])).toEqual([
      { value: '21.1', error: null, matched: 211 },
      { value: '211', error: null, matched: 211 },
    ]);
    const projection = await api.projectCollection({ collection_id: collection.id }, { mode: 'kanban', mode_field: status.id });
    expect(projection.mode).toBe('kanban');
    if (projection.mode !== 'kanban') throw new Error('wrong projection');
    expect(projection.columns.find(column => column.value === 'todo')?.count).toBe(211);
    expect(projection.columns.find(column => column.value === 'todo')?.entries.length).toBe(20);
    const widget = { id: crypto.randomUUID(), title: ' Последние ', width: 1 as const,
      collection_id: collection.id, kind: 'table' as const, field_ids: [amount.id], limit: 3 };
    await api.saveLibrarySummary(library.id, { widgets: [widget] });
    const saved = await api.getLibrarySummary(library.id);
    expect(saved.widgets[0]?.title).toBe('Последние');
    const data = await api.readSummaryWidget(library.id, saved.widgets[0]!);
    expect(data.kind).toBe('table');
    if (data.kind !== 'table') throw new Error('wrong widget');
    expect(data.entries).toHaveLength(3);
    expect(data.entries.every(entry => entry.data[amount.id] === '0.1')).toBe(true);
  });

});
