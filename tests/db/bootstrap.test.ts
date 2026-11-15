import { afterEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { adapters, fixture } from '../support/fixture';
import { migrate } from '../../src/core/migrate';
import { bootstrapStatements, schemaId } from '../../src/core/schema';
import { Repository } from '../../src/core/repository';

describe.each(adapters)('%s pre-release bootstrap', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('creates the complete current schema once without historical upgrades or an empty backup', async () => {
    f = await fixture(kind);
    expect(await f.db.read(s => s.query("SELECT name FROM sqlite_master WHERE name='schema_migrations'"))).toEqual([]);
    expect(await f.db.read(s => s.query("SELECT value FROM app_meta WHERE key='schema_id'"))).toEqual([{ value: schemaId }]);
    expect((await readdir(f.directory)).filter(name => name.includes('backup'))).toEqual([]);
    const api = f.api!, library = await api.createLibrary('Сохранить');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const field = await api.createField(collection.id, 'Цель', 'relation', { target_collection_id: collection.id });
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Ёж', [crypto.randomUUID()]: { keep: [false, 0] } });
    await api.saveEntry(collection.id, { [field.id]: entry.id }, entry.id, entry.hlc);
    await api.saveQuickForm(collection.id, { fields: [{ field_id: collection.primary_field_id, visible: true }] });
    await api.startLocalSync();
    const tables = ['app_meta', 'local_settings', 'records', 'record_versions', 'change_log', 'relation_index', 'display_profiles', 'quick_forms'];
    const snapshot = () => f.db.read(async s => Object.fromEntries(await Promise.all(tables.map(async table => [table, await s.query(`SELECT * FROM ${table}`)]))));
    const before = await snapshot();
    await Promise.all([migrate(f.db), migrate(f.db)]);
    expect(await snapshot()).toEqual(before);
    const finalEntry = await api.getEntry(entry.id);
    await f.db.close(); const reopened = await f.reopen();
    try {
      await migrate(reopened); const again = await Repository.open(reopened);
      expect(again.datasetId).toBe(api.datasetId); expect(again.deviceId).toBe(api.deviceId);
      expect(await again.getEntry(entry.id)).toEqual(finalEntry);
      expect(await reopened.read(s => s.query('PRAGMA foreign_key_check'))).toEqual([]);
    } finally { await reopened.close(); }
  });
  it('preserves Android-owned metadata and serializes simultaneous first starts', async () => {
    f = await fixture(kind, false);
    await f.db.read(s => s.execute('CREATE TABLE android_metadata(locale TEXT)'));
    await f.db.read(s => s.execute("INSERT INTO android_metadata VALUES('ru_RU')"));
    await Promise.all([migrate(f.db), migrate(f.db)]);
    expect(await f.db.read(s => s.query('SELECT * FROM android_metadata'))).toEqual([{ locale: 'ru_RU' }]);
    expect(await f.db.read(s => s.query('SELECT * FROM app_meta'))).toHaveLength(3);
  });
  it.each(['CREATE TABLE records(', 'CREATE VIRTUAL TABLE records_fts', 'CREATE TABLE relation_index', 'CREATE TABLE creation_presets', 'INSERT INTO app_meta'])('rolls back an interrupted bootstrap at %s and retries cleanly', async failing => {
    f = await fixture(kind, false); const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = work => transaction(s => work({ ...s, execute: async (sql, params) => {
      if (sql.startsWith(failing)) throw new Error('bootstrap failure');
      return s.execute(sql, params);
    } }));
    await expect(migrate(f.db)).rejects.toThrow('bootstrap failure');
    expect(await f.db.read(s => s.query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"))).toEqual([]);
    f.db.transaction = transaction; await migrate(f.db);
    expect(await f.db.read(s => s.query("SELECT value FROM app_meta WHERE key='schema_id'"))).toEqual([{ value: schemaId }]);
  });
  it.each(['schema_id', 'schema_checksum', 'format_version'])('rejects unsupported %s without altering data', async key => {
    f = await fixture(kind); await f.api!.createLibrary('Не удалять');
    const libraries = await f.api!.listLibraries();
    await f.db.transaction(s => s.execute('UPDATE app_meta SET value=? WHERE key=?', ['future-or-altered', key]));
    const before = await f.db.read(s => s.query('SELECT * FROM app_meta ORDER BY key'));
    await expect(migrate(f.db)).rejects.toThrow('unsupportedSchema');
    expect(await f.api!.listLibraries()).toEqual(libraries);
    expect(await f.db.read(s => s.query('SELECT * FROM app_meta ORDER BY key'))).toEqual(before);
  });
  it('rejects intermediate dev schemas and foreign data instead of upgrading or deleting them', async () => {
    f = await fixture(kind, false);
    await f.db.transaction(async s => {
      await s.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT, applied_at TEXT)');
      await s.execute("INSERT INTO schema_migrations VALUES(7,'dev-checksum','2026-11-15')");
      await s.execute('CREATE TABLE personal_data(content TEXT)');
      await s.execute("INSERT INTO personal_data VALUES('Сохранить неизвестную структуру')");
    });
    await expect(migrate(f.db)).rejects.toThrow('unsupportedSchema');
    expect(await f.db.read(s => s.query('SELECT * FROM personal_data'))).toEqual([{ content: 'Сохранить неизвестную структуру' }]);
    expect(await f.db.read(s => s.query('SELECT * FROM schema_migrations'))).toHaveLength(1);
    expect(await f.db.read(s => s.query("SELECT name FROM sqlite_master WHERE name='app_meta'"))).toEqual([]);
  });
  it('contains only current DDL, with no ALTER or historical conversion statements', () => {
    expect(bootstrapStatements.every(sql => sql.startsWith('CREATE '))).toBe(true);
  });
});
