import { describe, expect, it } from 'vitest';
import { canonical, localTimestamp } from '../../src/core/model';
import ru from '../../src/locales/ru.json';
import en from '../../src/locales/en.json';
describe('model and localization', () => {
  it('serializes objects consistently without rounding text values', () => {
    expect(canonical({ z: null, a: { n: '0.12345', b: true } })).toBe('{"a":{"b":true,"n":"0.12345"},"z":null}');
    expect(() => canonical({ n: NaN })).toThrow('invalidData');
  });
  it('keeps author-local time literal, separate from UTC', () => {
    const date = new Date(2026, 10, 14, 12, 34, 56, 7);
    expect(localTimestamp(date)).toBe('2026-11-14T12:34:56.007');
  });
  it('has matching Russian and English keys including errors', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ru.errors).sort()).toEqual(Object.keys(en.errors).sort());
  });
});
