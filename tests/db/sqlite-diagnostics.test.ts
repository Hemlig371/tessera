import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { checkDatabaseIntegrity, checkSqlite } from '../../src/core/sqlite-check';

describe.each(adapters)('%s SQLite diagnostics', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('detects foreign-key corruption missed by quick_check without leaking user values', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Private data');
    const collection = await api.createCollection(library.id, 'Записи', 'Название');
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'private user content' });
    await checkDatabaseIntegrity(f.db); await checkDatabaseIntegrity(f.db, true);
    await f.db.read(async s => {
      await s.execute('PRAGMA foreign_keys=OFF');
      try { await s.execute('UPDATE records SET collection_id=? WHERE id=?', [crypto.randomUUID(), entry.id]); }
      finally { await s.execute('PRAGMA foreign_keys=ON'); }
    });
    await checkSqlite(f.db);
    await expect(checkDatabaseIntegrity(f.db)).rejects.toThrow(/^databaseCorrupt$/);
    await expect(checkDatabaseIntegrity(f.db, true)).rejects.toThrow(/^databaseCorrupt$/);
    expect((await f.db.read(s => s.query('SELECT * FROM records WHERE id=?', [entry.id])))).toHaveLength(1);
  });
});
