import { canonical, type JsonValue } from '../../src/core/model';
import type { Repository } from '../../src/core/repository';
import { Repository as RepositoryClass } from '../../src/core/repository';
import type { BinaryFileAdapter, DatabaseAdapter } from '../../src/core/ports';
import { createDatabaseImportStage } from '../../src/platform/database-import';
import { exportDatabaseArchive, importDatabaseArchive } from '../../src/core/database-archive';
import { checkDatabaseIntegrity } from '../../src/core/sqlite-check';

/** Actual native SQLite/files/staged activation, before the independent 50k load fixture. */
export async function nativeArchiveScenario(api: Repository, files: BinaryFileAdapter, reopen: () => Promise<DatabaseAdapter>) {
  const library = await api.createLibrary('Архив (dev/CI)'), collection = await api.createCollection(library.id, 'Снимок', 'Название');
  const field = await api.createField(collection.id, 'Оригинал', 'file'), owner = crypto.randomUUID();
  const contents = new Uint8Array([0,255,17,13,10,42]);
  const staged = await api.stageAttachment(collection.id, owner, { name: 'Native archive.bin', mime: 'application/octet-stream', size: contents.length, read: async (offset, count) => contents.slice(offset, offset + count) });
  const entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'Согласованный снимок', [field.id]: [staged.id] }, owner);
  const history = await api.getHistory(owner), chunks: Uint8Array[] = [];
  let finished = false;
  await exportDatabaseArchive(api.db, files, { write: async bytes => { chunks.push(bytes); }, finish: async () => { finished = true; }, abort: async () => { throw new Error('unexpected native archive abort'); } });
  if (!finished) throw new Error('archive success before native bytes completed');
  const bytes = new Uint8Array(chunks.reduce((n, part) => n + part.length, 0)); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const target = await createDatabaseImportStage(bytes.length);
  try {
    await importDatabaseArchive({ name: 'native.zip', mime: 'application/zip', size: bytes.length, read: async (offset, size) => bytes.slice(offset, offset + size) }, target.db, target.files);
    await checkDatabaseIntegrity(target.db, true); await target.db.close();
    await api.db.close(); await target.activate();
  } catch (error) { await target.abort().catch(() => {}); throw error; }
  const restored = await RepositoryClass.open(await reopen(), files);
  if (restored.datasetId !== api.datasetId || restored.deviceId === api.deviceId || canonical((await restored.getEntry(owner)) as unknown as JsonValue) !== canonical(entry as unknown as JsonValue) ||
      canonical((await restored.getHistory(owner)) as unknown as JsonValue) !== canonical(history as unknown as JsonValue) || (await restored.getAttachmentView(staged.id, owner, true)).status !== 'present') throw new Error('native archive restore/identity/files mismatch');
  return restored;
}
