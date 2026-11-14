import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SerialDatabase } from '../../src/platform/serial-database';
import type { SqlSession, SqlRow, SqlValue } from '../../src/core/ports';

/** Dev/CI only: native Node SQLite, never part of Vite's production graph. */
export async function openNodeDatabase(path: string) {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  const session: SqlSession = {
    query: async <T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    execute: async (sql, params = []) => { db.prepare(sql).run(...params); },
    begin: async () => { db.exec('BEGIN IMMEDIATE'); },
    commit: async () => { db.exec('COMMIT'); },
    rollback: async () => { db.exec('ROLLBACK'); },
    backup: async () => { db.prepare('VACUUM INTO ?').run(`${path}.backup-${crypto.randomUUID()}.sqlite`); },
    close: async () => { db.close(); },
  };
  return new SerialDatabase(session);
}
