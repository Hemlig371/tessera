import { AppError } from './errors';
import { canonical, UUID_RE, type Entry, type Field, type JsonValue, type RecordData, type Stamp } from './model';
import type { FileFacts, SqlSession } from './ports';
import { requireId } from './validation';

export const fileChunkSize = 256 * 1024;
export const defaultAttachmentLimit = 10 * 1024 * 1024;
export interface ByteSource { name: string; mime: string; size: number; read(offset: number, length: number): Promise<Uint8Array> }
export interface Attachment extends Stamp, FileFacts { record_id: string; name: string; mime: string; purged: number }
export interface StagedAttachment extends FileFacts { id: string; owner_id: string; collection_id: string; name: string; mime: string; state: 'copying' | 'ready'; created_at: string }
export interface AttachmentView { id: string; name: string; mime: string; size: number; sha256: string; status: 'present' | 'missing' | 'corrupt' | 'deleting' | 'copying'; large: boolean; staged: boolean; other_copies: number }
export type AttachmentLog = (entity: string, row: Pick<Stamp, 'id' | 'hlc' | 'device_id'>, payload: object) => Promise<void>;
export function isFile(type: string) { return type === 'file' || type === 'image'; }
export function fileIds(value: JsonValue | undefined): string[] { return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; }
export function dataFileCandidates(data: RecordData): Set<string> {
  const ids = new Set<string>();
  const scan = (value: JsonValue): void => {
    if (typeof value === 'string' && UUID_RE.test(value)) ids.add(value);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  Object.values(data).forEach(scan); return ids;
}
export function validateFileFacts(value: FileFacts): void {
  if (!Number.isSafeInteger(value.size) || value.size < 0 || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new AppError('fileCorrupt');
}
export function validateFileSource(source: ByteSource): void {
  // Control characters are deliberately rejected in display/export names.
  // eslint-disable-next-line no-control-regex
  if (!source || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 1024 || /[\u0000-\u001f\u007f]/.test(source.name) ||
      typeof source.mime !== 'string' || source.mime.length > 255 || (source.mime !== '' && !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(source.mime)) ||
      !Number.isSafeInteger(source.size) || source.size < 0 || typeof source.read !== 'function') throw new AppError('invalidAttachment');
}
export function exportFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  let value = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/, '');
  // A character limit alone can exceed a filesystem's 255-byte UTF-8 component limit
  // or split a surrogate pair. Keep a short extension while bounding both encodings.
  const encoder = new TextEncoder(), dot = value.lastIndexOf('.');
  const extension = dot > 0 && encoder.encode(value.slice(dot)).length <= 32 ? value.slice(dot) : '';
  const stem = extension ? value.slice(0, dot) : value;
  const budget = 240 - encoder.encode(extension).length;
  let bounded = '', bytes = 0;
  for (const char of stem) {
    const length = encoder.encode(char).length;
    if (bytes + length > budget) break;
    bounded += char; bytes += length;
  }
  value = bounded.replace(/[. ]+$/, '') + extension;
  if (!value || /^\.+$/.test(value)) value = 'file';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) value = '_' + value;
  return value;
}
export async function attachmentLimit(s: SqlSession): Promise<number> {
  const [row] = await s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='attachment:limit'");
  const value = row ? (JSON.parse(row.value) as { bytes: number }).bytes : defaultAttachmentLimit;
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError('invalidAttachmentLimit');
  return value;
}
/** The record save owns these metadata changes; there is no attachment version before explicit Save. */
export async function bindAttachments(s: SqlSession, row: Entry, fields: Field[], log: AttachmentLog): Promise<void> {
  const typed = new Map<string, boolean>();
  for (const field of fields.filter(field => isFile(field.type))) for (const id of fileIds(row.data[field.id])) typed.set(id, (typed.get(id) ?? false) || field.type === 'image');
  const stagedIds = new Set((await s.query<{ id: string }>('SELECT id FROM attachment_staging WHERE owner_id=?', [row.id])).map(file => file.id));
  for (const id of dataFileCandidates(row.data)) if (!typed.has(id) && stagedIds.has(id)) typed.set(id, false);
  for (const [id, image] of typed) {
    const [old] = await s.query<Attachment>('SELECT * FROM attachments WHERE id=?', [id]);
    if (old) {
      if (old.record_id !== row.id || old.purged || (image && !old.mime.startsWith('image/'))) throw new AppError('invalidAttachment');
      continue;
    }
    const [staged] = await s.query<StagedAttachment>('SELECT * FROM attachment_staging WHERE id=?', [id]);
    if (!staged || (await s.query('SELECT id FROM attachment_gc WHERE id=?', [id])).length || staged.state !== 'ready' || staged.owner_id !== row.id || staged.collection_id !== row.collection_id || (image && !staged.mime.startsWith('image/'))) throw new AppError('invalidAttachment');
    validateFileFacts(staged);
    const meta: Attachment = { id, record_id: row.id, name: staged.name, mime: staged.mime, size: staged.size, sha256: staged.sha256,
      hlc: row.hlc, device_id: row.device_id, created_at: row.updated_at, updated_at: row.updated_at, deleted_at: null, purged: 0 };
    const columns = Object.keys(meta);
    await s.execute(`INSERT INTO attachments(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, Object.values(meta));
    await s.execute("INSERT INTO attachment_local(id,state,verified_at) VALUES(?,'present',?)", [id, row.updated_at]);
    const location = { id: `${id}:${row.device_id}`, attachment_id: id, device_id: row.device_id, hlc: row.hlc, present: 1 };
    await s.execute('INSERT INTO attachment_locations(id,attachment_id,device_id,hlc,present) VALUES(?,?,?,?,?)', Object.values(location));
    await s.execute('DELETE FROM attachment_staging WHERE id=?', [id]);
    await log('attachment', meta, meta); await log('attachment_location', location, location);
  }
  const current = dataFileCandidates(row.data);
  const attachments = await s.query<Attachment>('SELECT * FROM attachments WHERE record_id=? AND purged=0', [row.id]);
  for (const old of attachments) {
    const deleted_at = current.has(old.id) ? null : row.updated_at;
    if (!!old.deleted_at === !!deleted_at) continue;
    const meta = { ...old, deleted_at, hlc: row.hlc, device_id: row.device_id, updated_at: row.updated_at };
    await s.execute('UPDATE attachments SET deleted_at=?,hlc=?,device_id=?,updated_at=? WHERE id=?', [deleted_at, row.hlc, row.device_id, row.updated_at, old.id]);
    await log('attachment', meta, meta);
  }
}
/** User-requested record purge may remove bytes; unlinked history files are retained until explicit local-copy removal. */
export async function purgeAttachments(s: SqlSession, row: Entry, log: AttachmentLog): Promise<void> {
  const rows = await s.query<Attachment>('SELECT * FROM attachments WHERE record_id=? AND purged=0', [row.id]);
  for (const old of rows) {
    const tombstone = { ...old, name: '', mime: '', size: 0, sha256: '', deleted_at: row.updated_at, purged: 1, hlc: row.hlc, device_id: row.device_id, updated_at: row.updated_at };
    await s.execute("UPDATE attachments SET name='',mime='',size=0,sha256='',deleted_at=?,purged=1,hlc=?,device_id=?,updated_at=? WHERE id=?", [row.updated_at, row.hlc, row.device_id, row.updated_at, old.id]);
    await s.execute("INSERT INTO attachment_gc(id,staged) VALUES(?,0) ON CONFLICT(id) DO NOTHING", [old.id]);
    // Keep an in-flight restore marker until its writer ends or startup recovery
    // observes it. Its rename may happen after this purge's first GC pass.
    await s.execute("UPDATE attachment_local SET state='deleting' WHERE id=? AND state<>'copying'", [old.id]);
    await log('attachment', tombstone, tombstone);
  }
  const staged = await s.query<{ id: string }>('SELECT id FROM attachment_staging WHERE owner_id=?', [row.id]);
  for (const file of staged) await s.execute('INSERT INTO attachment_gc(id,staged) VALUES(?,1) ON CONFLICT(id) DO NOTHING', [file.id]);
}
export async function attachmentRow(s: SqlSession, id: string, ownerId: string): Promise<{ attachment: Attachment | null; staged: StagedAttachment | null }> {
  requireId(id); requireId(ownerId);
  const [attachment] = await s.query<Attachment>('SELECT * FROM attachments WHERE id=? AND record_id=? AND purged=0', [id, ownerId]);
  const [staged] = attachment ? [] : await s.query<StagedAttachment>('SELECT * FROM attachment_staging WHERE id=? AND owner_id=?', [id, ownerId]);
  if (!attachment && !staged) throw new AppError('attachmentMissing');
  return { attachment: attachment ?? null, staged: staged ?? null };
}
export const encodeAttachmentSetting = (bytes: number, stamp: Stamp) => canonical({ bytes, hlc: stamp.hlc, device_id: stamp.device_id });
