import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { freezeQueryDates, queryEntries } from '../../src/core/queries';
import { localDateLiteral, shiftLocalDate } from '../../src/core/relative-dates';
import type { EntryQuery } from '../../src/core/model';

describe.each(adapters)('%s profile date filters', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('persists relative profiles, filters before pagination, rejects yesterday’s cursor and freezes whole-query reads', async () => {
    f = await fixture(kind); const api = f.api!, lib = await api.createLibrary('Даты'), c = await api.createCollection(lib.id, 'Дни', 'Название');
    const date = await api.createField(c.id, 'Дата', 'date');
    await api.importEntries(c.id, Array.from({ length: 211 }, (_, i) => ({ [c.primary_field_id]: String(i), [date.id]: '2026-11-17' })));
    await api.saveEntry(c.id, { [c.primary_field_id]: 'Завтра', [date.id]: '2026-11-18' });
    const today = await api.createDisplayProfile(c.id, 'Сегодня', { fields: [], list: { date_selection: { field_id: date.id, period: 'today' } } });
    await api.updateDisplayProfile(today.id, { make_default: true });
    expect(JSON.parse(today.config).list.date_selection).toEqual({ field_id: date.id, period: 'today' });
    const before = await f.db.read(async s => ({ rows: await s.query('SELECT id,data,hlc FROM records ORDER BY id'), history: await s.query('SELECT * FROM record_versions ORDER BY id') }));
    const now = new Date(2026,10,17,23,59), nextDay = new Date(2026,10,18,0,1);
    await f.db.transaction(async s => {
      const query: EntryQuery = { collection_id: c.id, limit: 200 };
      const page = await queryEntries(s, query, now);
      expect(page.items).toHaveLength(200); expect(page.next).not.toBeNull();
      expect((await queryEntries(s, { ...query, cursor: page.next }, now)).items).toHaveLength(11);
      await expect(queryEntries(s, { ...query, cursor: page.next }, nextDay)).rejects.toThrow('invalidCursor');
      expect((await queryEntries(s, query, nextDay)).items.map(row => row.title)).toEqual(['Завтра']);
      const frozen = await freezeQueryDates(s, query, now);
      const first = await queryEntries(s, frozen, now);
      expect((await queryEntries(s, { ...frozen, cursor: first.next }, nextDay)).items).toHaveLength(11);
      expect((await queryEntries(s, { ...query, date_selection: null }, now)).next).not.toBeNull();
      expect((await queryEntries(s, { ...query, limit: 200, date_selection: { field_id: date.id, period: 'range', start: '2026-11-18', end: '2026-11-18' } }, now)).items.map(row => row.title)).toEqual(['Завтра']);
      const week: EntryQuery = { ...query, date_selection: { field_id: date.id, period: 'week' } };
      const w = await queryEntries(s, week, now);
      expect((await queryEntries(s, { ...week, cursor: w.next }, nextDay)).items).toHaveLength(12);
    });
    expect(await f.db.read(async s => ({ rows: await s.query('SELECT id,data,hlc FROM records ORDER BY id'), history: await s.query('SELECT * FROM record_versions ORDER BY id') }))).toEqual(before);
    const all = await api.createDisplayProfile(c.id, 'История', { fields: [], list: { date_selection: null } });
    expect((await api.queryEntries({ collection_id: c.id, profile_id: all.id, limit: 200 })).next).not.toBeNull();
  });
  it('matches local midnight, inclusive range overlap and static calculated dates; validates profile scope and dynamic indexes', async () => {
    f = await fixture(kind); const api = f.api!, lib = await api.createLibrary('Время'), c = await api.createCollection(lib.id, 'Встречи', 'Название');
    const stamp = await api.createField(c.id, 'Время', 'local_datetime');
    const range = await api.createField(c.id, 'Интервал', 'date_range');
    const formula = await api.createField(c.id, 'Вычисленная дата', 'formula', { formula: '"2026-11-17"', result_type: 'date' });
    const values = [
      ['Вчера','2026-11-16T23:59:59', '2026-11-01','2026-11-16'],
      ['Полночь','2026-11-17T00:00', '2026-11-01','2026-11-17'],
      ['Вечер','2026-11-17T23:59:59', '2026-11-17','2026-11-30'],
      ['Завтра','2026-11-18T00:00', '2026-11-18','2026-11-30'],
    ];
    for (const [name,time,start,end] of values) await api.saveEntry(c.id, { [c.primary_field_id]: name!, [stamp.id]: time!, [range.id]: { start: start!, end: end! } });
    const query: EntryQuery = { collection_id: c.id, date_selection: { field_id: stamp.id, period: 'range', start: '2026-11-17', end: '2026-11-17' } };
    expect((await api.queryEntries(query)).items.map(row => row.title).sort()).toEqual(['Вечер','Полночь']);
    expect((await api.queryEntries({ ...query, date_selection: { ...query.date_selection!, field_id: range.id } })).items.map(row => row.title).sort()).toEqual(['Вечер','Полночь']);
    expect((await api.queryEntries({ ...query, date_selection: { ...query.date_selection!, field_id: formula.id } })).items).toHaveLength(4);
    const own = await api.createField(c.id, 'Дата устройства', 'date');
    const literal = localDateLiteral();
    await api.saveEntry(c.id, { [c.primary_field_id]: 'Сейчас', [own.id]: literal });
    await api.saveEntry(c.id, { [c.primary_field_id]: 'Не сейчас', [own.id]: shiftLocalDate(literal,-1) });
    expect((await api.queryEntries({ collection_id: c.id, date_selection: { field_id: own.id, period: 'today' } })).items.map(row => row.title)).toEqual(['Сейчас']);
    for (const selection of [
      { field_id: c.primary_field_id, period: 'today' },
      { field_id: crypto.randomUUID(), period: 'today' },
      { field_id: stamp.id, period: 'range', start: '2026-11-18', end: '2026-11-17' },
      { field_id: stamp.id, period: 'month' },
    ]) await expect(api.createDisplayProfile(c.id, 'Ошибка', { fields: [], list: { date_selection: selection as NonNullable<EntryQuery['date_selection']> } })).rejects.toThrow();
    const dynamic = await api.createField(c.id, 'NOW', 'formula', { formula: 'IF(TRUE,"2026-11-17",NOW())', result_type: 'date' });
    await expect(api.createDisplayProfile(c.id, 'Динамическая', { fields: [], list: { date_selection: { field_id: dynamic.id, period: 'today' } } })).rejects.toThrow('dynamicFormulaIndex');
    await expect(api.queryEntries({ collection_id: c.id, date_selection: { field_id: dynamic.id, period: 'today' } })).rejects.toThrow('dynamicFormulaIndex');
  });
});
