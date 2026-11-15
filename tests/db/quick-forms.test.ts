import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';
import { migrate } from '../../src/core/migrate';
import { migrations } from '../../src/core/schema';
import { createHash } from 'node:crypto';

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
    await api.saveQuickForm(collection.id, quick);
    const row = await api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Быстро' });
    expect(row.data).toMatchObject({ [number.id]: 7, [check.id]: false });
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=?', [row.id]))).toHaveLength(1);
    const form = await api.getUiConfig(collection.id, 'form');
    const logs = await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='ui_config'"));
    await api.saveQuickForm(collection.id, quick);
    expect(await f.db.read(s => s.query("SELECT * FROM change_log WHERE entity_type='ui_config'"))).toEqual(logs);
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
    const before = await f.db.read(s => s.query('SELECT * FROM change_log'));
    await f.db.read(s => s.execute("CREATE TRIGGER fail_quick_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'quick failure'); END"));
    await expect(api.saveQuickForm(collection.id, await api.getQuickForm(collection.id))).rejects.toThrow('quick failure');
    expect(await f.db.read(s => s.query('SELECT * FROM quick_forms'))).toEqual([]);
    await expect(api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'Нет' })).rejects.toThrow('quick failure');
    expect(await f.db.read(s => s.query('SELECT * FROM records'))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions'))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM change_log'))).toEqual(before);
  });
  it('upgrades a populated v4 database without changing existing UI, IDs, history or journal; retries failed DDL', async () => {
    f = await fixture(kind, false);
    await f.db.transaction(async s => {
      await s.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)');
      for (const m of migrations.slice(0, 4)) {
        for (const sql of m.statements) await s.execute(sql);
        await s.execute('INSERT INTO schema_migrations VALUES(?,?,?)', [m.version, createHash('sha256').update(m.statements.join('\n')).digest('hex'), new Date().toISOString()]);
      }
      await s.execute("INSERT INTO app_meta VALUES('format_version','1')");
    });
    const old = await Repository.open(f.db), library = await old.createLibrary('v4');
    // Released v4 has no profile columns/tables: prepare that historical shape explicitly.
    const collection = { id: crypto.randomUUID(), primary_field_id: crypto.randomUUID() };
    await f.db.transaction(async s => {
      const stamp = [library.hlc, library.device_id, null, library.created_at, library.updated_at];
      await s.execute('INSERT INTO collections(id,hlc,device_id,deleted_at,created_at,updated_at,library_id,name,primary_field_id,incoming_field_id) VALUES(?,?,?,?,?,?,?,?,?,?)', [collection.id,...stamp,library.id,'Сохранить',collection.primary_field_id,collection.primary_field_id]);
      await s.execute("INSERT INTO fields(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,type) VALUES(?,?,?,?,?,?,?,?,?)", [collection.primary_field_id,...stamp,collection.id,'Название','text']);
      await s.execute('INSERT INTO ui_configs(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,kind,config) VALUES(?,?,?,?,?,?,?,?,?)', [crypto.randomUUID(),...stamp,collection.id,'form',JSON.stringify({ fields: [{ field_id: collection.primary_field_id, visible: true }] })]);
    });
    const entry = await old.saveEntry(collection.id, { [collection.primary_field_id]: '0.4.0' });
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records'), ui: await s.query('SELECT * FROM ui_configs'),
      versions: await s.query('SELECT * FROM record_versions'), logs: await s.query('SELECT * FROM change_log ORDER BY seq'), meta: await s.query('SELECT * FROM app_meta ORDER BY key') }));
    const before = await snapshot(), transaction = f.db.transaction.bind(f.db);
    f.db.transaction = work => transaction(s => work({ ...s, execute: async (sql, params) => {
      if (sql.startsWith('CREATE TABLE quick_forms')) throw new Error('quick DDL failure');
      return s.execute(sql, params);
    } }));
    await expect(migrate(f.db)).rejects.toThrow('quick DDL failure');
    expect(await snapshot()).toEqual(before);
    f.db.transaction = transaction;
    await migrate(f.db);
    expect(await snapshot()).toEqual(before);
    const api = await Repository.open(f.db);
    expect(await api.getEntry(entry.id)).toEqual(entry);
    await api.saveQuickEntry(collection.id, { [collection.primary_field_id]: 'После обновления' });
  });
});
