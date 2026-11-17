import type { BinaryFileAdapter, DatabaseAdapter, SqlRow, SqlValue } from './ports';
import type { ByteSource, Attachment } from './attachments';
import { attachmentLimit } from './attachments';
import { AppError } from './errors';
import { canonical, UUID_RE, type JsonValue } from './model';
import { assertHlc, nextHlc } from './hlc';
import { migrate } from './migrate';
import { journalCheckpoint, syncMode, type JournalCheckpoint, type SyncMode } from './change-journal';
import { checkCancelled, yieldOperation, type OperationProgress } from './operations';
import { ZipReader, ZipWriter, type ArchiveWriter } from './archive-zip';
export type { ArchiveWriter } from './archive-zip';

// Public entity model, deliberately independent of SQLite DDL, derived columns and local settings.
const entities = { setting: 'app_meta', library: 'libraries', collection: 'collections', field: 'fields', record: 'records',
  version: 'record_versions', ui_config: 'ui_configs', quick_form: 'quick_forms', display_profile: 'display_profiles',
  creation_preset: 'creation_presets', attachment: 'attachments', attachment_location: 'attachment_locations' } as const;
type Entity = keyof typeof entities;
interface Part { path: string; size: number; sha256: string; rows: number }
interface ArchiveAttachment { id: string; size: number; sha256: string; state: 'included' | 'large' | 'missing' }
export interface ArchiveManifest {
  format: 'tessera-db'; version: 1; model_version: 1; exported_at: string; dataset_id: string;
  checkpoint: JournalCheckpoint; sync_mode: SyncMode; hlc: string; threshold: number;
  data: Part[]; attachments: ArchiveAttachment[]; entities: Record<Entity, number>;
  files: { included: number; large: number; missing: number };
}
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const maxPart = 64 * 1024 * 1024;
const invalid = () => new AppError('invalidArchive');
const json = (value: unknown) => canonical(value as JsonValue);
const counts = () => Object.fromEntries(Object.keys(entities).map(kind => [kind, 0])) as Record<Entity, number>;
const metaKey = (key: string) => ['trash:retention', 'attachment:limit'].includes(key) || /^history:(clear|trim):/.test(key);
const derived = new Set(['sort_data', 'search_data', 'sort_version', 'relation_version']);
const jsonColumns = new Set(['config', 'data', 'snapshot']);
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join('');
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function decodeRow(row: SqlRow, kind: Entity): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => kind !== 'record' || !derived.has(key))
    .map(([key, value]) => [key, jsonColumns.has(key) && typeof value === 'string' ? JSON.parse(value) as unknown : value]));
}
export async function databaseInitialized(db: DatabaseAdapter): Promise<boolean> {
  return db.read(async s => (await s.query("SELECT value FROM app_meta WHERE key='dataset_id'")).length > 0);
}
export async function exportDatabaseArchive(db: DatabaseAdapter, files: BinaryFileAdapter, writer: ArchiveWriter,
  progress?: OperationProgress, signal?: AbortSignal): Promise<ArchiveManifest> {
  const zip = new ZipWriter(writer, signal);
  try {
    const manifest = await db.transaction(async s => {
      // A queued transaction is a WAL-consistent logical snapshot. No raw active .sqlite copy.
      const checkpoint = await journalCheckpoint(s), [clock] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='hlc'");
      const result: ArchiveManifest = { format: 'tessera-db', version: 1, model_version: 1, exported_at: new Date().toISOString(),
        dataset_id: checkpoint.dataset_id, checkpoint, sync_mode: await syncMode(s), hlc: clock?.value ?? '',
        threshold: await attachmentLimit(s), data: [], attachments: [], entities: counts(), files: { included: 0, large: 0, missing: 0 } };
      let lines: string[] = [], length = 0;
      const flush = async (force = false) => {
        if (!lines.length && !force) return;
        const bytes = encoder.encode(lines.join('')), path = `data/${String(result.data.length).padStart(8, '0')}.ndjson`;
        result.data.push({ path, size: bytes.length, sha256: await digest(bytes), rows: lines.length });
        await zip.bytes(path, bytes); lines = []; length = 0; await yieldOperation();
      };
      for (const [kind, table] of Object.entries(entities) as [Entity, string][]) {
        let after = ''; const key = kind === 'setting' ? 'key' : 'id';
        for (;;) {
          const page = await s.query(`SELECT * FROM ${table} WHERE ${key}>? ORDER BY ${key} LIMIT 100`, [after]);
          if (!page.length) break;
          for (const stored of page) {
            after = stored[key] as string;
            if (kind === 'setting' && !metaKey(after)) continue;
            const line = json({ kind, value: decodeRow(stored, kind) }) + '\n', bytes = encoder.encode(line).length;
            if (bytes > maxPart) throw new AppError('archiveRowTooLarge');
            if (length + bytes > 256 * 1024) await flush();
            lines.push(line); length += bytes; result.entities[kind]++; checkCancelled(signal);
          }
          progress?.(Object.values(result.entities).reduce((a, b) => a + b, 0), 'processing'); await yieldOperation();
        }
      }
      await flush(!result.data.length);
      let after = '';
      for (;;) {
        const page = await s.query<Attachment>('SELECT * FROM attachments WHERE purged=0 AND id>? ORDER BY id LIMIT 100', [after]);
        if (!page.length) break;
        for (const file of page) {
          after = file.id; checkCancelled(signal);
          let state: ArchiveAttachment['state'] = file.size > result.threshold ? 'large' : 'included';
          if (state === 'included') {
            const facts = await files.inspect(file.id);
            if (!facts) state = 'missing';
            else if (facts.size !== file.size || facts.sha256 !== file.sha256) throw new AppError('fileCorrupt');
          }
          if (state === 'included') {
            await zip.entry(`attachments/${file.id}`, file.size, (offset, size) => files.read(file.id, offset, size));
            const final = await files.inspect(file.id);
            if (final?.sha256 !== file.sha256 || final.size !== file.size) throw new AppError('fileCorrupt');
          } else await zip.bytes(`placeholders/${file.id}.json`, encoder.encode(json({ ...file, state })));
          result.attachments.push({ id: file.id, size: file.size, sha256: file.sha256, state }); result.files[state]++;
        }
      }
      return result;
    });
    progress?.(manifest.data.length, 'committing');
    await zip.bytes('manifest.json', encoder.encode(json(manifest))); await zip.finish(); return manifest;
  } catch (error) { await writer.abort().catch(() => undefined); throw error; }
}
function manifestValue(value: unknown): ArchiveManifest {
  if (!object(value) || value.format !== 'tessera-db' || value.version !== 1 || value.model_version !== 1 ||
      typeof value.dataset_id !== 'string' || !UUID_RE.test(value.dataset_id) || !object(value.checkpoint) || value.checkpoint.dataset_id !== value.dataset_id ||
      !Number.isSafeInteger(value.checkpoint.seq) || (value.checkpoint.seq as number) < 0 || !['never_configured', 'active', 'paused', 'detached'].includes(String(value.sync_mode)) ||
      !Number.isSafeInteger(value.threshold) || (value.threshold as number) < 0 || typeof value.hlc !== 'string' ||
      typeof value.exported_at !== 'string' || !Number.isFinite(Date.parse(value.exported_at)) || !Array.isArray(value.data) || !value.data.length || !Array.isArray(value.attachments) ||
      !object(value.entities) || !object(value.files)) throw invalid();
  if (value.hlc) assertHlc(value.hlc);
  for (const [i, part] of value.data.entries()) {
    if (!object(part) || part.path !== `data/${String(i).padStart(8, '0')}.ndjson` || !Number.isSafeInteger(part.size) || (part.size as number) < 0 || (part.size as number) > maxPart ||
        !Number.isSafeInteger(part.rows) || (part.rows as number) < 0 || typeof part.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(part.sha256)) throw invalid();
  }
  const ids = new Set<string>();
  for (const file of value.attachments) {
    if (!object(file) || typeof file.id !== 'string' || !UUID_RE.test(file.id) || ids.has(file.id) || !Number.isSafeInteger(file.size) || (file.size as number) < 0 ||
        typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256) || !['included', 'large', 'missing'].includes(String(file.state))) throw invalid();
    ids.add(file.id);
  }
  return value as unknown as ArchiveManifest;
}
/** Validate archive structure before creating/replacing anything. All entries are accounted for. */
export async function inspectDatabaseArchive(source: ByteSource, signal?: AbortSignal) {
  const zip = await ZipReader.open(source, signal);
  let value: unknown; try { value = JSON.parse(decoder.decode(await zip.bytes('manifest.json'))); } catch { throw invalid(); }
  const manifest = manifestValue(value), expected = new Set(['manifest.json', ...manifest.data.map(p => p.path),
    ...manifest.attachments.map(file => file.state === 'included' ? `attachments/${file.id}` : `placeholders/${file.id}.json`)]);
  if (expected.size !== zip.entries.size || [...zip.entries.keys()].some(name => !expected.has(name))) throw invalid();
  return { zip, manifest };
}
/** Build only a fresh private DB. No SQL/schema, credentials, installation IDs or cursors from source. */
export async function importDatabaseArchive(source: ByteSource, db: DatabaseAdapter,
  files: Pick<BinaryFileAdapter, 'begin' | 'write' | 'finish'>, independent = false, progress?: OperationProgress, signal?: AbortSignal): Promise<ArchiveManifest> {
  const { zip, manifest } = await inspectDatabaseArchive(source, signal);
  await migrate(db);
  if ((await db.read(s => s.query<{ n: number }>('SELECT count(*) AS n FROM libraries')))[0]?.n !== 0) throw new AppError('archiveStageNotEmpty');
  return db.transaction(async s => {
    await s.execute('PRAGMA defer_foreign_keys=ON');
    const columns = new Map<Entity, string[]>(), totals = counts(), settingKeys = new Set<string>();
    for (const [kind, table] of Object.entries(entities) as [Entity, string][]) {
      columns.set(kind, (await s.query<{ name: string }>(`PRAGMA table_info(${table})`)).map(row => row.name).filter(key => kind !== 'record' || !derived.has(key)).sort());
    }
    for (const part of manifest.data) {
      const bytes = await zip.bytes(part.path);
      if (bytes.length !== part.size || await digest(bytes) !== part.sha256) throw invalid();
      let text: string; try { text = decoder.decode(bytes); } catch { throw invalid(); }
      if (text && !text.endsWith('\n')) throw invalid(); const lines = text ? text.slice(0, -1).split('\n') : [];
      if (lines.length !== part.rows) throw invalid();
      for (const line of lines) {
        checkCancelled(signal); let entity: unknown; try { entity = JSON.parse(line); } catch { throw invalid(); }
        if (!object(entity) || typeof entity.kind !== 'string' || !Object.hasOwn(entities, entity.kind) || !object(entity.value)) throw invalid();
        const kind = entity.kind as Entity, keys = columns.get(kind)!, row = entity.value;
        if (json(Object.keys(row).sort()) !== json(keys)) throw invalid();
        if (kind === 'setting') {
          if (typeof row.key !== 'string' || !metaKey(row.key) || typeof row.value !== 'string' || settingKeys.has(row.key)) throw invalid();
          settingKeys.add(row.key);
        }
        if ('hlc' in row) { if (typeof row.hlc !== 'string') throw invalid(); assertHlc(row.hlc); }
        for (const key of ['device_id', 'record_id', 'collection_id', 'library_id', 'attachment_id']) {
          if (key in row && (typeof row[key] !== 'string' || !UUID_RE.test(row[key] as string))) throw invalid();
        }
        if (kind !== 'setting' && kind !== 'attachment_location' && (typeof row.id !== 'string' || !UUID_RE.test(row.id))) throw invalid();
        const values = keys.map(key => jsonColumns.has(key) ? json(row[key]) : row[key]);
        if (!values.every(v => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))))) throw invalid();
        await s.execute(`INSERT INTO ${entities[kind]}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, values as SqlValue[]); totals[kind]++;
      }
      progress?.(Object.values(totals).reduce((a, b) => a + b, 0), 'processing'); await yieldOperation();
    }
    if (json(totals) !== json(manifest.entities) || await attachmentLimit(s) !== manifest.threshold ||
        (await s.query('PRAGMA foreign_key_check')).length || (await s.query('SELECT record_id FROM record_versions GROUP BY record_id HAVING count(*)>20')).length) throw invalid();
    const [count] = await s.query<{ n: number }>('SELECT count(*) AS n FROM attachments WHERE purged=0');
    if (count!.n !== manifest.attachments.length) throw invalid();
    let watermark = manifest.hlc;
    for (const [kind, table] of Object.entries(entities)) {
      if (kind === 'setting') continue;
      const [last] = await s.query<{ hlc: string | null }>(`SELECT max(hlc) AS hlc FROM ${table}`);
      if (last?.hlc && last.hlc > watermark) watermark = last.hlc;
    }
    for (const marker of await s.query<{ key: string; value: string }>("SELECT key,value FROM app_meta WHERE key LIKE 'history:%'")) {
      const clock = marker.key.startsWith('history:clear:') ? marker.value : (JSON.parse(marker.value) as { hlc?: string }).hlc;
      if (clock) { assertHlc(clock); if (clock > watermark) watermark = clock; }
    }
    const fileCounts = { included: 0, large: 0, missing: 0 }, device = crypto.randomUUID(), hlc = nextHlc(device, Date.now(), watermark || undefined);
    await s.execute("INSERT INTO app_meta VALUES('dataset_id',?)", [independent ? crypto.randomUUID() : manifest.dataset_id]);
    await s.execute("INSERT INTO local_settings VALUES('device_id',?),('hlc',?),('sync_mode','never_configured')", [device, hlc]);
    if (!independent) await s.execute("INSERT INTO app_meta VALUES('archive:checkpoint',?)", [json({ ...manifest.checkpoint, hlc: manifest.hlc, exported_at: manifest.exported_at, sync_mode: manifest.sync_mode })]);
    for (const file of manifest.attachments) {
      checkCancelled(signal);
      const [meta] = await s.query<Attachment>('SELECT * FROM attachments WHERE id=? AND purged=0', [file.id]);
      if (!meta || meta.size !== file.size || meta.sha256 !== file.sha256 || (file.state === 'large') !== (file.size > manifest.threshold)) throw invalid();
      if (file.state === 'included') {
        if (zip.entries.get(`attachments/${file.id}`)?.size !== file.size) throw invalid();
        await files.begin(file.id); let offset = 0;
        for await (const bytes of zip.chunks(`attachments/${file.id}`)) { await files.write(file.id, offset, bytes); offset += bytes.length; }
        await files.finish(file.id, file.size, file.sha256);
        await s.execute('INSERT INTO attachment_locations VALUES(?,?,?,?,1)', [`${file.id}:${device}`, file.id, device, hlc]);
      } else {
        let placeholder: unknown; try { placeholder = JSON.parse(decoder.decode(await zip.bytes(`placeholders/${file.id}.json`))); } catch { throw invalid(); }
        if (!object(placeholder) || placeholder.id !== file.id || placeholder.size !== file.size || placeholder.sha256 !== file.sha256 || placeholder.state !== file.state) throw invalid();
      }
      await s.execute('INSERT INTO attachment_local(id,state) VALUES(?,?)', [file.id, file.state === 'included' ? 'present' : 'missing']); fileCounts[file.state]++;
    }
    if (json(fileCounts) !== json(manifest.files)) throw invalid();
    checkCancelled(signal); progress?.(manifest.data.length, 'committing'); return manifest;
  });
}
