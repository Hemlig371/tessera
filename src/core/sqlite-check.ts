import type { DatabaseAdapter } from './ports';
import { AppError } from './errors';

/** Cheap, blocking startup acceptance. Extensive write probes live only in tests. */
export async function checkSqlite(db: DatabaseAdapter): Promise<string> {
  return db.read(async s => {
    const [info] = await s.query<{ version: string; valid: number; extracted: number; fts: number }>(
      `SELECT sqlite_version() AS version, json_valid('{"ok":1}') AS valid,
       json_extract('{"ok":1}', '$.ok') AS extracted, sqlite_compileoption_used('ENABLE_FTS5') AS fts`);
    const [wal] = await s.query<{ journal_mode: string }>('PRAGMA journal_mode');
    const [fk] = await s.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    if (!info || info.valid !== 1 || info.extracted !== 1 || info.fts !== 1 ||
        wal?.journal_mode !== 'wal' || fk?.foreign_keys !== 1) throw new AppError('sqliteUnsupported');
    const [integrity] = await s.query<{ quick_check: string }>('PRAGMA quick_check(1)');
    if (integrity?.quick_check !== 'ok') throw new AppError('databaseCorrupt');
    return info.version;
  });
}

/** Explicit diagnostics/import acceptance. Startup retains the inexpensive quick probe. */
export async function checkDatabaseIntegrity(db: DatabaseAdapter, full = false): Promise<void> {
  await db.read(async s => {
    const rows = await s.query<Record<string, string>>(full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check');
    if (rows.length !== 1 || Object.values(rows[0]!)[0] !== 'ok') throw new AppError('databaseCorrupt');
    if ((await s.query('PRAGMA foreign_key_check')).length) throw new AppError('databaseCorrupt');
  });
}
