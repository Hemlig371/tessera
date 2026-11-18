import { describe, expect, it } from 'vitest';
import { localDateLiteral, relativeDateInterval, shiftLocalDate } from '../../src/core/relative-dates';
import { treeProjection } from '../../src/core/tree-projection';

const row = (id: string, parent: string | null = null) => ({ id, data: { parent } });
describe('M3 local relative dates', () => {
  it('uses literal local dates, Monday boundaries and leap years without UTC conversion', () => {
    const sunday = new Date(2026, 10, 22, 23, 59);
    expect(localDateLiteral(sunday)).toBe('2026-11-22');
    expect(relativeDateInterval('week', sunday)).toEqual({ start: '2026-11-16', end: '2026-11-23' });
    expect(relativeDateInterval('today', new Date(2026, 11, 31, 0, 1))).toEqual({ start: '2026-12-31', end: '2027-01-01' });
    expect(shiftLocalDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(() => shiftLocalDate('2026-11-17',Number.MAX_SAFE_INTEGER)).toThrow('invalidDate');
    expect(shiftLocalDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftLocalDate('0099-12-31', 1)).toBe('0100-01-01');
    expect(() => shiftLocalDate('2023-02-29', 1)).toThrow('invalidDate');
  });
  it('re-evaluates the interval for a new local day/week rather than persisting an absolute date', () => {
    expect(relativeDateInterval('week', new Date(2026, 10, 23))).toEqual({ start: '2026-11-23', end: '2026-11-30' });
    expect(relativeDateInterval('today', new Date(2026, 10, 18))).toEqual({ start: '2026-11-18', end: '2026-11-19' });
  });
});
describe('M3 generic tree projection', () => {
  it('keeps source sibling order, filtered/missing parents and descendants visible without mutation', () => {
    const source = [row('child', 'root'), row('root'), row('orphan', 'filtered'), row('second', 'root')], before = structuredClone(source);
    expect(treeProjection(source, 'parent').map(n => [n.entry.id, n.depth, n.missing_parent])).toEqual([['root', 0, false], ['child', 1, false], ['second', 1, false], ['orphan', 0, true]]);
    expect(source).toEqual(before);
  });
  it('exposes cycles and cuts a deterministic edge, including self references', () => {
    const source = [row('c', 'b'), row('b', 'a'), row('a', 'c'), row('self', 'self'), row('leaf', 'c')];
    for (const input of [source, [...source].reverse()]) {
      const result = treeProjection(input, 'parent');
      expect(result).toHaveLength(5); expect(result.filter(n => n.cycle).map(n => n.entry.id).sort()).toEqual(['a','b','c','self']);
      expect(result.find(n => n.entry.id === 'a')!.parent_id).toBeNull();
      expect(result.find(n => n.entry.id === 'leaf')!.depth).toBe(3);
    }
  });
  it('traverses 50,000 nested records without overflowing the JavaScript stack', () => {
    const source = Array.from({ length: 50_000 }, (_, i) => row(String(i), i ? String(i - 1) : null));
    const result = treeProjection(source, 'parent'); expect(result).toHaveLength(50_000); expect(result.at(-1)!.depth).toBe(49_999);
    expect(() => treeProjection([row('a'), row('a')], 'parent')).toThrow('invalidData');
    expect(() => treeProjection([{ id: 'a', data: { parent: ['b'] } }], 'parent')).toThrow('invalidRelation');
  });
});
