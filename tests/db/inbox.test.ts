import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';

describe.each(adapters)('%s inbox', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!, inbox = await api.getInbox();
    const library = await api.createLibrary('Мои заметки');
    const collection = await api.createCollection(library.id, 'Идеи', 'Название');
    const content = await api.createField(collection.id, 'Текст', 'multiline');
    await api.updateCollection(collection.id, { incoming_field_id: content.id });
    const required = await api.createField(collection.id, 'Приоритет', 'integer', { required: true, default: 0 });
    return { api, inbox, library, collection, content, required };
  }
  it('keeps a single system inbox across reopen, hides its library and protects its structure', async () => {
    const { api, inbox } = await setup();
    expect((await api.listLibraries()).map(l => l.name)).toEqual(['Мои заметки']);
    expect((await Promise.all([api.getInbox(), api.getInbox()])).map(c => c.id)).toEqual([inbox.id, inbox.id]);
    await expect(api.updateCollection(inbox.id, { name: 'rename' })).rejects.toThrow('systemContainer');
    await expect(api.updateLibrary(inbox.library_id, { name: 'rename' })).rejects.toThrow('systemContainer');
    await expect(api.createCollection(inbox.library_id, 'no', 'no')).rejects.toThrow('notFound');
    await expect(api.createField(inbox.id, 'no', 'text')).rejects.toThrow('systemContainer');
    await expect(api.updateField(inbox.primary_field_id, { name: 'no' })).rejects.toThrow('systemContainer');
    await expect(api.setDeleted('library', inbox.library_id, true)).rejects.toThrow('systemContainer');
    await expect(api.setDeleted('collection', inbox.id, true)).rejects.toThrow('systemContainer');
    await expect(api.setDeleted('field', inbox.primary_field_id, true)).rejects.toThrow('protectedField');
    await expect(api.saveUiConfig(inbox.id, 'form', { fields: [] })).rejects.toThrow('systemContainer');
    await f.db.close();
    const reopened = await f.reopen();
    try { expect((await (await Repository.open(reopened)).getInbox()).id).toBe(inbox.id); }
    finally { await reopened.close(); }
  });
  it('moves once, retaining identity, all dates, unknown values and previous history; rebuilds search/relations atomically', async () => {
    const { api, inbox, collection, content, required } = await setup();
    const unknown = crypto.randomUUID();
    const entry = await api.saveEntry(inbox.id, { [inbox.incoming_field_id]: 'Текст https://example.org/ 🦔', [unknown]: { zero: 0, no: false } });
    const oldVersions = await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=?', [entry.id]));
    const relation = await api.createField(collection.id, 'К теме', 'relation', { target_collection_id: collection.id });
    const target = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Тема' });
    const moved = await api.moveInboxEntry(entry.id, collection.id, { [collection.primary_field_id]: 'Идея', [relation.id]: target.id }, entry.hlc);
    expect(moved).toMatchObject({ id: entry.id, created_at: entry.created_at, updated_at: entry.updated_at,
      created_local: entry.created_local, updated_local: entry.updated_local, collection_id: collection.id, deleted_at: null });
    expect(moved.hlc > entry.hlc).toBe(true);
    expect(moved.data).toEqual({ [inbox.incoming_field_id]: entry.data[inbox.incoming_field_id], [content.id]: entry.data[inbox.incoming_field_id], [collection.primary_field_id]: 'Идея',
      [unknown]: { zero: 0, no: false }, [required.id]: 0, [relation.id]: target.id });
    expect((await api.queryEntries({ collection_id: inbox.id })).items).toEqual([]);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'текст' })).items.map(r => r.id)).toEqual([entry.id]);
    expect((await api.getRelationPage(entry.id, relation.id)).items[0]?.id).toBe(target.id);
    const versions = await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=? ORDER BY hlc,id', [entry.id]));
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual(oldVersions[0]);
    expect((await api.getEntry(entry.id))).toEqual(moved);
    await expect(api.moveInboxEntry(entry.id, collection.id, {}, moved.hlc)).rejects.toThrow('invalidInboxMove');
    expect(await f.db.read(s => s.query('SELECT * FROM records WHERE id=?', [entry.id]))).toHaveLength(1);
    expect(await f.db.read(s => s.query('PRAGMA foreign_key_check'))).toEqual([]);
  });
  it('leaves source, HLC, versions, journal and FTS untouched on invalid fields, stale forms and failed final writes', async () => {
    const { api, inbox, collection } = await setup();
    const entry = await api.saveEntry(inbox.id, { [inbox.incoming_field_id]: 'Остаётся во входящих' });
    const snapshot = () => f.db.read(async s => ({
      records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id'),
      changes: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT value FROM local_settings WHERE key='hlc'"),
      fts: await s.query('SELECT * FROM records_fts ORDER BY rowid'), relations: await s.query('SELECT * FROM relation_index'),
    }));
    const before = await snapshot();
    await expect(api.moveInboxEntry(entry.id, collection.id, {}, entry.hlc)).rejects.toThrow('requiredText');
    await expect(api.moveInboxEntry(entry.id, collection.id, { [collection.primary_field_id]: 'ok' }, 'stale')).rejects.toThrow('staleRecord');
    expect(await snapshot()).toEqual(before);
    await f.db.read(s => s.execute("CREATE TRIGGER fail_moved_search BEFORE INSERT ON search_documents BEGIN SELECT RAISE(ABORT,'move failure'); END"));
    await expect(api.moveInboxEntry(entry.id, collection.id, { [collection.primary_field_id]: 'ok' }, entry.hlc)).rejects.toThrow('move failure');
    expect(await snapshot()).toEqual(before);
    expect(await api.getEntry(entry.id)).toEqual(entry);
  });
});
