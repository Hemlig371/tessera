import { AppError } from './errors';
import { FieldError } from './entry-data';
import { activeCollection, activeRecords, type StoredEntry } from './entry-storage';
import type {
  Collection,
  Field,
  FieldConfig,
  JsonValue,
  RecordData,
  RelationCursor,
  RelationItem,
  RelationPage,
  RelationSource,
} from './model';
import type { SqlSession, SqlValue } from './ports';
import { fieldConfig, requireId } from './validation';

export function relationIds(value: JsonValue | undefined): string[] {
  return typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
}
export async function validateRelationDefinition(
  s: SqlSession,
  collection: Collection,
  type: string,
  config: FieldConfig,
  old?: Field
): Promise<void> {
  if (type === 'relation') {
    if (old) {
      const before = fieldConfig(old);
      if (
        before.target_collection_id !== config.target_collection_id ||
        !!before.multiple !== !!config.multiple
      )
        throw new AppError('relationDefinitionChange');
      return;
    }
    const target = await activeCollection(s, config.target_collection_id!);
    if (target.library_id !== collection.library_id) throw new AppError('crossLibraryRelation');
  } else if (type === 'backlink') {
    const [source] = await s.query<Field>(
      "SELECT * FROM fields WHERE id=? AND type='relation' AND deleted_at IS NULL",
      [config.source_field_id!]
    );
    if (!source || fieldConfig(source).target_collection_id !== collection.id)
      throw new AppError('invalidRelation');
    const parent = await activeCollection(s, source.collection_id);
    if (parent.library_id !== collection.library_id) throw new AppError('crossLibraryRelation');
  }
}
/** New choices must be live and in the configured collection. Existing dangling IDs survive unrelated edits. */
export async function validateRelationTargets(
  s: SqlSession,
  collection: Collection,
  fields: readonly Field[],
  data: RecordData,
  previous?: RecordData
): Promise<void> {
  const relations = fields.filter((f) => f.type === 'relation');
  const ids = [...new Set(relations.flatMap((f) => relationIds(data[f.id])))];
  if (!ids.length) return;
  type Target = {
    id: string;
    collection_id: string;
    library_id: string;
    deleted_at: string | null;
    purged: number;
    collection_deleted: string | null;
    library_deleted: string | null;
  };
  const targets = new Map<string, Target>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await s.query<Target>(
      `SELECT r.id,r.collection_id,r.deleted_at,r.purged,c.library_id,c.deleted_at AS collection_deleted,l.deleted_at AS library_deleted
      FROM records r JOIN collections c ON c.id=r.collection_id JOIN libraries l ON l.id=c.library_id WHERE r.id IN(${chunk.map(() => '?').join(',')})`,
      chunk
    );
    rows.forEach((row) => targets.set(row.id, row));
  }
  for (const field of relations) {
    const config = fieldConfig(field),
      retained = new Set(relationIds(previous?.[field.id]));
    for (const id of relationIds(data[field.id])) {
      const target = targets.get(id);
      if (
        target &&
        (target.library_id !== collection.library_id || target.collection_id !== config.target_collection_id)
      )
        throw new FieldError('relationTargetMismatch', field.name);
      if (
        (!target ||
          target.deleted_at ||
          target.purged ||
          target.collection_deleted ||
          target.library_deleted) &&
        !retained.has(id)
      )
        throw new FieldError('relationUnavailable', field.name);
    }
  }
}
/** Derived edges preserve target IDs without a target FK, including deleted/missing targets. */
export async function refreshRelationRecords(s: SqlSession, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  await s.execute(`DELETE FROM relation_index WHERE source_record_id IN(${marks})`, ids);
  await s.execute(
    `INSERT INTO relation_index(source_record_id,field_id,target_record_id,ordinal)
    SELECT r.id,f.id,v.value,CAST(v.key AS INTEGER) FROM records r JOIN fields f ON f.collection_id=r.collection_id
    JOIN collections c ON c.id=r.collection_id JOIN collections tc ON tc.id=json_extract(f.config,'$.target_collection_id') AND tc.library_id=c.library_id
    JOIN json_each(CASE WHEN json_extract(f.config,'$.multiple')=1 AND json_type(r.data,'$."'||f.id||'"')='array'
      THEN json_extract(r.data,'$."'||f.id||'"') ELSE json_array(json_extract(r.data,'$."'||f.id||'"')) END) v
    WHERE r.id IN(${marks}) AND r.purged=0 AND f.deleted_at IS NULL AND f.type='relation' AND v.type='text'`,
    ids
  );
  await s.execute(`UPDATE records SET relation_version=1 WHERE id IN(${marks})`, ids);
}
async function requireRelationsReady(s: SqlSession, collectionId: string, ids?: readonly string[]): Promise<void> {
  if (ids && !ids.length) return;
  const subset = ids ? ` AND r.id IN(${ids.map(() => '?').join(',')})` : '';
  if ((await s.query('SELECT r.id ' + activeRecords + ' AND r.collection_id=? AND r.relation_version=0' + subset + ' LIMIT 1', [collectionId, ...(ids ?? [])])).length)
    throw new AppError('relationsUpdating');
}
/** Only the forward source collection owns these derived edges. */
export async function requireFieldRelationsReady(s: SqlSession, field: Field, ids?: readonly string[]): Promise<void> {
  if (field.type === 'relation') return requireRelationsReady(s, field.collection_id, ids);
  if (field.type !== 'backlink') return;
  const [source] = await s.query<Field>("SELECT * FROM fields WHERE id=? AND type='relation' AND deleted_at IS NULL", [fieldConfig(field).source_field_id!]);
  if (source) await requireRelationsReady(s, source.collection_id);
}
export async function relationSources(s: SqlSession, collectionId: string): Promise<RelationSource[]> {
  const parent = await activeCollection(s, collectionId);
  return s.query<RelationSource>(
    `SELECT f.*,c.name AS collection_name FROM fields f JOIN collections c ON c.id=f.collection_id
    WHERE f.type='relation' AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND c.library_id=?
    AND json_extract(f.config,'$.target_collection_id')=? ORDER BY c.position,f.position,f.id`,
    [parent.library_id, collectionId]
  );
}
export async function relationContext(s: SqlSession, fieldId: string) {
  requireId(fieldId);
  const [field] = await s.query<Field>('SELECT * FROM fields WHERE id=? AND deleted_at IS NULL', [fieldId]);
  if (!field || !['relation', 'backlink'].includes(field.type)) throw new AppError('invalidRelation');
  const collection = await activeCollection(s, field.collection_id);
  if (field.type === 'relation') return { field, collection, forward: field };
  const [source] = await s.query<Field>(
    "SELECT * FROM fields WHERE id=? AND type='relation' AND deleted_at IS NULL",
    [fieldConfig(field).source_field_id!]
  );
  const forward = source && fieldConfig(source).target_collection_id === collection.id ? source : undefined;
  return { field, collection, forward };
}
export async function resolveRelationValues(
  s: SqlSession,
  fieldId: string,
  ids: readonly string[]
): Promise<RelationItem[]> {
  if (ids.length > 100) throw new AppError('invalidLimit');
  ids.forEach(requireId);
  const { field, collection } = await relationContext(s, fieldId);
  if (field.type !== 'relation') throw new AppError('invalidRelation');
  if (!ids.length) return [];
  const targetId = fieldConfig(field).target_collection_id!;
  const rows = await s.query<{
    id: string;
    title: string | null;
    deleted_at: string | null;
    purged: number;
    collection_name: string;
    parent_deleted: string | null;
  }>(
    `SELECT r.id,json_extract(r.data,'$."'||c.primary_field_id||'"') AS title,r.deleted_at,r.purged,c.name AS collection_name,c.deleted_at AS parent_deleted
    FROM records r JOIN collections c ON c.id=r.collection_id WHERE r.id IN(${ids.map(() => '?').join(',')}) AND c.id=? AND c.library_id=?`,
    [...ids, targetId, collection.library_id]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    return {
      id,
      title: row?.title ?? '',
      collection_id: targetId,
      collection_name: row?.collection_name ?? '',
      status: !row ? 'missing' : row.deleted_at || row.purged || row.parent_deleted ? 'deleted' : 'available',
    };
  });
}
export async function relationPage(
  s: SqlSession,
  recordId: string,
  fieldId: string,
  cursor?: RelationCursor | null,
  limit = 50
): Promise<RelationPage> {
  requireId(recordId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('invalidLimit');
  const { field, collection, forward } = await relationContext(s, fieldId);
  const [record] = await s.query<StoredEntry>(
    'SELECT r.* ' + activeRecords + ' AND r.id=? AND r.collection_id=?',
    [recordId, collection.id]
  );
  if (!record) throw new AppError('notFound');
  if (!forward) return { items: [], next: null, available: false };
  await requireFieldRelationsReady(s, field, [recordId]);
  const key = recordId + ':' + field.id + ':' + field.hlc + ':' + record.hlc;
  if (cursor && (cursor.query_key !== key || !Number.isSafeInteger(cursor.ordinal) || cursor.ordinal < 0))
    throw new AppError('invalidCursor');
  let items: RelationItem[],
    next: RelationCursor | null = null;
  if (field.type === 'relation') {
    const params: SqlValue[] = [recordId, field.id];
    const after = cursor ? 'AND (ordinal>? OR (ordinal=? AND target_record_id>?))' : '';
    if (cursor) params.push(cursor.ordinal, cursor.ordinal, cursor.key);
    const edges = await s.query<{ target_record_id: string; ordinal: number }>(
      `SELECT target_record_id,ordinal FROM relation_index
      WHERE source_record_id=? AND field_id=? ${after} ORDER BY ordinal,target_record_id LIMIT ?`,
      [...params, limit + 1]
    );
    const visible = edges.slice(0, limit),
      last = visible.at(-1);
    items = await resolveRelationValues(
      s,
      field.id,
      visible.map((row) => row.target_record_id)
    );
    if (edges.length > limit && last)
      next = { key: last.target_record_id, ordinal: last.ordinal, query_key: key };
    const [target] = await s.query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM collections WHERE id=?',
      [fieldConfig(field).target_collection_id!]
    );
    return { items, next, available: !!target && !target.deleted_at };
  }
  const params: SqlValue[] = [recordId, forward.id, collection.library_id];
  if (cursor) params.push(cursor.key);
  const rows = await s.query<{
    id: string;
    collection_id: string;
    collection_name: string;
    title: string | null;
  }>(
    `SELECT r.id,r.collection_id,c.name AS collection_name,json_extract(r.data,'$."'||c.primary_field_id||'"') AS title
    FROM relation_index ri JOIN records r ON r.id=ri.source_record_id JOIN collections c ON c.id=r.collection_id
    WHERE ri.target_record_id=? AND ri.field_id=? AND c.library_id=? AND r.deleted_at IS NULL AND r.purged=0 AND c.deleted_at IS NULL
    ${cursor ? 'AND r.id>?' : ''} ORDER BY r.id LIMIT ?`,
    [...params, limit + 1]
  );
  items = rows.slice(0, limit).map((row) => ({ ...row, title: row.title ?? '', status: 'available' }));
  const last = items.at(-1);
  if (rows.length > limit && last) next = { key: last.id, ordinal: 0, query_key: key };
  const [sourceParent] = await s.query<{ deleted_at: string | null }>(
    'SELECT deleted_at FROM collections WHERE id=?',
    [forward.collection_id]
  );
  return { items, next, available: !!sourceParent && !sourceParent.deleted_at };
}
/** Bounded derived arrays for CSV/list display. Never written into records or versions. */
export async function backlinkValues(
  s: SqlSession,
  fields: readonly Field[],
  ids: readonly string[]
): Promise<Map<string, RecordData>> {
  const result = new Map<string, RecordData>();
  if (!ids.length) return result;
  for (const field of fields.filter((f) => f.type === 'backlink')) {
    await requireFieldRelationsReady(s, field);
    const sourceId = fieldConfig(field).source_field_id!;
    const rows = await s.query<{ target_record_id: string; source_record_id: string }>(
      `SELECT ri.target_record_id,ri.source_record_id FROM relation_index ri
      JOIN fields f ON f.id=ri.field_id JOIN records r ON r.id=ri.source_record_id JOIN collections c ON c.id=r.collection_id
      WHERE ri.field_id=? AND ri.target_record_id IN(${ids.map(() => '?').join(',')}) AND f.deleted_at IS NULL AND r.deleted_at IS NULL AND r.purged=0 AND c.deleted_at IS NULL
      ORDER BY ri.target_record_id,ri.source_record_id`,
      [sourceId, ...ids]
    );
    for (const row of rows) {
      let data = result.get(row.target_record_id);
      if (!data) {
        data = {};
        result.set(row.target_record_id, data);
      }
      ((data[field.id] ??= []) as JsonValue[]).push(row.source_record_id);
    }
  }
  return result;
}

