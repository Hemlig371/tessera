import { afterEach, describe, expect, it } from 'vitest';
import { HttpSqliteSession } from '../support/http-sqlite-session';
import { adapters, fixture } from '../support/fixture';

describe.each(adapters)('%s HTTP test bridge ownership', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind, false);
    await f.db.transaction(s => s.execute('CREATE TABLE test_state(value INTEGER NOT NULL)'));
    return new HttpSqliteSession(() => f.db);
  }
  it('queues fixture transactions until the complete renderer transaction commits', async () => {
    const remote = await setup(); await remote.request('renderer','begin','');
    await remote.request('renderer','execute','INSERT INTO test_state VALUES(1)');
    let started = false;
    const seed = f.db.transaction(async s => { started = true; await s.execute('INSERT INTO test_state VALUES(2)'); });
    await Promise.resolve(); expect(started).toBe(false);
    expect(await remote.request('renderer','query','SELECT * FROM test_state')).toEqual([{ value: 1 }]);
    await remote.request('renderer','commit',''); await seed;
    expect(await f.db.read(s => s.query('SELECT * FROM test_state ORDER BY value'))).toEqual([{ value: 1 },{ value: 2 }]);
  });
  it('owns a complete read operation and rolls back a disconnected writer before allowing seeds', async () => {
    const remote = await setup(); await remote.request('reader','read-begin','');
    let started = false;
    const seed = f.db.transaction(async s => { started = true; await s.execute('INSERT INTO test_state VALUES(2)'); });
    await Promise.resolve(); expect(started).toBe(false);
    expect(await remote.request('reader','query','SELECT * FROM test_state')).toEqual([]);
    await remote.request('reader','read-end',''); await seed;
    await remote.request('writer','begin',''); await remote.request('writer','execute','INSERT INTO test_state VALUES(3)');
    await expect(remote.request('other','commit','')).rejects.toThrow('invalid HTTP SQLite lease');
    await remote.close('writer');
    expect(await f.db.read(s => s.query('SELECT * FROM test_state'))).toEqual([{ value: 2 }]);
    await expect(remote.request('writer','query','SELECT * FROM test_state')).rejects.toThrow('databaseUnavailable');
  });
  it('cancels queued operations from a closed page without leaving a transaction open', async () => {
    const remote = await setup(); await remote.request('first','begin','');
    const queued = remote.request('closing','begin',''); const rejected = expect(queued).rejects.toThrow('databaseUnavailable');
    await remote.close('closing'); await remote.request('first','commit',''); await rejected;
    await f.db.transaction(s => s.execute('INSERT INTO test_state VALUES(4)'));
    expect(await f.db.read(s => s.query('SELECT * FROM test_state'))).toEqual([{ value: 4 }]);
  });
  it('cleans abandoned active and queued renderer operations when the browser context skips pagehide', async () => {
    const remote = await setup(); await remote.request('disposed','begin','');
    await remote.request('disposed','execute','INSERT INTO test_state VALUES(9)');
    const pending = remote.request('queued-old-page','read-begin','');
    const rejected = expect(pending).rejects.toThrow('databaseUnavailable');
    await remote.closeAll(); await rejected;
    await remote.request('new-test','read-begin','');
    expect(await remote.request('new-test','query','SELECT * FROM test_state')).toEqual([]);
    await remote.request('new-test','read-end','');
  });

});
