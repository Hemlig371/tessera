import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';

describe.each(adapters)('%s quick forms', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!;
    const library = await api.createLibrary('Быстрые формы');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const number = await api.createField(collection.id, 'Количество', 'integer', { required: true, default: 0 });
    const check = await api.createField(collection.id, 'Готово', 'boolean', { default: false });
    const text = await api.createField(collection.id, 'Заметка', 'multiline');
    await api.saveUiConfig(collection.id, 'form', { fields: [
      { field_id: collection.primary_field_id, visible: true, hint: 'Название' },
      { field_id: number.id, visible: true, default: 7 },
    ] });
    return { api, collection, number, check, text };
  }
  it('reads without writes, inherits form defaults, saves one explicit version, and keeps other layouts independent', async () => {
    const { api, collection, number, check } = await setup();
    const before = await f.db.read(s => s.query('SELECT * FROM change_log'));
    const quick = await api.getQuickForm(collection.id);
    expect(quick.fields.filter(i => i.visible).map(i => i.field_id)).toEqual([collection.primary_field_id]);
    expect(await f.db.read(s => s.query('SELECT * FROM change_log'))).toEqual(before);
    await api.startLocalSync();
    await api.saveQuickForm(collection.id, quick);
    const row = await api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Быстро' });
    expect(row.data).toMatchObject({ [number.id]: 7, [check.id]: false });
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=?', [row.id]))).toHaveLength(1);
    const form = await api.getUiConfig(collection.id, 'form');
    const logs = await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='quick_form'"));
    expect(logs).toHaveLength(1);
    await api.saveQuickForm(collection.id, quick);
    expect(await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='quick_form'"))).toEqual(logs);
    expect(await api.getUiConfig(collection.id, 'form')).toEqual(form);
    await f.db.close();
    const db = await f.reopen();
    try { const again = await Repository.open(db); expect(await again.getQuickForm(collection.id)).toEqual(quick); expect(await again.getEntry(row.id)).toEqual(row); }
    finally { await db.close(); }
  });
  it('rejects hidden required fields and revalidates saved quick forms after schema/default changes', async () => {
    const { api, collection, number } = await setup();
    const quick = await api.getQuickForm(collection.id);
    await expect(api.saveQuickForm(collection.id, { fields: [] })).rejects.toThrow('hiddenRequiredField');
    await api.saveQuickForm(collection.id, quick);
    const required = await api.createField(collection.id, 'Обязательное', 'text', { required: true });
    const clock = await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='hlc'"));
    await expect(api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Не сохранится' })).rejects.toThrow('hiddenRequiredField');
    expect(await f.db.read(s => s.query('SELECT * FROM records'))).toEqual([]);
    expect(await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='hlc'"))).toEqual(clock);
    await api.saveQuickForm(collection.id, { fields: [...quick.fields, { field_id: required.id, visible: true }] });
    await expect(api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Нет обязательного' })).rejects.toThrow('requiredField');
    const saved = await api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Есть', [required.id]: 'ok', [number.id]: 0 });
    expect(saved.data[number.id]).toBe(0);
  });
  it('rolls config and record saves back together with their HLC/journal when a final write fails', async () => {
    const { api, collection } = await setup();
    await api.startLocalSync();
    const before = await f.db.read(s => s.query('SELECT * FROM change_log'));
    await f.db.read(s => s.execute("CREATE TRIGGER fail_quick_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'quick failure'); END"));
    await expect(api.saveQuickForm(collection.id, await api.getQuickForm(collection.id))).rejects.toThrow('quick failure');
    expect(await f.db.read(s => s.query('SELECT * FROM quick_forms'))).toEqual([]);
    await expect(api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Нет' })).rejects.toThrow('quick failure');
    expect(await f.db.read(s => s.query('SELECT * FROM records'))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions'))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM change_log'))).toEqual(before);
  });
});
