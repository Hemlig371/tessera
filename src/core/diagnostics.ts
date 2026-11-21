import { AppError } from './errors';
import type { DatabaseAdapter } from './ports';
import { checkDatabaseIntegrity } from './sqlite-check';

export interface SafeDiagnosticReport {
  format: 'tessera-diagnostic-v1';
  generated_at: string;
  sqlite_version: string;
  journal_mode: string;
  foreign_keys: boolean;
  integrity: 'ok' | 'corrupt';
  page_count: number;
  freelist_count: number;
  app_schema: string;
}

/** Read-only, allowlisted diagnostics; never include rows, field names, record payloads or secrets. */
export async function safeDiagnosticReport(db: DatabaseAdapter, now: Date = new Date()): Promise<SafeDiagnosticReport> {
  if (!Number.isFinite(now.getTime())) throw new AppError('invalidDate');
  const info = await db.read(async session => {
    const [version] = await session.query<{ value: string }>('SELECT sqlite_version() AS value');
    const [mode] = await session.query<{ journal_mode: string }>('PRAGMA journal_mode');
    const [foreign] = await session.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    const [pages] = await session.query<{ page_count: number }>('PRAGMA page_count');
    const [free] = await session.query<{ freelist_count: number }>('PRAGMA freelist_count');
    const [schema] = await session.query<{ value: string }>("SELECT value FROM app_meta WHERE key='schema_version'");
    return { version: version?.value ?? '', mode: mode?.journal_mode ?? '',
      foreign: foreign?.foreign_keys === 1, pages: pages?.page_count, free: free?.freelist_count,
      schema: schema?.value ?? '' };
  });
  if (!/^\d+\.\d+\.\d+$/.test(info.version) || !['wal', 'delete', 'truncate', 'persist', 'memory', 'off'].includes(info.mode) ||
    !Number.isSafeInteger(info.pages) || info.pages! < 0 || !Number.isSafeInteger(info.free) || info.free! < 0 ||
    info.free! > info.pages! || info.schema.length > 128) throw new AppError('databaseCorrupt');
  let integrity: 'ok' | 'corrupt' = 'ok';
  try { await checkDatabaseIntegrity(db, true); }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'databaseCorrupt') throw error;
    integrity = 'corrupt';
  }
  return { format: 'tessera-diagnostic-v1', generated_at: now.toISOString(),
    sqlite_version: info.version, journal_mode: info.mode, foreign_keys: info.foreign,
    integrity, page_count: info.pages!, freelist_count: info.free!, app_schema: info.schema };
}

export function serializeDiagnosticReport(report: SafeDiagnosticReport): string {
  return JSON.stringify(report, null, 2) + '\n';
}
