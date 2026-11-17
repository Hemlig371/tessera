import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SqlSession, SqlRow, SqlValue } from '../core/ports';
import { SerialDatabase } from './serial-database';

export async function openAndroidDatabase(databaseName = 'app'): Promise<SerialDatabase> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection(databaseName, false, 'no-encryption', 1, false);
  await db.open();
  await db.execute('PRAGMA foreign_keys=ON;', false);
  await db.query('PRAGMA journal_mode=WAL;');
  // This assignment returns a row. Android rejects it through execSQL/execute.
  await db.query('PRAGMA busy_timeout=5000;');
  await db.execute('PRAGMA synchronous=FULL;', false);
  const { url } = await db.getUrl();
  if (!url) throw new Error('databaseUnavailable');
  const path = url.startsWith('file:') ? decodeURIComponent(new URL(url).pathname) : url;
  const directory = path.slice(0, path.lastIndexOf('/'));
  if (!directory.startsWith('/')) throw new Error('databaseUnavailable');
  const session: SqlSession = {
    query: async <T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> => {
      const result = await db.query(sql, [...params]);
      // Android returns plain objects. Other plugin platforms can add a column header row;
      // those platforms are deliberately not used by this adapter.
      return (result.values ?? []) as T[];
    },
    execute: async (sql, params = []) => {
      // transaction=false avoids the plugin's extra wrapper. Never introduce its
      // last_modified/sql_deleted columns: those enable plugin-owned sync rewriting.
      await db.run(sql, [...params], false);
    },
    begin: async () => { await db.beginTransaction(); },
    commit: async () => { await db.commitTransaction(); },
    rollback: async () => { await db.rollbackTransaction(); },
    backup: async () => {
      // Private sibling of the database, never the process working directory.
      await db.run('VACUUM INTO ?', [`${directory}/migration-${crypto.randomUUID()}.sqlite`], false);
    },
    close: async () => { await sqlite.closeConnection(databaseName, false); },
  };
  return new SerialDatabase(session);
}
