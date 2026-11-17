import type { DatabaseAdapter, SqlSession, SqlValue } from '../../src/core/ports';

/** Keep the server connection owned across all HTTP calls of one renderer operation. */
export class HttpSqliteSession {
  private active?: { client: string; session: SqlSession; write: boolean; release: () => void; done: Promise<void> };
  private readonly closed = new Set<string>();
  private readonly clients = new Set<string>();
  constructor(private readonly database: () => DatabaseAdapter) {}
  private async acquire(client: string, write: boolean): Promise<void> {
    let ready!: () => void, failed!: (error: unknown) => void, release!: () => void;
    const started = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    const ended = new Promise<void>(resolve => { release = resolve; });
    const done = this.database().read(async session => {
      if (this.closed.has(client)) throw new Error('databaseUnavailable');
      if (write) await session.begin();
      this.active = { client, session, write, release, done };
      ready(); await ended;
    });
    void done.catch(failed);
    await started;
  }
  async request(client: string, op: string, sql: string, params: readonly SqlValue[] = []): Promise<unknown> {
    this.clients.add(client);
    if (op === 'close') { await this.close(client); return; }
    if (this.closed.has(client)) throw new Error('databaseUnavailable');
    if (op === 'begin' || op === 'read-begin') { await this.acquire(client, op === 'begin'); return; }
    const lease = this.active?.client === client ? this.active : undefined;
    if (op === 'commit' || op === 'rollback' || op === 'read-end') {
      if (!lease || (op === 'read-end') === lease.write) throw new Error('invalid HTTP SQLite lease');
      if (op === 'commit') await lease.session.commit();
      if (op === 'rollback') await lease.session.rollback();
      this.active = undefined; lease.release(); await lease.done; return;
    }
    const run = async (session: SqlSession): Promise<unknown> => {
      if (op === 'query') return session.query(sql, params);
      if (op === 'execute') return session.execute(sql, params);
      if (op === 'backup') return session.backup();
      throw new Error('unknown HTTP SQLite operation');
    };
    return lease ? run(lease.session) : this.database().read(run);
  }
  async close(client: string): Promise<void> {
    this.closed.add(client);
    const lease = this.active?.client === client ? this.active : undefined;
    if (!lease) return;
    try { if (lease.write) await lease.session.rollback(); }
    finally { this.active = undefined; lease.release(); await lease.done; }
  }
  async closeAll(): Promise<void> {
    for (const client of this.clients) this.closed.add(client);
    this.clients.clear();
    if (this.active) await this.close(this.active.client);
  }
}
