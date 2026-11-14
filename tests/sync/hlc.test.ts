import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { nextHlc } from '../../src/core/hlc';
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
describe('sync foundation: HLC (no transport/protocol implemented)', () => {
  it('is monotonic with repeated and backwards wall clocks', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 2_000_000_000_000 }), { minLength: 1, maxLength: 100 }), times => {
      let last: string | undefined;
      for (const time of times) { const next = nextHlc(a, time, last); if (last) expect(next > last).toBe(true); last = next; }
    }), { numRuns: 200 });
  });
  it('observes another device even far into the future without arbitrary clock rejection', () => {
    const remote = nextHlc(b, 8_000_000_000_000);
    const local = nextHlc(a, 1, undefined, remote);
    expect(local > remote).toBe(true);
    expect(nextHlc(a, 0, local) > local).toBe(true);
  });
  it('uses device id as a deterministic tie-break and rejects malformed clocks', () => {
    expect(nextHlc(b, 42) > nextHlc(a, 42)).toBe(true);
    expect(() => nextHlc(a, -1)).toThrow('invalidHlc');
    expect(() => nextHlc(a, 2, 'broken')).toThrow('invalidHlc');
  });
});
