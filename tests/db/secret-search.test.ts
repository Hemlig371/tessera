import { afterEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/core/repository';
import { fieldIndexName } from '../../src/core/search-keys';
import { adapters, fixture } from '../support/fixture';

describe.each(adapters)('%s secret search isolation', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup(count = 1) {
    f = await fixture(kind);
    const api = f.api!, library = await api.createLibrary('Private');
    const collection = await api.createCollection(library.id, 'Records', 'Title');
    const secret = await api.createField(collection.id, 'Private value', 'text', { indexed: true });
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Public title', [secret.id]: 'PrivateNeedleЁ' });
    if (count > 1) await api.importEntries(collection.id, Array.from({ length: count - 1 }, (_, n) => ({
      [collection.primary_field_id]: `Public ${n}`, [secret.id]: 'PrivateNeedleЁ',
    })));
    // Emulate an existing/future database containing a type this UI cannot create yet.
    await f.db.transaction(s => s.execute("UPDATE fields SET type='secret' WHERE id=?", [secret.id]));
    return { api, collection, secret, entry };
  }
  it('never copies stored secret values into search/sort keys or expression indexes during a refresh', async () => {
    const { api, collection, secret, entry } = await setup();
    await f.db.transaction(s => s.execute('UPDATE records SET sort_version=0 WHERE id=?', [entry.id]));
    await api.rebuildDerived(); await api.reconcileIndexes(collection.id);
    const [derived] = await f.db.read(s => s.query<{ search_data: string; sort_data: string }>('SELECT search_data,sort_data FROM records WHERE id=?', [entry.id]));
    expect(JSON.parse(derived!.search_data)).toEqual({ [collection.primary_field_id]: 'public title' });
    expect(JSON.parse(derived!.sort_data)).not.toHaveProperty(secret.id);
    expect(await f.db.read(s => s.query('SELECT name FROM sqlite_master WHERE type=\'index\' AND name=?', [fieldIndexName(secret.id)]))).toEqual([]);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'PrivateNeedle' })).items).toEqual([]);
    await expect(api.queryEntries({ collection_id: collection.id, sort_field: secret.id })).rejects.toThrow('invalidFilter');
    expect((await api.getEntry(entry.id))!.data).toEqual(entry.data);
  });
  it('repairs already-ready legacy caches on open without changing source data, history, HLC or journal', async () => {
    const { api, collection, secret, entry } = await setup();
    const source = () => f.db.read(async s => ({ records: await s.query('SELECT id,collection_id,data,hlc,created_at,updated_at FROM records'),
      versions: await s.query('SELECT * FROM record_versions ORDER BY id'), changes: await s.query('SELECT * FROM change_log ORDER BY seq'),
      clock: await s.query("SELECT value FROM local_settings WHERE key='hlc'") }));
    const before = await source();
    await f.db.transaction(s => s.execute("DELETE FROM local_settings WHERE key='derived_search_policy'"));
    const reopened = await Repository.open(f.db);
    const [cached] = await f.db.read(s => s.query<{ search_data: string; sort_version: number }>('SELECT search_data,sort_version FROM records WHERE id=?', [entry.id]));
    expect(cached!.sort_version).toBe(1);
    expect(JSON.parse(cached!.search_data)).not.toHaveProperty(secret.id);
    expect(await f.db.read(s => s.query('SELECT * FROM search_documents WHERE field_id=?', [secret.id]))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT * FROM records_fts WHERE field_id=?', [secret.id]))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT name FROM sqlite_master WHERE type=\'index\' AND name=?', [fieldIndexName(secret.id)]))).toEqual([]);
    expect((await reopened.queryEntries({ collection_id: collection.id, search: 'Public' })).items.map(value => value.id)).toEqual([entry.id]);
    expect(await source()).toEqual(before);
    expect((await api.getEntry(entry.id))!.data[secret.id]).toBe('PrivateNeedleЁ');
  });
  it('resumes interrupted backfill in committed batches while queries reject incomplete search results', async () => {
    const { api, collection, secret } = await setup(301);
    const source = () => f.db.read(async s => ({ records: await s.query('SELECT id,data,hlc FROM records ORDER BY id'),
      versions: await s.query('SELECT * FROM record_versions ORDER BY id'), clock: await s.query("SELECT value FROM local_settings WHERE key='hlc'") }));
    const before = await source();
    const rows = await f.db.read(s => s.query<{ id: string }>('SELECT id FROM records ORDER BY id'));
    await f.db.transaction(async s => {
      await s.execute("DELETE FROM local_settings WHERE key='derived_search_policy'");
      await s.execute(`CREATE TRIGGER interrupt_cache BEFORE UPDATE OF search_data ON records WHEN NEW.id='${rows[200]!.id}' BEGIN SELECT RAISE(ABORT,'cache interrupted'); END`);
    });
    await expect(Repository.open(f.db)).rejects.toThrow('cache interrupted');
    expect(await f.db.read(s => s.query('SELECT sort_version,count(*) AS n FROM records GROUP BY sort_version ORDER BY sort_version')))
      .toEqual([{ sort_version: 0, n: 101 }, { sort_version: 1, n: 200 }]);
    await expect(api.queryEntries({ collection_id: collection.id, search: 'Public' })).rejects.toThrow('searchUpdating');
    await f.db.transaction(async s => {
      await s.execute('DROP TRIGGER interrupt_cache');
      // Already committed work must not be invalidated/repeated after reopening.
      await s.execute(`CREATE TRIGGER preserve_cache BEFORE UPDATE OF search_data ON records WHEN NEW.id='${rows[0]!.id}' BEGIN SELECT RAISE(ABORT,'repeated completed batch'); END`);
    });
    await Repository.open(f.db);
    expect(await f.db.read(s => s.query('SELECT count(*) AS n FROM records WHERE sort_version=0'))).toEqual([{ n: 0 }]);
    expect(await f.db.read(s => s.query('SELECT count(*) AS n FROM records WHERE json_type(search_data,?) IS NOT NULL', [`$."${secret.id}"`]))).toEqual([{ n: 0 }]);
    expect(await source()).toEqual(before);
  });
});
