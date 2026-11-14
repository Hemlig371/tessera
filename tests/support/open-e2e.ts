import { SerialDatabase } from '../../src/platform/serial-database';
import type { SqlRow, SqlSession, SqlValue } from '../../src/core/ports';
async function request<T>(op: string, sql?: string, params?: readonly SqlValue[]): Promise<T> {
  const response = await fetch('/__test-sqlite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, sql, params }) });
  const result = await response.json() as { error?: string; value: T };
  if (!response.ok || result.error) throw new Error(result.error);
  return result.value;
}
export async function openDatabase() {
  const session: SqlSession = {
    query: <T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []) => request<T[]>('query', sql, params),
    execute: (sql, params) => request('execute', sql, params),
    begin: () => request('begin'), commit: () => request('commit'), rollback: () => request('rollback'),
    backup: () => request('backup'), close: async () => { /* test server owns the connection across reloads */ },
  };
  return new SerialDatabase(session);
}
