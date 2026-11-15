import { describe, expect, it, vi } from 'vitest';
import { SerialDatabase } from '../../src/platform/serial-database';
import type { SqlSession } from '../../src/core/ports';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const session: SqlSession = {
    query: vi.fn(async () => []), execute: vi.fn(async () => {}), begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}), backup: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
  return { session, db: new SerialDatabase(session) };
}
describe('SerialDatabase close boundary', () => {
  it('drains accepted work, rejects new work immediately and shares one pending close', async () => {
    const { db, session } = fixture(), work = deferred(), closed = deferred(), started = deferred();
    session.close = vi.fn(() => closed.promise);
    const first = db.read(async () => { started.resolve(); await work.promise; return 'first'; });
    const accepted = vi.fn(async () => 'second');
    const second = db.read(accepted);
    await started.promise;
    const closing = db.close(), concurrent = db.close();
    const late = vi.fn(async () => 'late');
    // Must reject without waiting for an outstanding transaction to finish.
    await expect(db.read(late)).rejects.toThrow('databaseUnavailable');
    await expect(db.transaction(late)).rejects.toThrow('databaseUnavailable');
    await expect(db.backup()).rejects.toThrow('databaseUnavailable');
    expect(late).not.toHaveBeenCalled(); expect(session.close).not.toHaveBeenCalled();
    work.resolve(); expect(await first).toBe('first'); expect(await second).toBe('second');
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
    let completed = false; void concurrent.then(() => { completed = true; });
    await Promise.resolve(); expect(completed).toBe(false);
    closed.resolve(); await Promise.all([closing, concurrent]);
    await db.close(); expect(session.close).toHaveBeenCalledTimes(1);
  });
  it('closes after a rejected transaction and propagates a native close failure to every caller', async () => {
    const { db, session } = fixture();
    const failed = db.transaction(async () => { throw new Error('transaction failure'); });
    session.close = vi.fn(async () => { throw new Error('close failure'); });
    const closing = db.close(), concurrent = db.close();
    await expect(failed).rejects.toThrow('transaction failure');
    await expect(closing).rejects.toThrow('close failure');
    await expect(concurrent).rejects.toThrow('close failure');
    await expect(db.close()).rejects.toThrow('close failure');
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
