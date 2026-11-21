import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { checkDatabaseIntegrity, checkSqlite } from '../../src/core/sqlite-check';
import { safeDiagnosticReport, serializeDiagnosticReport } from '../../src/core/diagnostics';

describe.each(adapters)('%s SQLite diagnostics', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('exports only allowlisted operational health and never record content', async () => {
    f = await fixture(kind);
    const api = f.api!, library = await api.createLibrary('confidential library');
    const collection = await api.createCollection(library.id, 'private collection', 'title');
    await api.saveEntry(collection.id, { [collection.primary_field_id]: 'sensitive content token' });
    const report = await safeDiagnosticReport(f.db, new Date('2026-11-21T00:00:00Z'));
    expect(report.format).toBe('tessera-diagnostic-v1');
    expect(report.integrity).toBe('ok');
    expect(report.app_schema).toBe('tessera-dev-bootstrap-2');
    const text = serializeDiagnosticReport(report);
    expect(text).not.toContain('confidential library');
    expect(text).not.toContain('private collection');
    expect(text).not.toContain('sensitive content token');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'app_schema', 'format', 'foreign_keys', 'freelist_count', 'generated_at',
      'integrity', 'journal_mode', 'page_count', 'sqlite_version',
    ]);
  });
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
