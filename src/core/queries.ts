import { requireFieldRelationsReady, relationPreviews } from './relations';
import { AppError } from './errors';
import type { EntryListItem, EntryQuery, Field, JsonValue, Page, UiDefinition } from './model';
import { canonical } from './model';
import type { SqlSession, SqlValue } from './ports';
import { fieldExpression, fieldSortKey, searchTerms } from './search-keys';
import { decimalTypes } from './field-values';
import { ensureCalculated, isCalculated } from './calculated-fields';
import { fieldConfig, isText, requireId, validateValue } from './validation';
import { activeRecords, decodeEntry, type StoredEntry } from './entry-storage';

/** Bounded keyset queries; all filtering and ordering happen in SQLite. */
export async function queryEntries(s: SqlSession, input: EntryQuery): Promise<Page<EntryListItem>> {
  for (const id of [input.collection_id, input.library_id]) if (id) requireId(id);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError('invalidLimit');
  if (input.profile_id) { requireId(input.profile_id); if (!input.collection_id) throw new AppError('invalidFilter'); }
  const [saved] = input.collection_id
    ? await s.query<{ config: string }>(
        `SELECT p.config FROM display_profiles p JOIN collections c ON c.id=p.collection_id
          WHERE p.collection_id=? AND p.deleted_at IS NULL AND p.id=coalesce(?,c.default_profile_id)`,
        [input.collection_id, input.profile_id ?? null]
      )
    : [];
  if (input.profile_id && !saved) throw new AppError('notFound');
  const q = { ...(saved ? (JSON.parse(saved.config) as UiDefinition).list : {}), ...input };
  const dynamic = q.collection_id ? await ensureCalculated(s, q.collection_id) : new Set<string>();
  const params: SqlValue[] = [],
    where: string[] = [];
  if (q.collection_id) {
    where.push('r.collection_id=?');
    params.push(q.collection_id);
  }
  if (q.library_id) {
    where.push('c.library_id=?');
    params.push(q.library_id);
  }
  const scopeWhere = [...where], scopeParams = [...params];
  const fields = q.collection_id
    ? await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [
        q.collection_id,
      ])
    : [];
  const byId = new Map(fields.map((f) => [f.id, f]));
  if (
    !Object.hasOwn(input, 'sort_field') &&
    q.sort_field &&
    q.sort_field !== 'updated_at' &&
    !byId.has(q.sort_field)
  )
    delete q.sort_field;
  if (!Object.hasOwn(input, 'group_field') && q.group_field && !byId.has(q.group_field)) delete q.group_field;
  if (!Object.hasOwn(input, 'filters') && q.filters)
    q.filters = q.filters.filter((f) => byId.has(f.field_id));
  function expression(id: string): string {
    if (id === 'updated_at') return 'r.updated_at';
    const field = byId.get(id);
    if (!field || ['secret', 'relation', 'backlink', 'file', 'image'].includes(field.type)) throw new AppError('invalidFilter');
    if (dynamic.has(field.id)) throw new AppError('dynamicFormulaIndex');
    return fieldExpression(field, 'r.');
  }
  const terms = searchTerms(q.search ?? '');
  if (q.search?.trim() && !terms.length) where.push('0');
  for (const term of terms) {
    where.push(`r.id IN(SELECT records_fts.record_id FROM records_fts JOIN fields sf ON sf.id=records_fts.field_id
      WHERE records_fts MATCH ? AND sf.deleted_at IS NULL AND sf.type IN('text','multiline','markdown','url','email','phone','barcode','address','color','icon') AND json_extract(sf.config,'$.fts') IS NOT 0)`);
    params.push(term);
  }
  for (const filter of q.filters ?? []) {
    const field = byId.get(filter.field_id);
    if (!field) throw new AppError('invalidFilter');
    if (['relation', 'backlink'].includes(field.type)) {
      await requireFieldRelationsReady(s, field);
      if (!['eq', 'ne', 'empty', 'filled'].includes(filter.op)) throw new AppError('invalidFilter');
      const target = field.type === 'relation' ? 'ri.source_record_id=r.id' : 'ri.target_record_id=r.id';
      const sourceField = field.type === 'relation' ? field.id : fieldConfig(field).source_field_id!;
      let clause = `EXISTS(SELECT 1 FROM relation_index ri ${field.type === 'backlink' ? 'JOIN records sr ON sr.id=ri.source_record_id JOIN collections sc ON sc.id=sr.collection_id JOIN fields sf ON sf.id=ri.field_id' : ''} WHERE ${target} AND ri.field_id=? ${field.type === 'backlink' ? 'AND sr.deleted_at IS NULL AND sr.purged=0 AND sc.deleted_at IS NULL AND sf.deleted_at IS NULL' : ''}`;
      params.push(sourceField);
      if (['eq', 'ne'].includes(filter.op)) {
        requireId(filter.value as string);
        clause += field.type === 'relation' ? ' AND ri.target_record_id=?' : ' AND ri.source_record_id=?';
        params.push(filter.value as string);
      }
      where.push((['empty', 'ne'].includes(filter.op) ? 'NOT ' : '') + clause + ')');
      continue;
    }
    if (['file', 'image', 'multiselect'].includes(field.type)) {
      if (!['eq','ne','empty','filled'].includes(filter.op)) throw new AppError('invalidFilter');
      let clause = `EXISTS(SELECT 1 FROM json_each(CASE WHEN json_type(r.data,'$."${field.id}"')='array' THEN json_extract(r.data,'$."${field.id}"') ELSE json('[]') END) af WHERE af.type='text'`;
      if (filter.op === 'eq' || filter.op === 'ne') { requireId(filter.value as string); clause += ' AND af.value=?'; params.push(filter.value as string); }
      where.push((['empty','ne'].includes(filter.op) ? 'NOT ' : '') + clause + ')'); continue;
    }
    const valueType = isCalculated(field.type) ? fieldConfig(field).result_type ?? 'decimal' : field.type;
    const expr = expression(field.id),
      empty = `(${expr} IS NULL${isText(valueType) ? ` OR ${expr}=''` : ''})`;
    if (filter.op === 'empty' || filter.op === 'filled') {
      where.push(filter.op === 'empty' ? empty : `NOT ${empty}`);
      continue;
    }
    const operator = { eq: '=', ne: '<>', gt: '>', lt: '<' }[filter.op];
    if (!operator || filter.value == null) throw new AppError('invalidFilter');
    validateValue(valueType, filter.value, { ...fieldConfig(field), required: false });
    const value = typeof filter.value === 'boolean' ? Number(filter.value) : isText(field.type) || decimalTypes.has(field.type) || field.type === 'select' || isCalculated(field.type)
      ? fieldSortKey(field, String(filter.value))
      : typeof filter.value === 'object' ? canonical(filter.value) : filter.value;
    where.push(`${expr}${operator}?`);
    params.push(value as SqlValue);
  }
  if (q.direction && !['asc', 'desc'].includes(q.direction)) throw new AppError('invalidFilter');
  const direction = q.direction ?? (q.sort_field && q.sort_field !== 'updated_at' ? 'asc' : 'desc');
  const ids = [...new Set([q.group_field, q.sort_field ?? 'updated_at'].filter((id): id is string => !!id))];
  const expressions = [...ids.map(expression), 'r.id'];
  // Derived keys are either fully rebuilt or unavailable; never silently show partial results.
  if (terms.length || ids.some(id => byId.has(id) && (isText(byId.get(id)!.type) || decimalTypes.has(byId.get(id)!.type) || byId.get(id)!.type === 'select')) ||
    q.filters?.some(filter => isText(byId.get(filter.field_id)!.type) || decimalTypes.has(byId.get(filter.field_id)!.type) || byId.get(filter.field_id)!.type === 'select')) {
    if ((await s.query('SELECT r.id ' + activeRecords + ' AND r.sort_version=0' +
      scopeWhere.map(clause => ' AND ' + clause).join('') + ' LIMIT 1', scopeParams)).length)
      throw new AppError('searchUpdating');
  }
  const queryKey = canonical({
    collection_id: q.collection_id ?? null,
    profile_id: q.profile_id ?? null,
    library_id: q.library_id ?? null,
    search: terms,
    filters: q.filters ?? [],
    ids,
    direction,
  } as unknown as JsonValue);
  if (q.cursor) {
    const keys = q.cursor.keys;
    if (
      q.cursor.query_key !== queryKey ||
      !keys ||
      keys.length !== expressions.length ||
      keys.at(-1) !== q.cursor.id
    )
      throw new AppError('invalidCursor');
    const branches: string[] = [];
    for (let i = 0; i < expressions.length; i++) {
      const prefix = expressions.slice(0, i).map((e) => `${e} IS ?`);
      const value = keys[i]!;
      if (value === null) continue; // NULLs are always last.
      const expr = expressions[i]!;
      branches.push(
        `(${[...prefix, `(${expr} IS NULL OR ${expr}${direction === 'asc' ? '>' : '<'}?)`].join(' AND ')})`
      );
      params.push(...keys.slice(0, i), value);
    }
    where.push(branches.length ? `(${branches.join(' OR ')})` : '0');
  }
  const order = expressions.map((e) => `${e} ${direction.toUpperCase()} NULLS LAST`).join(',');
  const projections = expressions.map((e, i) => `${e} AS key${i}`).join(',');
  const rows = await s.query<StoredEntry & Record<string, SqlValue>>(
    `SELECT r.*,c.name AS collection_name,c.system_kind AS collection_system_kind,json_extract(r.data,'$."'||c.primary_field_id||'"') AS display_title,${projections} ${activeRecords}
    ${where.map((w) => ' AND ' + w).join('')} ORDER BY ${order} LIMIT ?`,
    [...params, limit + 1]
  );
  const visible = rows.slice(0, limit),
    last = visible.at(-1);
  if (q.collection_id && dynamic.size && visible.length) {
    await ensureCalculated(s, q.collection_id, visible.map(row => row.id));
    const caches = await s.query<{ id: string; sort_data: string }>(`SELECT id,sort_data FROM records WHERE id IN(${visible.map(() => '?').join(',')})`, visible.map(row => row.id));
    const byId = new Map(caches.map(row => [row.id, row.sort_data]));
    for (const row of visible) row.sort_data = byId.get(row.id)!;
  }
  const previews = await relationPreviews(
    s,
    fields,
    visible.map((row) => row.id)
  );
  return {
    items: visible.map((row) => Object.assign(decodeEntry(row), {
      title: String(row.display_title ?? ''),
      collection_name: String(row.collection_name),
      ...(row.collection_system_kind === 'inbox' ? { collection_system_kind: 'inbox' as const } : {}),
      ...(previews.has(row.id) ? { relation_previews: previews.get(row.id)! } : {}),
    })),
    next:
      rows.length > limit && last
        ? {
            id: last.id,
            updated_at: last.updated_at,
            query_key: queryKey,
            keys: expressions.map((_, i) => last[`key${i}`] ?? null),
          }
        : null,
  };
}
