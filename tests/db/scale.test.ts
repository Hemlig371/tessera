import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, adapters } from '../support/fixture';
import { scaleScenario } from '../support/scale';
import { fieldExpression, fieldIndexName } from '../../src/core/search-keys';

describe.each(adapters)('%s 50K × 20', (kind) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => {
    await f?.cleanup();
  });
  it('imports 50,000 records, pages typed indexed sorts, searches FTS and persists versions/journal', async () => {
    f = await fixture(kind);
    const api = f.api!;
    const result = await scaleScenario(api);
    const { collection, sort, page } = result;
    expect(page.next).not.toBeNull();
    const next = await api.queryEntries({ collection_id: collection.id, cursor: page.next, limit: 200 });
    expect(next.items[0]?.data[sort.id]).toBe(202);
    expect(new Set([...page.items, ...next.items].map((x) => x.id)).size).toBe(400);
    const counts = await f.db.read((s) =>
      s.query<{ n: number; versions: number; logs: number }>(`SELECT (SELECT count(*) FROM records) AS n,
      (SELECT count(*) FROM record_versions) AS versions,(SELECT count(*) FROM change_log WHERE entity_type IN('record','record_version')) AS logs`)
    );
    expect(counts[0]).toMatchObject({ n: 50000, versions: 50000, logs: 100000 });
    const plan = await f.db.read((s) =>
      s.query<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id FROM records WHERE collection_id=? AND deleted_at IS NULL AND ${fieldExpression(sort)}=?`,
        [collection.id, 42]
      )
    );
    expect(plan.some((row) => row.detail.includes(fieldIndexName(sort.id)))).toBe(true);
    const metrics = {
      adapter: kind,
      records: 50000,
      fields: 20,
      importMs: result.importMs,
      twoQueriesMs: result.queryMs,
    };
    await mkdir('work', { recursive: true });
    await writeFile(`work/scale-${kind}.json`, JSON.stringify(metrics, null, 2));
    console.info(JSON.stringify(metrics));
  }, 300000);
});
