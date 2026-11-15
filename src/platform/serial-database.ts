import type { DatabaseAdapter, SqlSession } from '../core/ports';

/** The only owner of a connection. Reads cannot interleave with a transaction. */
export class SerialDatabase implements DatabaseAdapter {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  private poisoned = false;
  constructor(private readonly session: SqlSession) {}
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed || this.closing || this.poisoned) return Promise.reject(new Error('databaseUnavailable'));
    const result = this.tail.then(async () => {
      if (this.closed || this.poisoned) throw new Error('databaseUnavailable');
      return work();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  read<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    return this.enqueue(() => work(this.session));
  }
  transaction<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.session.begin();
      try {
        const value = await work(this.session);
        await this.session.commit();
        return value;
      } catch (error) {
        try { await this.session.rollback(); }
        catch { this.poisoned = true; }
        throw error;
      }
    });
  }
  backup(): Promise<void> { return this.enqueue(() => this.session.backup()); }
  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.tail.then(async () => {
        this.closed = true;
        await this.session.close();
      });
    }
    return this.closing;
  }
}
