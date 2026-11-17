import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { fieldIndexName } from '../../src/core/search-keys';
import { type Field, type JsonValue } from '../../src/core/model';
import { csvValue } from '../../src/core/csv';

describe.each(adapters)('%s typed values', kind => {
  const opened: Awaited<ReturnType<typeof fixture>>[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.cleanup(); });
  async function setup() {
    const f = await fixture(kind); opened.push(f);
    const api = f.api!, library = await api.createLibrary('Типы'), collection = await api.createCollection(library.id, 'Значения', 'Название');
    return { f, api, collection };
  }
  it('normalizes money/Decimal and uses exact indexed keys across keyset pages and filters', async () => {
    const { f, api, collection } = await setup();
    const field = await api.createField(collection.id, 'Цена', 'money', { indexed: true, currency: '₽', precision: 2 });
    const ordered = ['-92233720368547.75807', '-10', '-0.00001', '0', '0.00001', '2', '10', '12345678901234.56789'];
    for (const [index, value] of [...ordered].reverse().entries()) await api.saveEntry(collection.id, { [collection.primary_field_id]: String(index), [field.id]: value });
    let cursor; const actual: JsonValue[] = [];
    do {
      const page = await api.queryEntries({ collection_id: collection.id, sort_field: field.id, direction: 'asc', limit: 3, cursor });
      actual.push(...page.items.map(entry => entry.data[field.id]!)); cursor = page.next;
    } while (cursor);
    expect(actual).toEqual(ordered);
    expect((await api.queryEntries({ collection_id: collection.id, sort_field: field.id, filters: [{ field_id: field.id, op: 'gt', value: '2' }] })).items.map(entry => entry.data[field.id])).toEqual(['10', '12345678901234.56789']);
    const rounded = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Half up', [field.id]: '1.234565' });
    expect(rounded.data[field.id]).toBe('1.23457');
    expect((await api.getHistory(rounded.id)).versions[0]!.snapshot.data[field.id]).toBe('1.23457');
    const [index] = await f.db.read(s => s.query<{ sql: string }>('SELECT sql FROM sqlite_master WHERE name=?', [fieldIndexName(field.id)]));
    expect(index!.sql).toContain('sort_data');
    const before = await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='hlc'"));
    await expect(api.saveEntry(collection.id, { [collection.primary_field_id]: 'Overflow', [field.id]: '92233720368547.758075' })).rejects.toThrow('decimalOverflow');
    expect(await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='hlc'"))).toEqual(before);
  });
  it('preserves choice IDs and record history when labels/order change or a choice is archived', async () => {
    const { api, collection } = await setup();
    const a = { id: crypto.randomUUID(), label: 'Первый' }, b = { id: crypto.randomUUID(), label: 'Второй' };
    const field = await api.createField(collection.id, 'Статус', 'select', { options: [a, b], indexed: true });
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Запись', [field.id]: a.id });
    const other = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Другая', [field.id]: b.id });
    const history = await api.getHistory(entry.id);
    await api.updateField(field.id, { config: { options: [{ ...b, label: 'Переименован' }, a], indexed: true } });
    expect((await api.queryEntries({ collection_id: collection.id, sort_field: field.id })).items.map(row => row.id)).toEqual([other.id, entry.id]);
    const archived = await api.updateField(field.id, { config: { options: [b] } });
    expect(JSON.parse(archived.config).options).toContainEqual({ ...a, archived: true });
    expect((await api.getEntry(entry.id))!.data[field.id]).toBe(a.id);
    expect(await api.getHistory(entry.id)).toEqual(history);
    const tags = await api.createField(collection.id, 'Теги', 'multiselect', { options: [a, b] });
    await api.saveEntry(collection.id, { [tags.id]: [a.id, b.id] }, entry.id, entry.hlc);
    expect((await api.queryEntries({ collection_id: collection.id, filters: [{ field_id: tags.id, op: 'eq', value: b.id }] })).items.map(row => row.id)).toEqual([entry.id]);
  });
  it('roundtrips literal temporal/structured values without time-zone conversion', async () => {
    const { api, collection } = await setup();
    const values: [string, JsonValue][] = [['time', '23:59:59.123'], ['local_datetime', '2026-11-17T23:59'],
      ['date_range', { start: '2024-02-29', end: '2026-11-17' }], ['duration', '90061.234565'],
      ['coordinates', { latitude: '55.755826', longitude: '37.617300' }], ['json', { nested: [false, 0, null, 'Ё'] }]];
    const fields: Field[] = [];
    for (const [type] of values) fields.push(await api.createField(collection.id, type, type));
    const data = Object.fromEntries(values.map(([, value], index) => [fields[index]!.id, value]));
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Буквально', ...data });
    expect((await api.getEntry(entry.id))!.data).toMatchObject({ ...data, [fields[3]!.id]: '90061.23457', [fields[4]!.id]: { latitude: '55.75583', longitude: '37.6173' } });
    await expect(api.saveEntry(collection.id, { [fields[1]!.id]: '2026-11-17T23:59Z' }, entry.id, entry.hlc)).rejects.toThrow('invalidTime');
    await expect(api.saveEntry(collection.id, { [fields[2]!.id]: { start: '2026-12-01', end: '2026-11-17' } }, entry.id, entry.hlc)).rejects.toThrow('invalidDateRange');
  });
  it('keeps Secret in source data while excluding it from search, indexes, defaults and list configurations', async () => {
    const { f, api, collection } = await setup();
    const secret = await api.createField(collection.id, 'Ключ', 'secret');
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Открытый заголовок', [secret.id]: 'OnlySecretNeedle' });
    const source = await api.getEntry(entry.id); expect(source!.data[secret.id]).toBe('OnlySecretNeedle');
    const derived = await f.db.read(s => s.query('SELECT search_data,sort_data FROM records WHERE id=?', [entry.id]));
    expect(JSON.stringify(derived)).not.toContain('OnlySecretNeedle');
    expect((await api.queryEntries({ collection_id: collection.id, search: 'OnlySecretNeedle' })).items).toEqual([]);
    await expect(api.updateField(secret.id, { config: { indexed: true } })).rejects.toThrow('invalidSecret');
    await expect(api.updateField(secret.id, { config: { default: 'hidden' } })).rejects.toThrow('invalidSecret');
    await expect(api.saveUiConfig(collection.id, 'list', { fields: [{ field_id: secret.id, visible: true }] })).rejects.toThrow('invalidSecret');
    await expect(api.createCreationPreset(collection.id, 'Secret template', { form: 'standard', data: { [secret.id]: 'hidden' }, today_fields: [] })).rejects.toThrow('invalidPreset');
  });
  it('parses locale-specific Decimal CSV without binary rounding or ambiguous separators', async () => {
    const { api, collection } = await setup(), field = await api.createField(collection.id, 'Число', 'decimal');
    expect(csvValue('12 345,123456', field, 'ru')).toBe('12345.12346');
    expect(csvValue('12,345.123456', field, 'en')).toBe('12345.12346');
    expect(() => csvValue('12,34.5', field, 'en')).toThrow('invalidDecimal');
  });
});
