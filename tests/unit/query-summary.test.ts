import { describe, expect, it } from 'vitest';
import { QuerySummary, type SummaryOperation } from '../../src/core/query-summary';
import type { Entry, Field } from '../../src/core/model';
const field = (type = 'decimal', config = '{}') => ({ id: 'value', type, config } as Field);
const entry = (value: Entry['data'][string]) => ({ data: { value } });
const summary = (operation: SummaryOperation, values: Entry['data'][string][]) => {
  const accumulator = new QuerySummary({ operation, field_id: 'value' }, [field()]);
  for (const value of values) accumulator.add(entry(value));
  return accumulator.result();
};
describe('M3 all-query summary accumulator', () => {
  it('retains exact values across pages and rounds once at the result boundary', () => {
    const accumulator = new QuerySummary({ operation: 'sum', field_id: 'value' }, [field()]);
    for (let page = 0; page < 501; page++) for (let row = 0; row < 100; row++) accumulator.add(entry('0.00001'));
    expect(accumulator.result()).toEqual({ value: '0.501', matched: 50_100, error: null });
    expect(summary('sum', ['90071992547.12345','0.00001']).value).toBe('90071992547.12346');
    expect(summary('average', ['1','0','0']).value).toBe('0.33333');
  });
  it('ignores NULL, counts zero and keeps empty sum/count/average semantics', () => {
    expect(summary('count', [null,'0','2']).value).toBe('2');
    expect(summary('average', [null,'0','2']).value).toBe('1');
    expect(summary('sum', []).value).toBe('0'); expect(summary('count', []).value).toBe('0');
    expect(summary('average', []).value).toBeNull(); expect(summary('min', []).value).toBeNull();
    expect(summary('min', ['10','-2','0']).value).toBe('-2'); expect(summary('max', ['10','-2','0']).value).toBe('10');
    const count = new QuerySummary({ operation: 'count' }, []); count.add(entry(null)); expect(count.result().value).toBe('1');
    const counta = new QuerySummary({ operation: 'counta', field_id: 'value' }, [field('boolean')]);
    for (const value of [null,false,true]) counta.add(entry(value)); expect(counta.result().value).toBe('2');
  });
  it('keeps exact formula intermediates and exposes errors instead of silently showing zero', () => {
    const aggregate = new QuerySummary({ operation: 'sum', field_id: 'value' }, [field('formula')]);
    const computed = { value: '0.33333', error: null, dynamic: false, exact: { numerator: '1', denominator: '3' } };
    for (let i = 0; i < 3; i++) aggregate.add({ data: {}, computed: { value: computed } });
    expect(aggregate.result().value).toBe('1');
    aggregate.add({ data: {}, computed: { value: { value: null, error: 'divisionByZero', dynamic: false } } });
    expect(aggregate.result()).toEqual({ value: null, error: 'divisionByZero', matched: 4 });
    expect(() => new QuerySummary({ operation: 'sum', field_id: 'value' }, [field('secret')])).toThrow('invalidSecret');
    expect(() => new QuerySummary({ operation: 'sum', field_id: 'value' }, [field('text')])).toThrow('invalidFilter');
    expect(() => new QuerySummary({ operation: 'counta' }, [])).toThrow('invalidFilter');
  });
});
