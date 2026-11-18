import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { readSummaryWidget } from '../../src/core/summary-data';
import type { SummaryWidget } from '../../src/core/library-summary';

describe.each(adapters)('%s M3 summary data', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('combines profile and widget filters over the full query while mini-lists keep their explicit limit', async () => {
    f = await fixture(kind); const api = f.api!,library = await api.createLibrary('Сводка'),collection = await api.createCollection(library.id,'Записи','Название');
    const amount = await api.createField(collection.id,'Сумма','decimal'), date = await api.createField(collection.id,'Дата','date');
    await api.importEntries(collection.id,Array.from({ length: 411 },(_,i) => ({ [collection.primary_field_id]: String(i),[amount.id]: String(i),[date.id]: '2026-11-17' })));
    const profile = await api.createDisplayProfile(collection.id,'Большие',{ fields: [],list: { filters: [{ field_id: amount.id,op: 'gt',value: '200' }],sort_field: amount.id } });
    const base = { id: crypto.randomUUID(),title: 'Метрика',width: 1 as const,collection_id: collection.id,profile_id: profile.id,filters: [{ field_id: amount.id,op: 'lt' as const,value: '205' }] };
    const read = (widget: SummaryWidget) => f.db.transaction(s => readSummaryWidget(s,library.id,widget,'2026-11'));
    expect(await read({ ...base,kind: 'metric',formula: `SUM([${amount.id}])` })).toEqual({ kind: 'metric',value: '810' });
    const list = await read({ ...base,kind: 'table',field_ids: [amount.id],limit: 2 });
    if (list.kind !== 'table') throw new Error('wrong widget');
    expect(list.entries.map(entry => entry.data[amount.id])).toEqual(['201','202']);
    const chart = await read({ ...base,kind: 'chart',group_field: date.id,group_period: 'day',measure: { operation: 'sum',field_id: amount.id },style: 'bar' });
    if (chart.kind !== 'chart') throw new Error('wrong widget');
    expect(chart.groups[0]!.result).toEqual({ value: '810',error: null,matched: 4 });
    const calendar = await read({ ...base,kind: 'calendar',calendar_field: date.id });
    if (calendar.kind !== 'calendar') throw new Error('wrong widget');
    expect(calendar.days.find(day => day.date === '2026-11-17')!.count).toBe(4);
  });
});