export async function relationPreviews(
  s: SqlSession,
  fields: readonly Field[],
  ids: readonly string[]
): Promise<Map<string, Record<string, { items: RelationItem[]; count: number }>>> {
  const result = new Map<string, Record<string, { items: RelationItem[]; count: number }>>();
  const complex = fields.filter((f) => f.type === 'relation' || f.type === 'backlink');
  if (!complex.length || !ids.length) return result;
  const marks = ids.map(() => '?').join(',');
  for (const field of complex) {
    await requireFieldRelationsReady(s, field, ids);
    const reverse = field.type === 'backlink',
      config = fieldConfig(field);
    const rows = await s.query<{
      owner: string;
      id: string;
      title: string | null;
      collection_id: string | null;
      collection_name: string | null;
      status: RelationItem['status'];
      n: number;
    }>(
      reverse
        ? `
      WITH ranked AS(SELECT ri.target_record_id AS owner,r.id,r.collection_id,c.name AS collection_name,
        json_extract(r.data,'$."'||c.primary_field_id||'"') AS title,count(*) OVER(PARTITION BY ri.target_record_id) AS n,
        row_number() OVER(PARTITION BY ri.target_record_id ORDER BY r.id) AS pos
        FROM relation_index ri JOIN records r ON r.id=ri.source_record_id JOIN collections c ON c.id=r.collection_id JOIN fields f ON f.id=ri.field_id
        WHERE ri.field_id=? AND ri.target_record_id IN(${marks}) AND f.deleted_at IS NULL AND r.deleted_at IS NULL AND r.purged=0 AND c.deleted_at IS NULL)
      SELECT owner,id,title,collection_id,collection_name,'available' AS status,n FROM ranked WHERE pos<=3 ORDER BY owner,pos`
        : `WITH ranked AS(SELECT source_record_id AS owner,target_record_id AS id,ordinal,count(*) OVER(PARTITION BY source_record_id) AS n,
        row_number() OVER(PARTITION BY source_record_id ORDER BY ordinal,target_record_id) AS pos FROM relation_index
        WHERE field_id=? AND source_record_id IN(${marks}))
      SELECT ranked.owner,ranked.id,CASE WHEN c.id IS NOT NULL THEN json_extract(r.data,'$."'||c.primary_field_id||'"') END AS title,
        c.id AS collection_id,c.name AS collection_name,CASE WHEN c.id IS NULL THEN 'missing' WHEN r.deleted_at IS NOT NULL OR r.purged=1 OR c.deleted_at IS NOT NULL THEN 'deleted' ELSE 'available' END AS status,ranked.n
      FROM ranked LEFT JOIN records r ON r.id=ranked.id LEFT JOIN collections c ON c.id=r.collection_id AND c.id=?
      WHERE ranked.pos<=3 ORDER BY ranked.owner,ranked.pos`,
      reverse ? [config.source_field_id!, ...ids] : [field.id, ...ids, config.target_collection_id!]
    );
    for (const row of rows) {
      let record = result.get(row.owner);
      if (!record) {
        record = {};
        result.set(row.owner, record);
      }
      const preview = (record[field.id] ??= { items: [], count: row.n });
      preview.items.push({
        id: row.id,
        title: row.title ?? '',
        collection_id: row.collection_id ?? config.target_collection_id ?? '',
        collection_name: row.collection_name ?? '',
        status: row.status,
      });
    }
  }
  return result;
}
