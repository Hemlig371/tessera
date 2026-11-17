import { expect, it } from 'vitest';
import { fixture } from '../support/fixture';
import { crashRustDatabase } from '../support/rust-database';
import { exportDatabaseArchive, importDatabaseArchive } from '../../src/core/database-archive';
import { checkDatabaseIntegrity } from '../../src/core/sqlite-check';

it.each(['export', 'import'])('preserves the original dataset after real SQLite process death during archive %s', async phase => {
  if (!process.env.TESSERA_RUST_BRIDGE) throw new Error('Run with npm run test:native-api');
  const source = await fixture('rust'), target = await fixture('rust', false);
  try {
    const api = source.api!, library = await api.createLibrary('Archive crash'), collection = await api.createCollection(library.id, 'Original', 'Title');
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Keep committed' });
    const chunks: Uint8Array[] = []; let finished = false, aborted = false, killed: Promise<void> | undefined;
    const writer = { write: async (bytes: Uint8Array) => { chunks.push(bytes); }, finish: async () => { finished = true; }, abort: async () => { aborted = true; } };
    if (phase === 'export') {
      await expect(exportDatabaseArchive(source.db, source.files, writer, () => {
        killed = crashRustDatabase(source.db); throw new Error('injected native export death');
      })).rejects.toThrow('injected native export death');
      expect(aborted).toBe(true); expect(finished).toBe(false);
    } else {
      await exportDatabaseArchive(source.db, source.files, writer);
      const bytes = Uint8Array.from(Buffer.concat(chunks)), transaction = target.db.transaction.bind(target.db);
      target.db.transaction = work => transaction(s => work({ ...s, execute: async (sql, params) => {
        await s.execute(sql, params);
        if (sql.startsWith('INSERT INTO records(')) { killed = crashRustDatabase(target.db); await killed; throw new Error('injected native import death'); }
      } }));
      await expect(importDatabaseArchive({ name: 'crash.zip', mime: 'application/zip', size: bytes.length,
        read: async (offset, size) => bytes.slice(offset, offset + size) }, target.db, target.files)).rejects.toThrow('injected native import death');
    }
    expect(killed).toBeDefined(); await killed;
    const original = phase === 'export' ? await source.reopen() : source.db;
    try {
      await checkDatabaseIntegrity(original, true);
      expect(await original.read(s => s.query('SELECT id,hlc,data FROM records'))).toEqual([{ id: entry.id, hlc: entry.hlc, data: JSON.stringify(entry.data) }]);
      expect((await original.read(s => s.query('SELECT id FROM record_versions'))).length).toBe(1);
    } finally { if (original !== source.db) await original.close(); }
    if (phase === 'import') {
      const reopened = await target.reopen();
      try { await checkDatabaseIntegrity(reopened, true); expect(await reopened.read(s => s.query('SELECT * FROM libraries'))).toEqual([]); }
      finally { await reopened.close(); }
    }
  } finally { await source.cleanup(); await target.cleanup(); }
});
