import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SerialDatabase } from '../../src/platform/serial-database';
import type { SqlSession, SqlRow, SqlValue } from '../../src/core/ports';

export function openRustDatabase(executable: string, path: string) {
  const child = spawn(executable, [path], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };
  const pending: Pending[] = [];
  let failed: Error | undefined;
  const fail = (error: Error) => { failed = error; pending.splice(0).forEach(p => p.reject(error)); };
  child.on('error', fail);
  child.on('exit', code => { if (code !== 0) fail(new Error(`Rust SQLite driver exited: ${code}`)); });
  lines.on('line', line => {
    const result = JSON.parse(line) as { value: unknown; error?: string };
    const request = pending.shift();
    if (result.error) request?.reject(new Error(result.error)); else request?.resolve(result.value);
  });
  function send<T>(op: string, sql = '', params: readonly SqlValue[] = [], backup?: string): Promise<T> {
    if (failed) return Promise.reject(failed);
    return new Promise((resolve, reject) => {
      pending.push({ resolve: v => resolve(v as T), reject });
      child.stdin.write(JSON.stringify({ op, sql, params, path: backup }) + '\n');
    });
  }
  const session: SqlSession = {
    query: <T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []) => send<T[]>('query', sql, params),
    execute: (sql, params = []) => send('execute', sql, params),
    begin: () => send('begin'), commit: () => send('commit'), rollback: () => send('rollback'),
    backup: () => send('backup', '', [], `${path}.backup-${crypto.randomUUID()}.sqlite`),
    close: async () => {
      const exit = new Promise<void>((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Rust exit ${code}`))); });
      child.stdin.end(); await exit; lines.close();
    },
  };
  return new SerialDatabase(session);
}
