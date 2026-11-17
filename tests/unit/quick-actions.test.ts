import { describe, expect, it } from 'vitest';
import { quickControls, quickValue } from '../../src/core/quick-actions';
import type { Field, FieldConfig } from '../../src/core/model';

const field = (type: string, config: FieldConfig = {}) => ({ type, config: JSON.stringify(config) }) as Field;
describe('typed quick actions', () => {
  it('changes Decimal counters exactly and keeps required false and zero', () => {
    expect(quickValue(field('decimal', { step: '0.2' }), '0.1', { kind: 'increment', direction: 1 })).toBe('0.3');
    expect(quickValue(field('integer', { required: true }), 1, { kind: 'increment', direction: -1 })).toBe(0);
    expect(quickValue(field('boolean', { required: true }), true, { kind: 'toggle' })).toBe(false);
    expect(quickValue(field('boolean'), null, { kind: 'toggle' })).toBe(true);
  });
  it('refuses overflow, invalid field types and numeric limits', () => {
    expect(() => quickValue(field('integer'), Number.MAX_SAFE_INTEGER, { kind: 'increment', direction: 1 })).toThrow('invalidInteger');
    expect(() => quickValue(field('decimal'), '92233720368547.75807', { kind: 'increment', direction: 1 })).toThrow('decimalOverflow');
    expect(() => quickValue(field('duration'), '0', { kind: 'increment', direction: -1 })).toThrow('outOfRange');
    expect(() => quickValue(field('integer', { max: 5 }), 5, { kind: 'increment', direction: 1 })).toThrow('outOfRange');
    for (const type of ['secret', 'formula', 'aggregate', 'file', 'relation', 'text']) {
      expect(quickControls(field(type))).toEqual([]);
      expect(() => quickValue(field(type), null, { kind: 'set', value: 'unsafe' })).toThrow('invalidQuickAction');
    }
  });
  it('sets stable choice IDs and validates set values', () => {
    const option = { id: crypto.randomUUID(), label: 'Готово' }, status = field('select', { options: [option] });
    expect(quickValue(status, null, { kind: 'set', value: option.id })).toBe(option.id);
    expect(() => quickValue(status, null, { kind: 'set', value: crypto.randomUUID() })).toThrow('invalidChoice');
    expect(() => quickValue(field('integer'), 0, { kind: 'set', value: '1' })).toThrow('invalidInteger');
  });
});
