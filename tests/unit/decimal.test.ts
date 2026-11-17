import { describe, expect, it } from 'vitest';
import { Decimal, decimalKey, formatDecimal, normalizeDecimal } from '../../src/core/decimal';

describe('exact decimals', () => {
  it('keeps intermediate fractions exact until the display/save boundary', () => {
    expect(Decimal.parse('0.1').add(Decimal.parse('0.2')).toString()).toBe('0.3');
    expect(Decimal.parse('1').divide(Decimal.parse('3')).multiply(Decimal.parse('3')).toString()).toBe('1');
    expect(Decimal.parse('9876543210123.45678').add(Decimal.parse('0.00001')).toString()).toBe('9876543210123.45679');
  });
  it.each([['1.234565', '1.23457'], ['-1.234565', '-1.23457'], ['0.000005', '0.00001'], ['-0.000004', '0'], ['00012.340000', '12.34'], ['.5', '0.5'], ['+2.', '2']])('normalizes %s using half-up at five places', (input, result) => {
    expect(normalizeDecimal(input)).toBe(result);
  });
  it('rejects overflow rather than changing storage type or losing digits', () => {
    expect(normalizeDecimal('92233720368547.75807')).toBe('92233720368547.75807');
    expect(() => normalizeDecimal('92233720368547.758075')).toThrow('decimalOverflow');
    expect(() => normalizeDecimal('-92233720368547.75808')).toThrow('decimalOverflow');
    for (const text of ['1e20', 'NaN', 'Infinity', '1,2', ' ', '1'.repeat(257)]) expect(() => Decimal.parse(text)).toThrow('invalidDecimal');
    expect(() => Decimal.parse('1').divide(Decimal.parse('0'))).toThrow('divisionByZero');
  });
  it('orders negative, zero, long and fractional values with exact SQLite TEXT keys', () => {
    const ordered = ['-92233720368547.75807', '-12', '-0.00001', '0', '0.00001', '2', '10', '92233720368547.75807'];
    expect([...ordered].reverse().sort((a, b) => decimalKey(a).localeCompare(decimalKey(b)))).toEqual(ordered);
  });
  it('formats money independently of its normalized stored precision', () => {
    expect(formatDecimal('9876543210123.45678', 'en', 2)).toBe('9,876,543,210,123.46');
    expect(formatDecimal('-1.005', 'en', 2)).toBe('-1.01');
    expect(formatDecimal('-0.5', 'en', 2)).toBe('-0.50');
    expect(Decimal.parse('2.5').round(0).toString()).toBe('3');
  });
});
