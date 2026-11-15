import { describe, expect, it } from 'vitest';
import { fixture } from '../support/fixture';
import { crashRustDatabase } from '../support/rust-database';
import { migrate } from '../../src/core/migrate';
import { Repository } from '../../src/core/repository';
import { checkDatabaseIntegrity } from '../../src/core/sqlite-check';
import type { DatabaseAdapter } from '../../src/core/ports';

function killAfter(db: DatabaseAdapter, matches: (sql: string) => boolean): () => Promise<void> {
  const transaction = db.transaction.bind(db);
  let killed: Promise<void> | undefined;
  db.transaction = work => transaction(s => work({ ...s, execute: async (sql, params) => {
    await s.execute(sql, params);
    if (matches(sql)) {
      killed = crashRustDatabase(db); await killed;
      throw new Error('injected process death');
    }
  } }));
  return async () => { expect(killed).toBeDefined(); await killed; };
}
async function snapshot(db: DatabaseAdapter) {
  return db.read(async s => ({
    records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id'),
    changes: await s.query('SELECT * FROM change_log ORDER BY seq'), settings: await s.query('SELECT * FROM local_settings ORDER BY key'),
    meta: await s.query('SELECT * FROM app_meta ORDER BY key'), fts: await s.query('SELECT * FROM records_fts ORDER BY rowid'),
  }));
}
describe('native process death and recovery', () => {
  it('rolls an interrupted bootstrap back on disk and performs a clean retry', async () => {
    if (!process.env.TESSERA_RUST_BRIDGE) throw new Error('Run with npm run test:native-api');
    const f = await fixture('rust', false);
    try {
      const killed = killAfter(f.db, sql => sql.startsWith('CREATE TABLE creation_presets'));
      await expect(migrate(f.db)).rejects.toThrow('injected process death'); await killed();
      const reopened = await f.reopen();
      try {
        expect(await reopened.read(s => s.query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"))).toEqual([]);
        await migrate(reopened); await checkDatabaseIntegrity(reopened, true);
        const api = await Repository.open(reopened); expect(await api.listLibraries()).toEqual([]);
      } finally { await reopened.close(); }
    } finally { await f.cleanup(); }
  });
  it.each(['activation', 'compaction', 'history rotation', 'derived rebuild'] as const)('preserves the committed state after interrupted %s', async phase => {
    if (!process.env.TESSERA_RUST_BRIDGE) throw new Error('Run with npm run test:native-api');
    const f = await fixture('rust');
    try {
      const api = f.api!, library = await api.createLibrary('Crash acceptance');
      const collection = await api.createCollection(library.id, 'Entries', 'Title');
      let entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Committed' });
      if (phase === 'history rotation') for (let n = 0; n < 25; n++)
        entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Revision ' + n }, entry.id, entry.hlc);
      if (phase === 'compaction') {
        const checkpoint = await api.startLocalSync();
        await api.acknowledgeLocalChanges(crypto.randomUUID(), checkpoint);
      }
      if (phase === 'derived rebuild') await f.db.transaction(s => s.execute("UPDATE records SET sort_data='{}',search_data='{}',sort_version=0"));
      const before = await snapshot(f.db);
      const killed = killAfter(f.db, sql => phase === 'activation' ? sql.startsWith('INSERT INTO change_log') :
        phase === 'compaction' ? sql.startsWith('DELETE FROM change_log') :
        phase === 'history rotation' ? sql.startsWith('DELETE FROM record_versions') : sql.startsWith('UPDATE records SET sort_data=CASE'));
      const operation = phase === 'activation' ? api.startLocalSync() : phase === 'compaction' ? api.compactLocalChanges() :
        phase === 'history rotation' ? api.saveEntry(collection.id, { [collection.primary_field_id]: 'Uncommitted revision' }, entry.id, entry.hlc) : api.rebuildDerived();
      await expect(operation).rejects.toThrow('injected process death'); await killed();
      const reopened = await f.reopen();
      try {
        expect(await snapshot(reopened)).toEqual(before);
        await migrate(reopened); await checkDatabaseIntegrity(reopened, true);
        const again = await Repository.open(reopened);
        expect(await again.getEntry(entry.id)).toEqual(entry);
        if (phase === 'activation') await again.startLocalSync();
        if (phase === 'compaction') { await again.compactLocalChanges(); expect(await reopened.read(s => s.query('SELECT * FROM change_log'))).toEqual([]); }
        if (phase === 'history rotation') {
          await again.saveEntry(collection.id, { [collection.primary_field_id]: 'Retry' }, entry.id, entry.hlc);
          expect((await again.getHistory(entry.id)).versions).toHaveLength(20);
        }
        if (phase === 'derived rebuild') {
          expect((await again.queryEntries({ collection_id: collection.id, search: 'committed' })).items.map(row => row.id)).toEqual([entry.id]);
          expect(await reopened.read(s => s.query('SELECT * FROM record_versions ORDER BY id'))).toEqual(before.versions);
        }
      } finally { await reopened.close(); }
    } finally { await f.cleanup(); }
  });
});
