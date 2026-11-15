import { expect, it } from 'vitest';
import { fixture } from '../support/fixture';
import { crashRustDatabase } from '../support/rust-database';

it('recovers committed data after the native SQLite process is killed inside an unfinished import', async () => {
  if (!process.env.TESSERA_RUST_BRIDGE) throw new Error('Run this contract with npm run test:native-api');
  const f = await fixture('rust');
  try {
    const api = f.api!, library = await api.createLibrary('Process interruption');
    const collection = await api.createCollection(library.id, 'Import', 'Title');
    await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Keep committed' });
    const snapshot = (db: typeof f.db) => db.read(async s => ({ records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id'),
      changes: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"), fts: await s.query('SELECT * FROM records_fts ORDER BY rowid') }));
    const before = await snapshot(f.db);
    let killed: Promise<void> | undefined;
    await expect(api.importEntries(collection.id, Array.from({ length: 5000 }, (_, index) => ({ [collection.primary_field_id]: 'Uncommitted ' + index })), count => {
      if (count === 120) { killed = crashRustDatabase(f.db); throw new Error('intentional process interruption'); }
    })).rejects.toThrow('intentional process interruption');
    expect(killed).toBeDefined(); await killed;
    const reopened = await f.reopen();
    try { expect(await snapshot(reopened)).toEqual(before); expect(await reopened.read(s => s.query('PRAGMA integrity_check'))).toEqual([{ integrity_check: 'ok' }]); }
    finally { await reopened.close(); }
  } finally { await f.cleanup(); }
});
