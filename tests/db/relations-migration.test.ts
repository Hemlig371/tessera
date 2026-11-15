import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { fixture, adapters } from '../support/fixture';
import { migrations } from '../../src/core/schema';
import { migrate } from '../../src/core/migrate';
import { Repository } from '../../src/core/repository';
import { canonical, localTimestamp } from '../../src/core/model';
import type { JsonValue } from '../../src/core/model';
import { nextHlc } from '../../src/core/hlc';

describe.each(adapters)('%s v2 → v3 migration', (kind) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => {
    await f?.cleanup();
  });
  it('preserves a released v2 database and rolls a partially applied v3 back before retrying', async () => {
    f = await fixture(kind, false);
    const library = crypto.randomUUID(),
      collection = crypto.randomUUID(),
      field = crypto.randomUUID(),
      id = crypto.randomUUID(),
      unknown = crypto.randomUUID(),
      device = crypto.randomUUID();
    const now = new Date(),
      time = now.toISOString(),
      hlc = nextHlc(device, now.getTime());
    const stamp = { hlc, device_id: device, deleted_at: null, created_at: time, updated_at: time };
    const row = {
      ...stamp,
      id,
      collection_id: collection,
      data: { [field]: 'Сохранить 🦔', [unknown]: { keep: [false, 0] } },
      created_local: localTimestamp(now),
      updated_local: localTimestamp(now),
      purged: 0,
    };
    const snapshot = canonical(row),
      version = crypto.randomUUID(),
      event = crypto.randomUUID();
    await f.db.transaction(async (s) => {
      for (const migration of migrations.slice(0, 2))
        for (const sql of migration.statements) await s.execute(sql);
      await s.execute(
        'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)'
      );
      for (const m of migrations.slice(0, 2))
        await s.execute('INSERT INTO schema_migrations VALUES(?,?,?)', [
          m.version,
          createHash('sha256').update(m.statements.join('\n')).digest('hex'),
          time,
        ]);
      await s.execute("INSERT INTO app_meta VALUES('format_version','1')");
      const insert = async (table: string, value: Record<string, JsonValue>) =>
        s.execute(
          `INSERT INTO ${table}(${Object.keys(value).join(',')}) VALUES(${Object.keys(value)
            .map(() => '?')
            .join(',')})`,
          Object.values(value) as (string | number | null)[]
        );
      await insert('libraries', { ...stamp, id: library, name: 'Версия 2', config: '{}', position: 0 });
      await insert('collections', {
        ...stamp,
        id: collection,
        library_id: library,
        name: 'Коллекция',
        primary_field_id: field,
        incoming_field_id: field,
        config: '{}',
        position: 0,
      });
      await insert('fields', {
        ...stamp,
        id: field,
        collection_id: collection,
        name: 'Название',
        type: 'text',
        config: '{"required":true}',
        position: 0,
      });
      await insert('records', {
        ...row,
        data: canonical(row.data),
        sort_version: 0,
        sort_data: '{}',
        search_data: '{}',
      });
      await s.execute('INSERT INTO record_versions VALUES(?,?,?,?,?,?)', [
        version,
        id,
        hlc,
        device,
        time,
        snapshot,
      ]);
      await s.execute(
        'INSERT INTO change_log(id,entity_type,entity_id,hlc,device_id,payload) VALUES(?,?,?,?,?,?)',
        [event, 'record', id, hlc, device, snapshot]
      );
    });
    const original = f.db.transaction.bind(f.db);
    f.db.transaction = (work) =>
      original((s) =>
        work({
          ...s,
          execute: async (sql, params) => {
            if (sql.startsWith('CREATE TABLE relation_index')) throw new Error('v3 failure');
            return s.execute(sql, params);
          },
        })
      );
    await expect(migrate(f.db)).rejects.toThrow('v3 failure');
    expect(await f.db.read((s) => s.query('SELECT * FROM schema_migrations'))).toHaveLength(2);
    expect(
      (await f.db.read((s) => s.query<{ name: string }>('PRAGMA table_info(records)'))).some(
        (r) => r.name === 'relation_version'
      )
    ).toBe(false);
    f.db.transaction = original;
    await migrate(f.db);
    const api = await Repository.open(f.db);
    expect(await api.getEntry(id)).toEqual(row);
    expect(
      (await f.db.read((s) => s.query<{ snapshot: string }>('SELECT snapshot FROM record_versions')))[0]
        ?.snapshot
    ).toBe(snapshot);
    expect(
      (await f.db.read((s) => s.query<{ payload: string }>('SELECT payload FROM change_log')))[0]?.payload
    ).toBe(snapshot);
    const relation = await api.createField(collection, 'Своя запись', 'relation', {
      target_collection_id: collection,
    });
    await api.saveEntry(collection, { [relation.id]: id }, id);
    expect((await api.getRelationPage(id, relation.id)).items[0]?.id).toBe(id);
    expect((await api.getEntry(id))?.data[unknown]).toEqual({ keep: [false, 0] });
  });
});
