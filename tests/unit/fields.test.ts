import { describe, expect, it } from 'vitest';
import { validateValue, validDate } from '../../src/core/validation';
import { textSortKey, searchTerms } from '../../src/core/search-keys';
describe('field semantics and Russian search keys', () => {
  it('retains false and zero as required values and rejects unsafe integers', () => {
    expect(() => validateValue('boolean', false, { required: true })).not.toThrow();
    expect(() => validateValue('integer', 0, { required: true })).not.toThrow();
    expect(() => validateValue('integer', Number.MAX_SAFE_INTEGER + 1, {})).toThrow('invalidInteger');
    expect(() => validateValue('boolean', '', {})).toThrow('invalidBoolean');
  });
  it('validates Gregorian literal dates including leap years', () => {
    expect(validDate('2024-02-29')).toBe(true);
    expect(validDate('2023-02-29')).toBe(false);
    expect(validDate('2026-04-31')).toBe(false);
    expect(validDate('2026-01-01T00:00:00Z')).toBe(false);
  });
  it('sorts normalized Russian text with ё after е, independently of SQLite NOCASE', () => {
    const words = ['Яблоко', 'Жук', 'Ёж', 'Еда', 'Аист'];
    expect(words.sort((a, b) => textSortKey(a).localeCompare(textSortKey(b), 'en'))).toEqual([
      'Аист',
      'Еда',
      'Ёж',
      'Жук',
      'Яблоко',
    ]);
    expect(textSortKey('Е\u0308Ж')).toBe(textSortKey('ёж'));
  });
  it('turns user search into quoted Unicode prefixes rather than FTS operators', () => {
    expect(searchTerms('ЗАПИСЬ OR "*"')).toEqual(['"запись"*', '"or"*']);
    expect(searchTerms(' ; * ')).toEqual([]);
  });
});
