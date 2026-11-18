import { describe, expect, it } from 'vitest';
import { GroupedSummary } from '../../src/core/grouped-summary';
import type { Field } from '../../src/core/model';
const field = (id: string, type: string) => ({ id, type, config: '{}' } as Field);
describe('M3 grouped whole-query summaries', () => {
  it('keeps zero, false, unassigned and stable IDs in different groups and sums exact decimals', () => {
    const groups = new GroupedSummary('state',{ operation: 'sum', field_id: 'amount' },[field('state','select'),field('amount','decimal')]);
    for (const state of [null, false, 0, 'uuid']) for (let i = 0; i < 3; i++) groups.add({ data: { state, amount: '0.1' } });
    expect(groups.result().map(group => [group.value,group.result.value,group.result.matched])).toEqual([[null,'0.3',3],[false,'0.3',3],[0,'0.3',3],['uuid','0.3',3]]);
  });
  it('groups literal local datetimes by Monday week/month and rejects secrets even on empty input', () => {
    const fields = [field('date','local_datetime')], weeks = new GroupedSummary('date',{ operation: 'count' },fields,'week');
    for (const date of ['2026-11-22T23:59','2026-11-23T00:01']) weeks.add({ data: { date } });
    expect(weeks.result().map(group => group.value)).toEqual(['2026-11-16','2026-11-23']);
    const months = new GroupedSummary('date',{ operation: 'count' },fields,'month');
    months.add({ data: { date: '2026-12-01T00:00' } }); expect(months.result()[0]!.value).toBe('2026-12');
    expect(() => new GroupedSummary('secret',{ operation: 'count' },[field('secret','secret')])).toThrow('invalidFilter');
  });
});
