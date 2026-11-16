import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';
import { defaultAttachmentLimit, fileChunkSize, type ByteSource } from '../../src/core/attachments';
import { mergeHistory } from '../../src/core/history';
function source(bytes = new Uint8Array([0,255,2,3]), name = 'Вложение.bin', mime = 'application/octet-stream'): ByteSource {
  return { name, mime, size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) };
}
describe.each(adapters)('%s local attachment lifecycle (Node filesystem; native byte adapters tested separately)', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind); const api = f.api!;
    const library = await api.createLibrary('Вложения'), collection = await api.createCollection(library.id, 'Файлы', 'Название');
    const file = await api.createField(collection.id, 'Документ', 'file', { multiple: true });
    const owner = crypto.randomUUID();
    return { api, collection, file, owner };
  }
  const clocks = async () => f.db.read(async s => ({ hlc: await s.query("SELECT value FROM local_settings WHERE key='hlc'"), records: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'), changes: await s.query('SELECT * FROM change_log') }));
  it('stages bounded bytes over 10 MiB without records/versions/HLC/log, then binds everything atomically on explicit Save and reopens', async () => {
    const { api, collection, file, owner } = await setup(); await api.startLocalSync(); const before = await clocks();
    const size = defaultAttachmentLimit + 1, digest = createHash('sha256'); let largest = 0;
    const input: ByteSource = { name: 'Большое вложение.bin', mime: 'application/octet-stream', size, read: async (_offset, length) => { largest = Math.max(largest, length); const bytes = new Uint8Array(length).fill(73); digest.update(bytes); return bytes; } };
    const staged = await api.stageAttachment(collection.id, owner, input);
    expect(largest).toBe(fileChunkSize); expect(staged.sha256).toBe(digest.digest('hex')); expect(await clocks()).toEqual(before);
    expect(await api.getAttachmentLimit()).toBe(defaultAttachmentLimit);
    expect(await api.getAttachmentView(staged.id, owner)).toMatchObject({ staged: true, large: true, status: 'present' });
    const saved = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Запись', [file.id]: [staged.id] }, owner);
    expect((await api.getHistory(owner)).versions[0]?.snapshot.data[file.id]).toEqual([staged.id]);
    expect(await f.db.read(s => s.query('SELECT * FROM attachment_staging'))).toEqual([]);
    expect(await f.db.read(s => s.query('SELECT entity_type FROM change_log WHERE entity_id=?', [staged.id]))).toEqual([{ entity_type: 'attachment' }]);
    const reopened = await Repository.open(f.db, f.files);
    expect(await reopened.getEntry(owner)).toEqual(saved);
    expect(await reopened.getAttachmentView(staged.id, owner, true)).toMatchObject({ staged: false, status: 'present', sha256: staged.sha256 });
    expect((await reopened.queryEntries({ search: 'вложение' })).items).toEqual([]); // filenames/bytes are not FTS content
    expect(await reopened.exportAttachment(staged.id, owner)).toBe(true);
  });
  it('retains history bytes after unlink/clear, restores an old reference, and never creates versions for local-copy actions', async () => {
    const { api, collection, file, owner } = await setup(), bytes = new Uint8Array([1,2,3,4]);
    const staged = await api.stageAttachment(collection.id, owner, source(bytes));
    let entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'История', [file.id]: [staged.id] }, owner);
    const first = (await api.getHistory(owner)).versions[0]!;
    entry = await api.saveEntry(collection.id, { [file.id]: [] }, owner, entry.hlc);
    expect(await f.files.stat(staged.id)).toBe(4);
    entry = await api.restoreEntryVersion(owner, first.id, entry.hlc);
    expect(entry.data[file.id]).toEqual([staged.id]);
    await api.clearHistory(owner); const before = await clocks();
    await expect(api.removeAttachmentCopy(staged.id, owner)).rejects.toThrow('lastAttachmentCopy');
    expect(await clocks()).toEqual(before);
    await api.removeAttachmentCopy(staged.id, owner, true);
    expect(await api.getAttachmentView(staged.id, owner)).toMatchObject({ name: staged.name, sha256: staged.sha256, status: 'missing' });
    await expect(api.restoreAttachmentCopy(staged.id, owner, source(new Uint8Array([9,9,9,9])))).rejects.toThrow('fileCorrupt');
    expect((await api.getAttachmentView(staged.id, owner)).status).toBe('missing');
    await api.restoreAttachmentCopy(staged.id, owner, source(bytes));
    expect((await api.getAttachmentView(staged.id, owner, true)).status).toBe('present');
    expect(await api.getEntry(owner)).toEqual(entry); expect((await api.getHistory(owner)).versions).toEqual([]);
  });
  it('rolls the record, metadata, version, location, HLC and log back while preserving the ready staged copy for retry', async () => {
    const { api, collection, file, owner } = await setup();
    const staged = await api.stageAttachment(collection.id, owner, source()); await api.startLocalSync(); const before = await clocks();
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_attachment BEFORE INSERT ON change_log WHEN NEW.entity_type='attachment_location' BEGIN SELECT RAISE(ABORT,'attachment rollback'); END"));
    const data = { [collection.primary_field_id]: 'Атомарно', [file.id]: [staged.id] };
    await expect(api.saveNewEntry(collection.id, data, owner)).rejects.toThrow('attachment rollback');
    expect(await clocks()).toEqual(before);
    expect(await f.db.read(s => s.query('SELECT * FROM attachments'))).toEqual([]);
    expect((await api.getAttachmentView(staged.id, owner)).staged).toBe(true);
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_attachment'));
    expect((await api.saveNewEntry(collection.id, data, owner)).id).toBe(owner);
  });
  it('purges attachment metadata with its record and retries failed physical cleanup after reopen without resurrection', async () => {
    const { api, collection, file, owner } = await setup();
    const staged = await api.stageAttachment(collection.id, owner, source());
    const entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Удалить', [file.id]: [staged.id] }, owner);
    const history = await api.getHistory(owner);
    await api.setDeleted('record', owner, true); const deleted = (await api.queryTrash()).items[0]!;
    const remove = f.files.remove; f.files.remove = async () => { throw new Error('injected filesystem error'); };
    await api.purgeEntry(owner, deleted.hlc);
    expect(await api.collectAttachmentFiles()).toEqual({ removed: 0, pending: 1 });
    expect(await f.db.read(s => s.query('SELECT name,sha256,purged FROM attachments'))).toEqual([{ name: '', sha256: '', purged: 1 }]);
    f.files.remove = remove;
    const reopened = await Repository.open(f.db, f.files);
    expect(await f.files.stat(staged.id)).toBeNull(); expect((await reopened.collectAttachmentFiles()).pending).toBe(0);
    expect(await reopened.mergeEntryState(entry)).toBe(false);
    await f.db.transaction(s => mergeHistory(s, history)); expect((await reopened.getHistory(owner)).versions).toEqual([]);
  });
  it('rejects foreign owners/collections and non-image bytes for image fields without creating partial records', async () => {
    const { api, collection, file, owner } = await setup();
    const staged = await api.stageAttachment(collection.id, owner, source());
    await expect(api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Чужое', [file.id]: [staged.id] }, crypto.randomUUID())).rejects.toThrow('invalidAttachment');
    const image = await api.createField(collection.id, 'Изображение', 'image');
    await expect(api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Картинка', [image.id]: [staged.id] }, owner)).rejects.toThrow('invalidAttachment');
    expect((await api.queryEntries({ collection_id: collection.id })).items).toEqual([]);
    const before = await clocks();
    await expect(api.importEntries(collection.id, [{ [collection.primary_field_id]: 'CSV', [file.id]: [staged.id] }])).rejects.toThrow('csvAttachment');
    expect(await clocks()).toEqual(before);
    await api.discardAttachmentStages(owner);
    expect(await f.files.stat(staged.id)).toBeNull(); expect((await api.collectAttachmentFiles()).pending).toBe(0);
  });
  it('recovers a restored copy published before its location transaction failed, without changing record history', async () => {
    const { api, collection, file, owner } = await setup(), bytes = source();
    const staged = await api.stageAttachment(collection.id, owner, bytes);
    const entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Восстановление', [file.id]: [staged.id] }, owner);
    await api.removeAttachmentCopy(staged.id, owner, true);
    await api.startLocalSync();
    const history = await api.getHistory(owner);
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_restored_location BEFORE INSERT ON change_log WHEN NEW.entity_type='attachment_location' BEGIN SELECT RAISE(ABORT,'restore interruption'); END"));
    await expect(api.restoreAttachmentCopy(staged.id, owner, bytes)).rejects.toThrow('restore interruption');
    expect(await f.files.inspect(staged.id)).toMatchObject({ sha256: staged.sha256 });
    expect((await api.getAttachmentView(staged.id, owner)).status).toBe('copying');
    await f.db.transaction(s => s.execute('DROP TRIGGER fail_restored_location'));
    const reopened = await Repository.open(f.db, f.files);
    expect((await reopened.getAttachmentView(staged.id, owner, true)).status).toBe('present');
    expect(await reopened.getHistory(owner)).toEqual(history); expect(await reopened.getEntry(owner)).toEqual(entry);
    await reopened.removeAttachmentCopy(staged.id, owner, true);
    await f.files.begin(staged.id); await f.files.write(staged.id, 0, new Uint8Array([1]));
    await f.db.transaction(s => s.execute("UPDATE attachment_local SET state='copying' WHERE id=?", [staged.id]));
    const partial = await Repository.open(f.db, f.files);
    expect((await partial.getAttachmentView(staged.id, owner)).status).toBe('missing');
    await partial.restoreAttachmentCopy(staged.id, owner, bytes);
    expect((await partial.getAttachmentView(staged.id, owner, true)).status).toBe('present');
  });
  it('removes expired record bytes during startup cleanup and retains terminal attachment tombstones', async () => {
    const { api, collection, file, owner } = await setup();
    const staged = await api.stageAttachment(collection.id, owner, source());
    await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Истекает', [file.id]: [staged.id] }, owner);
    await api.setDeleted('record', owner, true);
    await f.db.transaction(s => s.execute('UPDATE records SET deleted_at=? WHERE id=?', [new Date(Date.now() - 31 * 86400000).toISOString(), owner]));
    await Repository.open(f.db, f.files);
    expect(await f.files.stat(staged.id)).toBeNull();
    expect(await f.db.read(s => s.query('SELECT id,purged,name FROM attachments'))).toEqual([{ id: staged.id, purged: 1, name: '' }]);
    expect(await api.collectAttachmentFiles()).toEqual({ removed: 0, pending: 0 });
  });
  it('coalesces concurrent cleanup and continues beyond a failing batch without losing durable retry jobs', async () => {
    const { api } = await setup();
    const ids = Array.from({ length: 51 }, (_, i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0'));
    await f.db.transaction(async s => { for (const id of ids) await s.execute('INSERT INTO attachment_gc VALUES(?,0)', [id]); });
    const remove = f.files.remove;
    f.files.remove = async (id, staged) => { if (id !== ids[50]) throw new Error('locked file'); await remove(id, staged); };
    const first = api.collectAttachmentFiles(), second = api.collectAttachmentFiles();
    expect(first).toBe(second); expect(await first).toEqual({ removed: 1, pending: 50 });
    f.files.remove = remove;
    expect(await api.collectAttachmentFiles()).toEqual({ removed: 50, pending: 0 });
  });
  it('preserves references through an Inbox move and round-trip version restore', async () => {
    const { api, collection, owner } = await setup(), inbox = await api.getInbox();
    const file = (await api.listFields(inbox.id)).find(field => field.type === 'file')!;
    const staged = await api.stageAttachment(inbox.id, owner, source());
    let entry = await api.saveNewEntry(inbox.id, { [inbox.incoming_field_id]: 'Входящий файл', [file.id]: [staged.id] }, owner);
    const original = (await api.getHistory(owner)).versions[0]!;
    entry = await api.moveInboxEntry(owner, collection.id, {}, entry.hlc);
    expect(entry.data[file.id]).toEqual([staged.id]); expect((await api.getAttachmentView(staged.id, owner)).status).toBe('present');
    expect(await api.unmappedAttachments(entry)).toEqual([staged.id]);
    entry = await api.restoreEntryVersion(owner, original.id, entry.hlc);
    expect(entry.collection_id).toBe(inbox.id); expect(entry.data[file.id]).toEqual([staged.id]);
    expect(await api.unmappedAttachments(entry)).toEqual([]);
  });
  it('rejects truncated input and cancellation without records/log/versions, and recovers the crash window after atomic file publication', async () => {
    const { api, collection, owner } = await setup(); const before = await clocks();
    await expect(api.stageAttachment(collection.id, owner, { ...source(), read: async () => new Uint8Array(0) })).rejects.toThrow('fileCorrupt');
    const signal = new AbortController();
    await expect(api.stageAttachment(collection.id, owner, { ...source(), read: async () => { signal.abort(); return new Uint8Array(4); } }, undefined, signal.signal)).rejects.toThrow('operationCancelled');
    expect(await clocks()).toEqual(before); expect(await f.db.read(s => s.query('SELECT * FROM attachment_staging'))).toEqual([]);
    const staged = await api.stageAttachment(collection.id, owner, source());
    // Simulate publication having completed while the following metadata transaction was interrupted.
    await f.db.transaction(s => s.execute("UPDATE attachment_staging SET state='copying',sha256='' WHERE id=?", [staged.id]));
    const reopened = await Repository.open(f.db, f.files);
    expect(await reopened.getAttachmentView(staged.id, owner, true)).toMatchObject({ staged: true, status: 'present', sha256: staged.sha256 });
  });
  it('detects same-size corruption before export and synchronizes the configurable threshold in the baseline', async () => {
    const { api, collection, file, owner } = await setup(); const staged = await api.stageAttachment(collection.id, owner, source());
    await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Проверка', [file.id]: [staged.id] }, owner);
    await writeFile(join(f.directory, 'attachments', staged.id.slice(0,2), staged.id), new Uint8Array([4,3,2,1]));
    expect((await api.getAttachmentView(staged.id, owner)).status).toBe('present');
    await expect(api.exportAttachment(staged.id, owner)).rejects.toThrow('fileCorrupt');
    expect((await api.getAttachmentView(staged.id, owner)).status).toBe('corrupt');
    await api.saveAttachmentLimit(3); expect((await api.getAttachmentView(staged.id, owner)).large).toBe(true);
    await api.startLocalSync();
    const [row] = await f.db.read(s => s.query<{ payload: string }>("SELECT payload FROM change_log WHERE entity_type='app_setting' AND entity_id='attachment:limit'"));
    expect(JSON.parse(JSON.parse(row!.payload).value).bytes).toBe(3);
  });
});
