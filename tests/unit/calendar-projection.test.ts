import { describe, expect, it } from 'vitest';
import { CalendarProjection, monthGrid } from '../../src/core/calendar-projection';
import type { EntryListItem, JsonValue } from '../../src/core/model';
const row = (id: string, date: JsonValue) => ({ id, title: id, data: { date } } as unknown as EntryListItem);
describe('M3 local calendar projection', () => {
  it('builds Monday-first literal month grids across leap years and year boundaries', () => {
    expect(monthGrid('2024-02')).toHaveLength(42);
    expect(monthGrid('2024-02')).toContain('2024-02-29');
    expect(monthGrid('2026-11')[0]).toBe('2026-10-26');
    expect(monthGrid('2027-01')[0]).toBe('2026-12-28');
    expect(() => monthGrid('2026-13')).toThrow('invalidDate');
  });
  it('counts all events while bounding preview memory and preserving local datetime dates', () => {
    const calendar = new CalendarProjection({ id: 'date', type: 'local_datetime' }, '2026-11', 2);
    for (let i = 0; i < 501; i++) calendar.add(row(String(i), '2026-11-17T00:01:00.123'));
    calendar.add(row('empty', null)); calendar.add(row('outside', '2026-01-01T00:00'));
    const day = calendar.days.find(day => day.date === '2026-11-17')!;
    expect(day.count).toBe(501); expect(day.entries.map(entry => entry.id)).toEqual(['0','1']);
    expect(calendar.days.filter(day => day.count)).toHaveLength(1);
  });
  it('clips inclusive ranges to the grid without iterating years or omitting the last day', () => {
    const calendar = new CalendarProjection({ id: 'date', type: 'date_range' }, '2026-11');
    calendar.add(row('all', { start: '2000-01-01', end: '2099-12-31' }));
    calendar.add(row('three', { start: '2026-11-17', end: '2026-11-19' }));
    expect(calendar.days.every(day => day.count >= 1)).toBe(true);
    expect(calendar.days.filter(day => day.count === 2).map(day => day.date)).toEqual(['2026-11-17','2026-11-18','2026-11-19']);
    expect(() => calendar.add(row('invalid', { start: '2026-11-19', end: '2026-11-17' }))).toThrow('invalidDateRange');
  });
  it('uses calculated date values and exposes their errors instead of turning them into empty days', () => {
    const calendar = new CalendarProjection({ id: 'computed',type: 'formula',config: JSON.stringify({ result_type: 'date' }) },'2026-11');
    calendar.add({ ...row('formula',null),computed: { computed: { value: '2026-11-17',error: null,dynamic: false } } });
    expect(calendar.days.find(day => day.date === '2026-11-17')!.count).toBe(1);
    expect(() => calendar.add({ ...row('error',null),computed: { computed: { value: null,error: 'divisionByZero',dynamic: false } } })).toThrow('divisionByZero');
  });

});
