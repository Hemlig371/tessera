import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import type { SqlSession } from '../core/ports';
import { SerialDatabase } from './serial-database';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await nativeInvoke<T>(command, args); } catch (error) { throw error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'databaseUnavailable'); }
}
export async function openTauriDatabase(): Promise<SerialDatabase> {
  await invoke('db_open');
  const session: SqlSession = {
    query: (sql, params = []) => invoke('db_query', { sql, params }),
    execute: (sql, params = []) => invoke('db_execute', { sql, params }),
    begin: () => invoke('db_begin'), commit: () => invoke('db_commit'), rollback: () => invoke('db_rollback'),
    backup: () => invoke('db_backup'), close: () => invoke('db_close'),
  };
  return new SerialDatabase(session);
}
