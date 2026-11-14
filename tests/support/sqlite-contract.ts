import type { DatabaseAdapter } from '../../src/core/ports';
import { checkSqlite } from '../../src/core/sqlite-check';
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

/** Shared dev-only acceptance, also executed inside Android WebView over the real bridge. */
export async function sqliteContract(db: DatabaseAdapter) {
  await checkSqlite(db);
  await db.read(async s => {
    const [timeout] = await s.query<{ timeout: number }>('PRAGMA busy_timeout');
    assert((timeout?.timeout ?? 0) >= 5000, 'native busy timeout configuration');
  });
  await db.transaction(async s => {
    await s.execute('CREATE TABLE acceptance_probe(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))');
    await s.execute("CREATE INDEX acceptance_expr ON acceptance_probe(json_extract(data,'$.value'))");
    await s.execute('INSERT INTO acceptance_probe VALUES(?,?)', ["quote' ; --", '{"value":"Привет"}']);
    const [row] = await s.query<{ value: string }>("SELECT json_extract(data,'$.value') AS value FROM acceptance_probe WHERE id=?", ["quote' ; --"]);
    assert(row?.value === 'Привет', 'parameterized JSON roundtrip');
    const plan = await s.query<{ detail: string }>("EXPLAIN QUERY PLAN SELECT * FROM acceptance_probe WHERE json_extract(data,'$.value')=?", ['Привет']);
    assert(plan.some(r => r.detail.includes('acceptance_expr')), 'expression index query plan');
    await s.execute("CREATE VIRTUAL TABLE acceptance_fts USING fts5(body, tokenize='unicode61')");
    await s.execute('INSERT INTO acceptance_fts VALUES(?)', ['ЗАПИСНАЯ книжка']);
    const [hit] = await s.query<{ n: number }>('SELECT count(*) AS n FROM acceptance_fts WHERE acceptance_fts MATCH ?', ['запис*']);
    assert(hit?.n === 1, 'Unicode FTS5 prefix');
  });
  try {
    await db.transaction(async s => { await s.execute('INSERT INTO acceptance_probe VALUES(?,?)', ['rollback', '{}']); throw new Error('rollback-probe'); });
    throw new Error('rollback did not throw');
  } catch (e) { if (!(e instanceof Error) || e.message !== 'rollback-probe') throw e; }
  await db.read(async s => {
    const [row] = await s.query<{ n: number }>("SELECT count(*) AS n FROM acceptance_probe WHERE id='rollback'");
    assert(row?.n === 0, 'transaction rollback');
    const [checkpoint] = await s.query<{ busy: number }>('PRAGMA wal_checkpoint(TRUNCATE)');
    assert(checkpoint?.busy === 0, 'WAL checkpoint');
  });
  await db.transaction(async s => {
    await s.execute('DROP TABLE acceptance_probe'); await s.execute('DROP TABLE acceptance_fts');
  });
}
