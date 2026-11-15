import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SerialDatabase } from '../../src/platform/serial-database';
import type { DatabaseAdapter, SqlSession, SqlRow, SqlValue } from '../../src/core/ports';

const crashes = new WeakMap<DatabaseAdapter, () => Promise<void>>();
export async function crashRustDatabase(db: DatabaseAdapter) { const crash = crashes.get(db); if (!crash) throw new Error('Not a Rust database'); await crash(); }

export function openRustDatabase(executable: string, path: string) {
  const child = spawn(executable, [path], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };
  const pending: Pending[] = [];
  let failed: Error | undefined, ended = false, forced = false;
  const exited = new Promise<void>(resolve => child.once('exit', () => { ended = true; resolve(); }));
  const fail = (error: Error) => { failed = error; pending.splice(0).forEach(p => p.reject(error)); };
  child.on('error', fail); child.stdin.on('error', fail);
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
      if (!ended) child.stdin.end(); await exited; lines.close();
      if (failed && !forced) throw failed;
    },
  };
  const db = new SerialDatabase(session);
  crashes.set(db, async () => { forced = true; if (!child.kill('SIGKILL')) throw new Error('Native process was not killed'); await exited; });
  return db;
}
