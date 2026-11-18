import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { dateSelectionCondition, selectionInterval, freezeDateSelection } from '../../src/core/date-selection';

describe.each(adapters)('%s M3 literal local date selection', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('includes minute/second precision at midnight and overlapping inclusive ranges without UTC shifts', async () => {
    f = await fixture(kind, false);
    await f.db.transaction(async s => {
      await s.execute('CREATE TABLE dates(id TEXT PRIMARY KEY, value TEXT)');
      for (const [id,value] of [['previous','2026-11-16T23:59:59.999'],['minute','2026-11-17T00:00'],['second','2026-11-17T00:00:00.000'],['last','2026-11-17T23:59:59.999'],['next','2026-11-18T00:00']]) await s.execute('INSERT INTO dates VALUES(?,?)',[id!,value!]);
    });
    const definition = { field_id: 'date',period: 'today' as const };
    const frozen = freezeDateSelection(definition,new Date(2026,10,17,23,59));
    expect(selectionInterval(frozen,new Date(2026,10,18,0,1))).toEqual({ start: '2026-11-17',end: '2026-11-18' });
    expect(definition.period).toBe('today');
    const interval = selectionInterval({ field_id: 'date', period: 'today' }, new Date(2026,10,17,23,59));
    const condition = dateSelectionCondition({ type: 'local_datetime', config: '{}' },'value',interval);
    expect(await f.db.read(s => s.query<{ id: string }>('SELECT id FROM dates WHERE '+condition.sql+' ORDER BY id',condition.params))).toEqual([{ id: 'last' },{ id: 'minute' },{ id: 'second' }]);
    await f.db.transaction(async s => {
      await s.execute('DELETE FROM dates');
      for (const [id,start,end] of [['ends-today','2026-11-01','2026-11-17'],['starts-today','2026-11-17','2026-11-30'],['past','2026-11-01','2026-11-16'],['next','2026-11-18','2026-11-30']]) await s.execute('INSERT INTO dates VALUES(?,?)',[id!,JSON.stringify({ start,end })]);
    });
    const range = dateSelectionCondition({ type: 'date_range', config: '{}' },'value',interval);
    expect(await f.db.read(s => s.query<{ id: string }>('SELECT id FROM dates WHERE '+range.sql+' ORDER BY id',range.params))).toEqual([{ id: 'ends-today' },{ id: 'starts-today' }]);
    expect(selectionInterval({ field_id: 'date', period: 'range', start: '2024-02-28', end: '2024-02-29' })).toEqual({ start: '2024-02-28', end: '2024-03-01' });
    expect(() => dateSelectionCondition({ type: 'secret', config: '{}' },'value',interval)).toThrow('invalidFilter');
  });
});
