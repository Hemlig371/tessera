import { AppError } from './errors';
import { nextHlc } from './hlc';
import { canonical, localTimestamp, UUID_RE } from './model';
import type { Collection, Entry, Field, JsonValue, Library, Page, RecordData, Stamp } from './model';
import type { DatabaseAdapter, SqlSession, SqlValue } from './ports';

const requireId = (id: string) => { if (!UUID_RE.test(id)) throw new AppError('invalidId'); };
const nameValue = (value: string) => {
  const name = value.trim();
  if (!name || name.length > 200) throw new AppError('invalidName');
  return name;
};
type StoredEntry = Omit<Entry, 'data'> & { data: string };
const decodeEntry = (row: StoredEntry): Entry => ({ ...row, data: JSON.parse(row.data) as RecordData });

export class Repository {
  private constructor(readonly db: DatabaseAdapter, readonly deviceId: string, readonly datasetId: string) {}
  static async open(db: DatabaseAdapter): Promise<Repository> {
    const ids = await db.transaction(async s => {
      const [format] = await s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='format_version'");
      if (format?.value !== '1') throw new AppError('unsupportedSchema');
      const [dataset] = await s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='dataset_id'");
      const [device] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='device_id'");
      const datasetId = dataset?.value ?? crypto.randomUUID();
      const deviceId = device?.value ?? crypto.randomUUID();
      requireId(datasetId); requireId(deviceId);
      await s.execute("INSERT OR IGNORE INTO app_meta VALUES('dataset_id',?)", [datasetId]);
      await s.execute("INSERT OR IGNORE INTO local_settings VALUES('device_id',?)", [deviceId]);
      return { datasetId, deviceId };
    });
    return new Repository(db, ids.deviceId, ids.datasetId);
  }
  private async stamp(s: SqlSession, id: string = crypto.randomUUID()): Promise<Stamp> {
    const [last] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='hlc'");
    const now = new Date();
    const hlc = nextHlc(this.deviceId, now.getTime(), last?.value);
    await s.execute("INSERT INTO local_settings VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [hlc]);
    return { id, hlc, device_id: this.deviceId, deleted_at: null, created_at: now.toISOString(), updated_at: now.toISOString() };
  }
  private async insert(s: SqlSession, table: 'libraries' | 'collections' | 'fields' | 'records', row: object) {
    const values = Object.values(row) as SqlValue[];
    await s.execute(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${values.map(() => '?').join(',')})`, values);
  }
  private async log(s: SqlSession, entity: string, row: Stamp, payload: JsonValue) {
    await s.execute('INSERT INTO change_log(id,entity_type,entity_id,hlc,device_id,payload) VALUES(?,?,?,?,?,?)',
      [crypto.randomUUID(), entity, row.id, row.hlc, row.device_id, canonical(payload)]);
  }
  async createLibrary(value: string): Promise<Library> {
    const name = nameValue(value);
    return this.db.transaction(async s => {
      const row: Library = { ...await this.stamp(s), name, config: '{}' };
      await this.insert(s, 'libraries', row);
      await this.log(s, 'library', row, { ...row });
      return row;
    });
  }
  listLibraries(): Promise<Library[]> {
    return this.db.read(s => s.query<Library>('SELECT * FROM libraries WHERE deleted_at IS NULL ORDER BY created_at,id LIMIT 200'));
  }
  async createCollection(libraryId: string, value: string, primaryLabel: string): Promise<Collection> {
    requireId(libraryId);
    const name = nameValue(value), label = nameValue(primaryLabel);
    return this.db.transaction(async s => {
      const [library] = await s.query('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [libraryId]);
      if (!library) throw new AppError('notFound');
      const fieldId = crypto.randomUUID();
      const row: Collection = { ...await this.stamp(s), library_id: libraryId, name, primary_field_id: fieldId, incoming_field_id: fieldId, config: '{}' };
      const field: Field = { ...await this.stamp(s, fieldId), collection_id: row.id, name: label, type: 'text', config: '{"required":true,"fts":true}' };
      await this.insert(s, 'collections', row);
      await this.insert(s, 'fields', field);
      await this.log(s, 'collection', row, { ...row });
      await this.log(s, 'field', field, { ...field });
      return row;
    });
  }
  listCollections(libraryId: string): Promise<Collection[]> {
    requireId(libraryId);
    return this.db.read(s => s.query<Collection>(`SELECT c.* FROM collections c JOIN libraries l ON l.id=c.library_id
      WHERE c.library_id=? AND c.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY c.created_at,c.id LIMIT 200`, [libraryId]));
  }
  async saveEntry(collectionId: string, data: RecordData, id?: string): Promise<Entry> {
    requireId(collectionId); if (id) requireId(id);
    if (!data || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) throw new AppError('invalidData');
    for (const key of Object.keys(data)) requireId(key);
    return this.db.transaction(async s => {
      const [collection] = await s.query<Collection>(`SELECT c.* FROM collections c JOIN libraries l ON l.id=c.library_id
        WHERE c.id=? AND c.deleted_at IS NULL AND l.deleted_at IS NULL`, [collectionId]);
      if (!collection) throw new AppError('notFound');
      const [stored] = id ? await s.query<StoredEntry>('SELECT * FROM records WHERE id=? AND collection_id=? AND deleted_at IS NULL AND purged=0', [id, collectionId]) : [];
      if (id && !stored) throw new AppError('notFound');
      const previous = stored ? decodeEntry(stored) : undefined;
      // Preserve values whose field definitions are not available yet.
      const merged = { ...previous?.data, ...data };
      const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [collectionId]);
      for (const field of fields) {
        const config = JSON.parse(field.config) as { required?: boolean };
        const value = merged[field.id];
        if (config.required && (typeof value !== 'string' || !value.trim())) throw new AppError('requiredText');
        if (field.type !== 'text') throw new AppError('unsupportedField');
        if (value != null && typeof value !== 'string') throw new AppError('invalidData');
      }
      const encoded = canonical(merged);
      if (previous && encoded === canonical(previous.data)) return previous;
      const stamp = await this.stamp(s, id);
      const local = localTimestamp(new Date(stamp.updated_at));
      const row: Entry = { ...stamp, collection_id: collectionId, data: merged, purged: 0,
        created_at: previous?.created_at ?? stamp.created_at, created_local: previous?.created_local ?? local, updated_local: local };
      if (previous) {
        await s.execute('UPDATE records SET data=?,updated_at=?,updated_local=?,hlc=?,device_id=? WHERE id=?',
          [encoded, row.updated_at, local, row.hlc, this.deviceId, row.id]);
      } else await this.insert(s, 'records', { ...row, data: encoded });
      const version = { id: crypto.randomUUID(), record_id: row.id, hlc: row.hlc, device_id: this.deviceId, saved_at: row.updated_at, snapshot: { ...row } };
      await s.execute('INSERT INTO record_versions VALUES(?,?,?,?,?,?)',
        [version.id, row.id, row.hlc, this.deviceId, row.updated_at, canonical(version.snapshot)]);
      await this.log(s, 'record', row, { ...row });
      await this.log(s, 'record_version', { ...stamp, id: version.id }, version);
      // Only this stage's implemented, searchable text fields contribute to FTS.
      const text = fields.filter(f => (JSON.parse(f.config) as { fts?: boolean }).fts)
        .map(f => merged[f.id]).filter(v => typeof v === 'string').join('\n');
      await s.execute('DELETE FROM records_fts WHERE record_id=?', [row.id]);
      await s.execute('INSERT INTO records_fts(record_id,body) VALUES(?,?)', [row.id, text]);
      return row;
    });
  }
  getEntry(id: string): Promise<Entry | null> {
    requireId(id);
    return this.db.read(async s => {
      const [row] = await s.query<StoredEntry>('SELECT * FROM records WHERE id=? AND deleted_at IS NULL AND purged=0', [id]);
      return row ? decodeEntry(row) : null;
    });
  }
  async listEntries(collectionId: string, cursor?: Page<Entry>['next'], limit = 100): Promise<Page<Entry>> {
    requireId(collectionId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError('invalidLimit');
    return this.db.read(async s => {
      const params: SqlValue[] = [collectionId];
      const clause = cursor ? 'AND (updated_at < ? OR (updated_at = ? AND id < ?))' : '';
      if (cursor) params.push(cursor.updated_at, cursor.updated_at, cursor.id);
      params.push(limit + 1);
      const rows = await s.query<StoredEntry>(`SELECT * FROM records WHERE collection_id=? AND deleted_at IS NULL AND purged=0
        ${clause} ORDER BY updated_at DESC,id DESC LIMIT ?`, params);
      const items = rows.slice(0, limit).map(decodeEntry), last = items.at(-1);
      return { items, next: rows.length > limit && last ? { updated_at: last.updated_at, id: last.id } : null };
    });
  }
}
