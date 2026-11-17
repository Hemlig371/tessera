import type { DatabaseImportStage } from '../../src/platform/database-import';
import { SerialDatabase } from '../../src/platform/serial-database';
export async function archiveRequest<T>(op: string, args: object = {}): Promise<T> {
  const response = await fetch('/__test-archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...args }) });
  const result = await response.json() as { value: T; error?: string };
  if (!response.ok || result.error) throw new Error(result.error ?? 'fileError'); return result.value;
}
export async function createDatabaseImportStage(): Promise<DatabaseImportStage> {
  await archiveRequest('prepare');
  const db = new SerialDatabase({
    query: (sql, params = []) => archiveRequest('query', { sql, params }), execute: (sql, params = []) => archiveRequest('execute', { sql, params }),
    begin: () => archiveRequest('begin'), commit: () => archiveRequest('commit'), rollback: () => archiveRequest('rollback'), close: () => archiveRequest('close'),
    backup: async () => { throw new Error('not used'); },
  });
  return { db, files: {
    begin: id => archiveRequest('file-begin', { id }),
    write: (id, offset, bytes) => { let data = ''; for (let at = 0; at < bytes.length; at += 8192) data += String.fromCharCode(...bytes.subarray(at, at + 8192)); return archiveRequest('file-write', { id, offset, data: btoa(data) }); },
    finish: (id, size, sha256) => archiveRequest('file-finish', { id, size, sha256 }),
  }, activate: async () => { await db.close(); await archiveRequest('activate'); }, abort: async () => { await db.close(); await archiveRequest('abort'); } };
}
