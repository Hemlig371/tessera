import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { exportDatabaseArchive, importDatabaseArchive, type ArchiveWriter } from '../../src/core/database-archive';
import { ZipReader, ZipWriter } from '../../src/core/archive-zip';
import { Repository } from '../../src/core/repository';
import { checkDatabaseIntegrity } from '../../src/core/sqlite-check';
import type { ByteSource } from '../../src/core/attachments';

function bytes(data: Uint8Array): ByteSource {
  return { name: 'portable.tessera', mime: 'application/x-tessera', size: data.length, read: async (offset, size) => data.slice(offset, offset + size) };
}
function writer() {
  const chunks: Uint8Array[] = [];
  const state = { get bytes() { return Uint8Array.from(Buffer.concat(chunks)); }, get text() { return Buffer.concat(chunks).toString('utf8'); }, finished: false, aborted: false };
  return { state, port: { write: async (data: Uint8Array) => { chunks.push(data); }, finish: async () => { state.finished = true; }, abort: async () => { state.aborted = true; } } satisfies ArchiveWriter };
}
describe.each(adapters)('%s portable database archive (logical WAL snapshot)', kind => {
  const opened: Awaited<ReturnType<typeof fixture>>[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.cleanup(); });
  async function open(initialize = true) { const f = await fixture(kind, initialize); opened.push(f); return f; }
  async function seed() {
    const f = await open(), api = f.api!;
    const library = await api.createLibrary('Архив 🦔'), collection = await api.createCollection(library.id, 'Материалы', 'Имя');
    const file = await api.createField(collection.id, 'Файлы', 'file', { multiple: true });
    const owner = crypto.randomUUID();
    const source: ByteSource = { name: '../Имя.bin', mime: 'application/octet-stream', size: 4, read: async () => new Uint8Array([0,255,2,3]) };
    const staged = await api.stageAttachment(collection.id, owner, source);
    let entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'До экспорта', [file.id]: [staged.id] }, owner);
    entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Вторая версия' }, owner, entry.hlc);
    await api.startLocalSync();
    await f.db.transaction(s => s.execute("INSERT INTO local_settings VALUES('mail_password','NEVER_EXPORT_PASSWORD'),('sync_peer:old','999'),('local_queue','NEVER_EXPORT_QUEUE')"));
    return { f, api, library, collection, file, owner, staged, entry };
  }
  it('exports an empty initialized dataset and restores it offline', async () => {
    const f = await open(), output = writer(); await exportDatabaseArchive(f.db, f.files, output.port);
    const target = await open(false); await importDatabaseArchive(bytes(output.state.bytes), target.db, target.files);
    expect((await Repository.open(target.db, target.files)).datasetId).toBe(f.api!.datasetId);
  });
  it.each(['unknown-entity', 'wrong-model', 'binary-with-valid-crc', 'foreign-file-owner', 'version-provenance', 'hlc-provenance'])('rejects %s even when ZIP CRCs and data hashes have been recomputed', async mode => {
    const { f, api, collection } = await seed();
    const other = mode === 'foreign-file-owner' ? await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Другой владелец' }) : null;
    const original = writer(); await exportDatabaseArchive(f.db, f.files, original.port);
    const zip = await ZipReader.open(bytes(original.state.bytes)), output = writer(), changed = new ZipWriter(output.port);
    const parts = new Map<string, Uint8Array>(); for (const name of zip.entries.keys()) parts.set(name, await zip.bytes(name));
    const manifest = JSON.parse(new TextDecoder().decode(parts.get('manifest.json'))) as { model_version: number; data: { path: string; size: number; sha256: string }[] };
    if (mode === 'wrong-model') manifest.model_version = 99;
    for (const part of manifest.data) {
      const lines = new TextDecoder().decode(parts.get(part.path)).trimEnd().split('\n').map(line => JSON.parse(line) as { kind: string; value: Record<string, unknown> });
      for (const entity of lines) {
        if (mode === 'unknown-entity' && entity.kind === 'library') entity.kind = 'local_settings';
        if (mode === 'foreign-file-owner' && entity.kind === 'attachment') entity.value.record_id = other!.id;
        if (mode === 'version-provenance' && entity.kind === 'version') (entity.value.snapshot as Record<string, unknown>).id = crypto.randomUUID();
        if (mode === 'hlc-provenance' && entity.kind === 'library') entity.value.device_id = crypto.randomUUID();
      }
      const data = new TextEncoder().encode(lines.map(value => JSON.stringify(value)).join('\n') + '\n');
      part.size = data.length; part.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex'); parts.set(part.path, data);
    }
    parts.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    for (const [name, data] of parts) {
      if (mode === 'binary-with-valid-crc' && name.startsWith('attachments/')) data[0] = data[0]! ^ 7;
      await changed.bytes(name, data);
    }
    await changed.finish(); const target = await open(false);
    await expect(importDatabaseArchive(bytes(output.state.bytes), target.db, target.files)).rejects.toThrow(mode === 'binary-with-valid-crc' ? 'fileCorrupt' : 'invalidArchive');
  });
  it('round-trips the complete dataset, versions, typed files/config and baseline point with a fresh device, no credentials/queues/cursors', async () => {
    const { f, api, collection, file, owner, staged } = await seed(), output = writer();
    const date = await api.createField(collection.id, 'Дата архива', 'date');
    const dateProfile = await api.createDisplayProfile(collection.id, 'Сегодня', { fields: [], list: { date_selection: { field_id: date.id, period: 'today' } } });
    const manifest = await exportDatabaseArchive(f.db, f.files, output.port);
    expect(output.state.finished).toBe(true); expect(output.state.aborted).toBe(false);
    expect(manifest.files).toEqual({ included: 1, large: 0, missing: 0 });
    expect(output.state.text).not.toMatch(/NEVER_EXPORT|sort_data|schema_checksum|local_settings|change_log/);
    const target = await open(false);
    expect(await importDatabaseArchive(bytes(output.state.bytes), target.db, target.files)).toEqual(manifest);
    await checkDatabaseIntegrity(target.db, true);
    const restored = await Repository.open(target.db, target.files);
    expect(restored.datasetId).toBe(api.datasetId); expect(restored.deviceId).not.toBe(api.deviceId);
    expect((await restored.listDisplayProfiles(collection.id)).find(profile => profile.id === dateProfile.id)?.config).toBe(dateProfile.config);
    expect(await restored.getEntry(owner)).toEqual(await api.getEntry(owner));
    expect(await restored.getHistory(owner)).toEqual(await api.getHistory(owner));
    expect((await restored.listFields(collection.id)).map(f => ({ ...f, config: JSON.parse(f.config) as unknown }))).toEqual((await api.listFields(collection.id)).map(f => ({ ...f, config: JSON.parse(f.config) as unknown })));
    expect((await restored.getEntry(owner))?.data[file.id]).toEqual([staged.id]);
    expect(await restored.getAttachmentView(staged.id, owner, true)).toMatchObject({ status: 'present', name: '../Имя.bin', sha256: staged.sha256 });
    expect(await target.db.read(s => s.query('SELECT * FROM change_log'))).toEqual([]);
    expect(await target.db.read(s => s.query("SELECT * FROM local_settings WHERE key LIKE 'sync_peer:%' OR key='mail_password' OR key='local_queue'"))).toEqual([]);
    expect(await target.db.read(s => s.query("SELECT value FROM local_settings WHERE key='sync_mode'"))).toEqual([{ value: 'never_configured' }]);
    expect(JSON.parse((await target.db.read(s => s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='archive:checkpoint'")))[0]!.value)).toMatchObject(manifest.checkpoint);
  });
  it('takes one snapshot while later saves are queued and preserves the source unchanged on cancellation/write failure', async () => {
    const { f, api, owner, collection, entry } = await seed(), output = writer();
    const before = await api.getEntry(owner); let pending: Promise<unknown> | undefined;
    const write = output.port.write;
    output.port.write = async text => {
      if (!pending) pending = api.saveEntry(collection.id, { [collection.primary_field_id]: 'После снимка' }, owner, entry.hlc);
      await write(text);
    };
    await exportDatabaseArchive(f.db, f.files, output.port); await pending;
    const target = await open(false); await importDatabaseArchive(bytes(output.state.bytes), target.db, target.files);
    const restored = await Repository.open(target.db, target.files);
    expect(await restored.getEntry(owner)).toEqual(before); expect((await api.getEntry(owner))?.data[collection.primary_field_id]).toBe('После снимка');
    const controller = new AbortController(), cancelled = writer();
    cancelled.port.write = async () => { controller.abort(); };
    await expect(exportDatabaseArchive(f.db, f.files, cancelled.port, undefined, controller.signal)).rejects.toThrow('operationCancelled');
    expect(cancelled.state).toMatchObject({ finished: false, aborted: true });
    const failed = writer(); failed.port.write = async () => { throw new Error('disk full'); };
    await expect(exportDatabaseArchive(f.db, f.files, failed.port)).rejects.toThrow('disk full'); expect(failed.state.aborted).toBe(true);
    await checkDatabaseIntegrity(f.db, true);
  });
  it('represents large and already absent originals as metadata/placeholders; optionally makes an independent dataset', async () => {
    const { f, api, collection, file } = await seed(); await api.saveAttachmentLimit(3);
    const owner = crypto.randomUUID(), data = new Uint8Array([11,12]);
    const staged = await api.stageAttachment(collection.id, owner, { name: 'Absent', mime: '', size: 2, read: async () => data });
    await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Нет байтов', [file.id]: [staged.id] }, owner);
    await f.files.remove(staged.id, false);
    const output = writer(), manifest = await exportDatabaseArchive(f.db, f.files, output.port);
    expect(manifest.files).toEqual({ included: 0, large: 1, missing: 1 });
    const target = await open(false); await importDatabaseArchive(bytes(output.state.bytes), target.db, target.files, true);
    const restored = await Repository.open(target.db, target.files);
    expect(restored.datasetId).not.toBe(api.datasetId); expect(restored.deviceId).not.toBe(api.deviceId);
    expect((await restored.getAttachmentView(staged.id, owner)).status).toBe('missing');
    expect(await target.db.read(s => s.query("SELECT * FROM app_meta WHERE key='archive:checkpoint'"))).toEqual([]);
  });
  it.each(['truncated', 'garbage', 'changed-data', 'changed-hash', 'foreign-table', 'damaged-binary'])('rejects %s in a private stage without touching the live database', async mode => {
    const { f, api, owner } = await seed(), output = writer(); await exportDatabaseArchive(f.db, f.files, output.port);
    const original = await api.getEntry(owner); let data = output.state.bytes;
    if (mode === 'truncated') data = data.slice(0, -23);
    if (mode === 'garbage') data = Uint8Array.from([...data, 123]);
    if (mode === 'changed-data' || mode === 'changed-hash' || mode === 'foreign-table') {
      const needle = new TextEncoder().encode(mode === 'changed-data' ? 'Вторая версия' : mode === 'foreign-table' ? 'library' : 'sha256');
      const at = Buffer.from(data).indexOf(needle); expect(at).toBeGreaterThan(0); data[at] = data[at]! ^ 1;
    }
    if (mode === 'damaged-binary') { const at = Buffer.from(data).indexOf(new Uint8Array([0,255,2,3])); expect(at).toBeGreaterThan(0); data[at + 1] = 1; }
    const target = await open(false);
    await expect(importDatabaseArchive(bytes(data), target.db, target.files)).rejects.toThrow();
    expect(await api.getEntry(owner)).toEqual(original);
    if ((await target.db.read(s => s.query("SELECT name FROM sqlite_master WHERE name='libraries'"))).length) expect(await target.db.read(s => s.query('SELECT * FROM libraries'))).toEqual([]);
  });
  it('retains purge tombstones and history clear markers, and refuses to restore into a populated stage', async () => {
    const { f, api, owner } = await seed(); await api.clearHistory(owner);
    await api.setDeleted('record', owner, true); await api.purgeEntry(owner, (await api.queryTrash()).items.find(row => row.id === owner)!.hlc);
    const output = writer(); await exportDatabaseArchive(f.db, f.files, output.port);
    const target = await open(false); await importDatabaseArchive(bytes(output.state.bytes), target.db, target.files);
    expect(await target.db.read(s => s.query('SELECT id,purged FROM records'))).toEqual([{ id: owner, purged: 1 }]);
    expect(await target.db.read(s => s.query("SELECT * FROM app_meta WHERE key LIKE 'history:%' ORDER BY key"))).toEqual(await f.db.read(s => s.query("SELECT * FROM app_meta WHERE key LIKE 'history:%' ORDER BY key")));
    await expect(importDatabaseArchive(bytes(output.state.bytes), f.db, f.files)).rejects.toThrow('archiveStageNotEmpty');
  });
});
