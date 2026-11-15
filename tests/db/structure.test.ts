import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { fieldIndexName } from '../../src/core/search-keys';

describe.each(adapters)('%s stage 2 structure', (kind) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => {
    await f?.cleanup();
  });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!,
      library = await api.createLibrary('Личное');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    return { api, library, collection };
  }
  it('renames and orders metadata without rewriting field UUIDs or record values', async () => {
    const { api, library, collection } = await setup();
    const field = await api.createField(collection.id, 'Количество', 'integer');
    const entry = await api.saveEntry(collection.id, {
      [collection.primary_field_id]: 'Вещь',
      [field.id]: 0,
    });
    await api.updateLibrary(library.id, {
      name: 'Дом',
      position: 2,
      appearance: { icon: '⌂', color: '#126c5d' },
    });
    await api.updateCollection(collection.id, { name: 'Склад', position: 1 });
    await api.updateField(field.id, { name: 'Остаток', position: 0 });
    expect((await api.listFields(collection.id)).find((x) => x.id === field.id)?.name).toBe('Остаток');
    expect(await api.getEntry(entry.id)).toEqual(entry);
    expect((await api.listLibraries())[0]?.name).toBe('Дом');
    expect(
      (await f.db.read((s) => s.query<{ n: number }>('SELECT count(*) AS n FROM record_versions')))[0]?.n
    ).toBe(1);
  });
  it('validates five field types, defaults, integer bounds and literal dates', async () => {
    const { api, collection } = await setup();
    const notes = await api.createField(collection.id, 'Описание', 'multiline');
    const flag = await api.createField(collection.id, 'Готово', 'boolean', {
      required: true,
      default: false,
    });
    const count = await api.createField(collection.id, 'Число', 'integer', { min: 0, max: 5, default: 0 });
    const day = await api.createField(collection.id, 'Дата', 'date');
    const entry = await api.saveEntry(collection.id, {
      [collection.primary_field_id]: 'A',
      [notes.id]: 'Строка\nТекст',
      [day.id]: '2024-02-29',
    });
    expect(entry.data).toMatchObject({ [flag.id]: false, [count.id]: 0, [day.id]: '2024-02-29' });
    for (const [fieldId, value, error] of [
      [flag.id, 'false', 'invalidBoolean'],
      [count.id, 1.5, 'invalidInteger'],
      [count.id, 6, 'outOfRange'],
      [day.id, '2023-02-29', 'invalidDate'],
    ] as const) {
      await expect(api.saveEntry(collection.id, { [fieldId]: value }, entry.id, (await api.getEntry(entry.id))!.hlc)).rejects.toThrow(error);
    }
    await expect(
      api.createField(collection.id, 'Сломано', 'date', { default: '2026-13-01' })
    ).rejects.toThrow('invalidDate');
    expect(await api.getEntry(entry.id)).toEqual(entry);
  });
  it('keeps removed field values and restores them, with no automatic type conversion', async () => {
    const { api, collection } = await setup();
    const field = await api.createField(collection.id, 'Старое поле', 'text');
    const entry = await api.saveEntry(collection.id, {
      [collection.primary_field_id]: 'A',
      [field.id]: '00123',
    });
    await expect(api.updateField(field.id, { type: 'integer' })).rejects.toThrow('fieldTypeChange');
    await expect(api.setDeleted('field', collection.primary_field_id, true)).rejects.toThrow(
      'protectedField'
    );
    await api.setDeleted('field', field.id, true);
    expect((await api.listFields(collection.id)).some((x) => x.id === field.id)).toBe(false);
    const changed = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'B' }, entry.id, (await api.getEntry(entry.id))!.hlc);
    expect(changed.data[field.id]).toBe('00123');
    await api.setDeleted('field', field.id, false);
    expect((await api.listFields(collection.id)).some((x) => x.id === field.id)).toBe(true);
    expect((await api.getEntry(entry.id))?.data[field.id]).toBe('00123');
  });
  it('hides deleted parents and records and reverses deletion without losing identity', async () => {
    const { api, library, collection } = await setup();
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'A' });
    for (const [kind, id] of [
      ['record', entry.id],
      ['collection', collection.id],
      ['library', library.id],
    ] as const) {
      await api.setDeleted(kind, id, true);
      expect(await api.getEntry(entry.id)).toBeNull();
      await api.setDeleted(kind, id, false);
      expect((await api.getEntry(entry.id))?.id).toBe(entry.id);
    }
    expect(
      (await f.db.read((s) => s.query<{ n: number }>('SELECT count(*) AS n FROM record_versions')))[0]?.n
    ).toBe(1);
  });
  it('stores independent form/card/list configurations and uses form defaults/required rules', async () => {
    const { api, collection } = await setup();
    const field = await api.createField(collection.id, 'Число', 'integer');
    const form = {
      fields: [{ field_id: field.id, visible: true, required: true, default: 3, hint: 'От 0' }],
    };
    await api.saveUiConfig(collection.id, 'form', form);
    await api.saveUiConfig(collection.id, 'card', { fields: [{ field_id: field.id, visible: false }] });
    expect(await api.getUiConfig(collection.id, 'form')).toEqual(form);
    expect(await api.getUiConfig(collection.id, 'list')).toEqual({ fields: [], list: { mode: 'rows' } });
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'A' });
    expect(entry.data[field.id]).toBe(3);
    await expect(api.saveEntry(collection.id, { [field.id]: null }, entry.id, (await api.getEntry(entry.id))!.hlc)).rejects.toThrow(
      'requiredField'
    );
    await expect(
      api.saveUiConfig(collection.id, 'form', {
        fields: [{ field_id: collection.primary_field_id, visible: false }],
      })
    ).rejects.toThrow('primaryMustBeVisible');
    await expect(
      api.saveUiConfig(collection.id, 'form', {
        fields: [{ field_id: field.id, visible: false, required: true }],
      })
    ).rejects.toThrow('hiddenRequiredField');
  });
  it('creates JSON expression indexes manually and for persistent list requirements', async () => {
    const { api, collection } = await setup();
    const field = await api.createField(collection.id, 'Количество', 'integer', { indexed: true });
    const exists = () =>
      f.db.read((s) =>
        s.query('SELECT name FROM sqlite_master WHERE type=? AND name=?', ['index', fieldIndexName(field.id)])
      );
    expect(await exists()).toHaveLength(1);
    await api.saveUiConfig(collection.id, 'list', {
      fields: [],
      list: { sort_field: field.id, direction: 'asc' },
    });
    await api.updateField(field.id, { config: { indexed: false } });
    expect(await exists()).toHaveLength(1);
    await api.saveUiConfig(collection.id, 'list', { fields: [] });
    expect(await exists()).toHaveLength(0);
  });
  it('rolls metadata, configuration and journal back together', async () => {
    const { api, library, collection } = await setup();
    await api.startLocalSync();
    await f.db.read((s) =>
      s.execute(
        "CREATE TRIGGER reject_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'failure'); END"
      )
    );
    await expect(api.updateLibrary(library.id, { name: 'Новое' })).rejects.toThrow('failure');
    await expect(api.createField(collection.id, 'Поле', 'integer')).rejects.toThrow('failure');
    await expect(api.saveUiConfig(collection.id, 'list', { fields: [] })).rejects.toThrow('failure');
    expect((await api.listLibraries())[0]?.name).toBe('Личное');
    expect(await api.listFields(collection.id)).toHaveLength(1);
    expect(await f.db.read((s) => s.query('SELECT * FROM ui_configs'))).toHaveLength(0);
  });
});
