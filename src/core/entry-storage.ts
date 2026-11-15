import { AppError } from './errors';
import type { Collection, Entry, RecordData } from './model';
import type { SqlSession } from './ports';
export type StoredEntry = Omit<Entry, 'data'> & {
  data: string;
  sort_data: string;
  sort_version: number;
  search_data: string;
};
export function decodeEntry(row: StoredEntry): Entry {
  return {
    id: row.id,
    hlc: row.hlc,
    device_id: row.device_id,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    collection_id: row.collection_id,
    created_local: row.created_local,
    updated_local: row.updated_local,
    purged: row.purged,
    data: JSON.parse(row.data) as RecordData,
  };
}
export async function activeCollection(s: SqlSession, id: string): Promise<Collection> {
  const [row] = await s.query<Collection>(
    `SELECT c.* FROM collections c JOIN libraries l ON l.id=c.library_id
    WHERE c.id=? AND c.deleted_at IS NULL AND l.deleted_at IS NULL`,
    [id]
  );
  if (!row) throw new AppError('notFound');
  return row;
}
export const activeRecords = `FROM records r JOIN collections c ON c.id=r.collection_id JOIN libraries l ON l.id=c.library_id
  WHERE r.deleted_at IS NULL AND r.purged=0 AND c.deleted_at IS NULL AND l.deleted_at IS NULL`;
