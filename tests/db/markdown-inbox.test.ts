import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { exportCsv, csvRecords, parseCsv } from '../../src/core/csv';

describe.each(adapters)('%s Markdown and Inbox mapping', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Заметки Markdown');
    const collection = await api.createCollection(library.id, 'Заметки', 'Название');
    const body = await api.createField(collection.id, 'Текст', 'markdown');
    await api.setCreationChoice(collection.id, { kind: 'quick' });
    await api.updateCollection(collection.id, { inbox_mapping: { title_field_id: collection.primary_field_id, body_field_id: body.id } });
    return { api, collection, body, inbox: await api.getInbox() };
  }
  it('moves one record atomically, retains the exact original and unknown values, and uses Markdown in search/CSV without conversion', async () => {
    const { api, collection, body, inbox } = await setup(), unknown = crypto.randomUUID();
    const original = '# Тема **ёж** &amp; 🦔\r\n\r\n' + 'Строка; **текст** [ссылка](https://example.org)\r\n'.repeat(100);
    const row = await api.saveEntry(inbox.id, { [inbox.incoming_field_id]: original, [unknown]: [false, 0] });
    const clock = await f.db.read(s => s.query("SELECT * FROM local_settings WHERE key='hlc'"));
    const preview = await api.previewInboxMove(row.id, collection.id, row.hlc);
    expect(preview).toMatchObject({ original, mapping_status: 'split', data: { [collection.primary_field_id]: 'Тема ёж & 🦔', [body.id]: '\r\n' + original.split('\r\n').slice(2).join('\r\n') } });
    expect(await f.db.read(s => s.query("SELECT * FROM local_settings WHERE key='hlc'"))).toEqual(clock);
    const moved = await api.moveInboxEntry(row.id, collection.id, { ...preview.data, [inbox.incoming_field_id]: null }, row.hlc);
    expect(moved).toMatchObject({ id: row.id, created_at: row.created_at, updated_at: row.updated_at, created_local: row.created_local, updated_local: row.updated_local });
    expect(moved.data).toMatchObject({ [inbox.incoming_field_id]: original, [unknown]: [false,0] });
    expect(await api.inboxOriginal(moved)).toBe(original);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'строк' })).items.map(item => item.id)).toEqual([row.id]);
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=?', [row.id]))).toHaveLength(2);
    expect((await api.resolveCreation(collection.id)).form).toBe('quick');
    let csv = '';
    await exportCsv(api, { collection_id: collection.id }, [body], 'ru', ';', { write: async text => { csv += text; }, finish: async () => {}, abort: async () => {} });
    const [imported] = [...csvRecords(parseCsv(csv), [body.id], [body], 'ru')];
    expect(imported![body.id]).toBe(moved.data[body.id]);
    const edited = await api.saveEntry(collection.id, { [body.id]: 'Новый текст' }, moved.id, moved.hlc);
    expect(await api.inboxOriginal(edited)).toBe(original);
  });
  it('falls back without losing content when mapping fields disappear, rejects invalid mapping and stale sources without writes', async () => {
    const { api, collection, body, inbox } = await setup();
    await api.startLocalSync();
    const original = 'Вводная\n# Поздний заголовок\nНе терять текст';
    const row = await api.saveEntry(inbox.id, { [inbox.incoming_field_id]: original });
    await api.setDeleted('field', body.id, true);
    const preview = await api.previewInboxMove(row.id, collection.id, row.hlc);
    expect(preview).toMatchObject({ mapping_status: 'fallback', data: { [collection.incoming_field_id]: original } });
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'), log: await s.query('SELECT * FROM change_log ORDER BY seq'), settings: await s.query('SELECT * FROM local_settings ORDER BY key'), collections: await s.query('SELECT * FROM collections') }));
    const before = await snapshot();
    await expect(api.updateCollection(collection.id, { inbox_mapping: { title_field_id: collection.primary_field_id, body_field_id: body.id } })).rejects.toThrow('invalidInboxMapping');
    await expect(api.previewInboxMove(row.id, collection.id, 'stale')).rejects.toThrow('staleRecord');
    await expect(api.moveInboxEntry(row.id, collection.id, preview.data, 'stale')).rejects.toThrow('staleRecord');
    expect(await snapshot()).toEqual(before);
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_markdown BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'Markdown move failure'); END"));
    await expect(api.moveInboxEntry(row.id, collection.id, preview.data, row.hlc)).rejects.toThrow('Markdown move failure');
    expect(await snapshot()).toEqual(before);
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_markdown'));
    const moved = await api.moveInboxEntry(row.id, collection.id, preview.data, row.hlc);
    expect(moved.data[collection.incoming_field_id]).toBe(original); expect(await api.inboxOriginal(moved)).toBe(original);
  });
});
