import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';
import { migrations } from '../../src/core/schema';
import { migrate } from '../../src/core/migrate';
import { UUID_RE } from '../../src/core/model';

describe.each(adapters)('%s released 0.5.0 profile migration', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('backs up and upgrades populated v5 without losing UUIDs, links, history, journal, layouts or quick forms; failed DDL is retryable', async () => {
    f = await fixture(kind, false);
    await f.db.transaction(async s => {
      await s.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)');
      for (const migration of migrations.slice(0, 5)) {
        for (const statement of migration.statements) await s.execute(statement);
        await s.execute('INSERT INTO schema_migrations VALUES(?,?,?)', [migration.version, createHash('sha256').update(migration.statements.join('\n')).digest('hex'), '2026-11-15T12:00:00Z']);
      }
      await s.execute("INSERT INTO app_meta VALUES('format_version','1')");
    });
    const old = await Repository.open(f.db), library = await old.createLibrary('Выпущенная 0.5.0');
    const collection = crypto.randomUUID(), title = crypto.randomUUID(), targetCollection = crypto.randomUUID(), targetTitle = crypto.randomUUID();
    const number = crypto.randomUUID(), relation = crypto.randomUUID(), listId = crypto.randomUUID(), unknown = crypto.randomUUID();
    const form = { fields: [{ field_id: title, visible: true }, { field_id: number, visible: true, default: 0 }] };
    const card = { fields: [{ field_id: number, visible: true, width: 'half' }] };
    const list = { fields: [{ field_id: number, visible: true, width: 'half', group: 'Числа' }, { field_id: title, visible: true }],
      list: { mode: 'table', sort_field: number, direction: 'asc', group_field: number, filters: [{ field_id: number, op: 'gt', value: -1 }] } };
    // Only the historical schema setup uses SQL. Record/version/relation creation uses Repository.
    await f.db.transaction(async s => {
      const stamp = [library.hlc, library.device_id, null, library.created_at, library.updated_at];
      for (const [id, primary, name] of [[collection,title,'Записи'],[targetCollection,targetTitle,'Цели']]) {
        await s.execute('INSERT INTO collections(id,hlc,device_id,deleted_at,created_at,updated_at,library_id,name,primary_field_id,incoming_field_id) VALUES(?,?,?,?,?,?,?,?,?,?)', [id!,...stamp,library.id,name!,primary!,primary!]);
        await s.execute('INSERT INTO fields(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,type,config) VALUES(?,?,?,?,?,?,?,?,?,?)', [primary!,...stamp,id!,'Название','text','{"required":true,"fts":true}']);
      }
      await s.execute('INSERT INTO fields(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,type,config) VALUES(?,?,?,?,?,?,?,?,?,?)', [number,...stamp,collection,'Число','integer','{"default":0}']);
      await s.execute('INSERT INTO fields(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,type,config) VALUES(?,?,?,?,?,?,?,?,?,?)', [relation,...stamp,collection,'Цель','relation',JSON.stringify({ target_collection_id: targetCollection })]);
      for (const [kind, config] of [['form',form],['card',card],['list',list]] as const)
        await s.execute('INSERT INTO ui_configs(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,kind,config) VALUES(?,?,?,?,?,?,?,?,?)', [kind==='list'?listId:crypto.randomUUID(),...stamp,collection,kind,JSON.stringify(config)]);
    });
    const target = await old.saveEntry(targetCollection, { [targetTitle]: 'Цель 🦔' });
    const row = await old.saveEntry(collection, { [title]: 'Сохранить', [number]: 0, [relation]: target.id, [unknown]: { keep: [false, 0] } });
    await old.saveEntry(collection, { [title]: 'Редакция' }, row.id, row.hlc);
    await old.saveQuickForm(collection, { fields: [{ field_id: title, visible: true }] });
    const snapshot = () => f.db.read(async s => {
      const tables = ['records','record_versions','fields','ui_configs','quick_forms','relation_index','change_log','app_meta','local_settings'];
      return Object.fromEntries(await Promise.all(tables.map(async table => [table, await s.query(`SELECT * FROM ${table} ORDER BY ${table==='change_log'?'seq':table==='relation_index'?'source_record_id,field_id,target_record_id':table==='app_meta'||table==='local_settings'?'key':'id'}`)])));
    });
    const before = await snapshot(), transaction = f.db.transaction.bind(f.db);
    f.db.transaction = work => transaction(s => work({ ...s, execute: async (sql, params) => {
      if (sql.startsWith('UPDATE collections SET default_profile_id=')) throw new Error('profile migration failure');
      return s.execute(sql, params);
    } }));
    await expect(migrate(f.db)).rejects.toThrow('profile migration failure');
    expect(await snapshot()).toEqual(before);
    expect(await f.db.read(s => s.query("SELECT name FROM sqlite_master WHERE name='display_profiles'"))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM schema_migrations'))).toHaveLength(5);
    expect((await readdir(f.directory)).some(name => name.includes('.backup-'))).toBe(true);
    f.db.transaction = transaction; await migrate(f.db);
    expect(await snapshot()).toEqual(before);
    const api = await Repository.open(f.db), profiles = await api.listDisplayProfiles(collection);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: listId, config: JSON.stringify(list), hlc: library.hlc });
    expect((await api.getCollection(collection)).default_profile_id).toBe(listId);
    expect(await api.getUiConfig(collection, 'list')).toEqual(list);
    expect(await api.getUiConfig(collection, 'form')).toEqual(form);
    expect(await api.getQuickForm(collection)).toEqual({ fields: [{ field_id: title, visible: true }] });
    const [fallback] = await api.listDisplayProfiles(targetCollection);
    expect(fallback!.id).toMatch(UUID_RE); expect((await api.getCollection(targetCollection)).default_profile_id).toBe(fallback!.id);
    expect((await api.getEntry(row.id))!.data).toMatchObject({ [title]: 'Редакция', [unknown]: { keep: [false, 0] }, [relation]: target.id });
    expect(await f.db.read(s => s.query('PRAGMA foreign_key_check'))).toEqual([]);
    await migrate(f.db); expect(await api.listDisplayProfiles(collection)).toEqual(profiles);
    expect(await snapshot()).toEqual(before);
  });
});
