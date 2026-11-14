import { invoke } from '@tauri-apps/api/core';
import type { SqlSession } from '../core/ports';
import { SerialDatabase } from './serial-database';

export function openTauriDatabase(): SerialDatabase {
  const session: SqlSession = {
    query: (sql, params = []) => invoke('db_query', { sql, params }),
    execute: (sql, params = []) => invoke('db_execute', { sql, params }),
    begin: () => invoke('db_begin'), commit: () => invoke('db_commit'), rollback: () => invoke('db_rollback'),
    backup: () => invoke('db_backup'), close: () => invoke('db_close'),
  };
  return new SerialDatabase(session);
}
