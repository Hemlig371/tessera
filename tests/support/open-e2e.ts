import { SerialDatabase } from '../../src/platform/serial-database';
import type { DatabaseAdapter, SqlRow, SqlSession, SqlValue } from '../../src/core/ports';
async function request<T>(client_id: string, op: string, sql?: string, params?: readonly SqlValue[]): Promise<T> {
  const response = await fetch('/__test-sqlite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id, op, sql, params }) });
  const result = await response.json() as { error?: string; value: T };
  if (!response.ok || result.error) throw new Error(result.error);
  return result.value;
}
export async function openDatabase(): Promise<DatabaseAdapter> {
  const client = crypto.randomUUID();
  const call = <T>(op: string, sql?: string, params?: readonly SqlValue[]) => request<T>(client, op, sql, params);
  const disconnect = () => { navigator.sendBeacon('/__test-sqlite', JSON.stringify({ client_id: client, op: 'close' })); };
  window.addEventListener('pagehide', disconnect, { once: true });
  const session: SqlSession = {
    query: <T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []) => call<T[]>('query', sql, params),
    execute: (sql, params) => call<void>('execute', sql, params),
    begin: () => call<void>('begin'), commit: () => call<void>('commit'), rollback: () => call<void>('rollback'),
    backup: () => call<void>('backup'), close: async () => { window.removeEventListener('pagehide', disconnect); await call<void>('close'); },
  };
  const queue = new SerialDatabase(session);
  return {
    read: work => queue.read(async s => { await call<void>('read-begin'); try { return await work(s); } finally { await call<void>('read-end'); } }),
    transaction: work => queue.transaction(work), backup: () => queue.backup(), close: () => queue.close(),
  };
}
