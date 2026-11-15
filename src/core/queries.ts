import { AppError } from './errors';
import type { EntryListItem, EntryQuery, Field, JsonValue, Page, UiDefinition } from './model';
import { canonical } from './model';
import type { SqlSession, SqlValue } from './ports';
import { fieldExpression, searchTerms, textSortKey } from './search-keys';
import { fieldConfig, isText, requireId, validateValue } from './validation';
import { activeRecords, decodeEntry, type StoredEntry } from './entry-storage';

/** Bounded keyset queries; all filtering and ordering happen in SQLite. */
export async function queryEntries(s: SqlSession, input: EntryQuery): Promise<Page<EntryListItem>> {
  for (const id of [input.collection_id, input.library_id]) if (id) requireId(id);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError('invalidLimit');
  const [saved] = input.collection_id
    ? await s.query<{ config: string }>(
        "SELECT config FROM ui_configs WHERE collection_id=? AND kind='list' AND deleted_at IS NULL",
        [input.collection_id]
      )
    : [];
  const q = { ...(saved ? (JSON.parse(saved.config) as UiDefinition).list : {}), ...input };
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
    if (!field) throw new AppError('invalidFilter');
    return fieldExpression(field, 'r.');
  }
  const terms = searchTerms(q.search ?? '');
  if (q.search?.trim() && !terms.length) where.push('0');
  for (const term of terms) {
    where.push(`r.id IN(SELECT records_fts.record_id FROM records_fts JOIN fields sf ON sf.id=records_fts.field_id
      WHERE records_fts MATCH ? AND sf.deleted_at IS NULL AND json_extract(sf.config,'$.fts') IS NOT 0)`);
    params.push(term);
  }
  for (const filter of q.filters ?? []) {
    const field = byId.get(filter.field_id);
    if (!field) throw new AppError('invalidFilter');
    const expr = expression(field.id),
      empty = `(${expr} IS NULL${isText(field.type) ? ` OR ${expr}=''` : ''})`;
    if (filter.op === 'empty' || filter.op === 'filled') {
      where.push(filter.op === 'empty' ? empty : `NOT ${empty}`);
      continue;
    }
    const operator = { eq: '=', ne: '<>', gt: '>', lt: '<' }[filter.op];
    if (!operator || filter.value == null) throw new AppError('invalidFilter');
    validateValue(field.type, filter.value, { ...fieldConfig(field), required: false });
    const value = isText(field.type)
      ? textSortKey(String(filter.value))
      : typeof filter.value === 'boolean'
        ? Number(filter.value)
        : filter.value;
    where.push(`${expr}${operator}?`);
    params.push(value as SqlValue);
  }
  if (q.direction && !['asc', 'desc'].includes(q.direction)) throw new AppError('invalidFilter');
  const direction = q.direction ?? (q.sort_field && q.sort_field !== 'updated_at' ? 'asc' : 'desc');
  const ids = [...new Set([q.group_field, q.sort_field ?? 'updated_at'].filter((id): id is string => !!id))];
  const expressions = [...ids.map(expression), 'r.id'];
  // Derived keys are either fully rebuilt or unavailable; never silently show partial results.
  if (terms.length || ids.some((id) => id !== 'updated_at') || q.filters?.length) {
    if ((await s.query('SELECT r.id ' + activeRecords + ' AND r.sort_version=0 LIMIT 1')).length)
      throw new AppError('searchUpdating');
  }
  const queryKey = canonical({
    collection_id: q.collection_id ?? null,
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
    `SELECT r.*,c.name AS collection_name,json_extract(r.data,'$."'||c.primary_field_id||'"') AS display_title,${projections} ${activeRecords}
    ${where.map((w) => ' AND ' + w).join('')} ORDER BY ${order} LIMIT ?`,
    [...params, limit + 1]
  );
  const visible = rows.slice(0, limit),
    last = visible.at(-1);
  return {
    items: visible.map(row => ({ ...decodeEntry(row), title: String(row.display_title ?? ''), collection_name: String(row.collection_name) })),
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
