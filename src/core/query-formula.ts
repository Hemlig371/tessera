import { queryPathReader } from './calculated-fields';
import { AppError } from './errors';
import { Decimal } from './decimal';
import { decimalTypes } from './field-values';
import { evaluateFormula, formulaReferences, parseFormula, type FormulaValue } from './formula';
import type { Entry, EntryQuery, Field, FieldConfig, JsonValue } from './model';
import type { SqlSession } from './ports';
import { freezeQueryDates, queryEntries } from './queries';
import { requireId } from './validation';

function fieldValue(field: Field, entry: Pick<Entry, 'data' | 'computed'>): FormulaValue {
  const calculated = field.type === 'formula' || field.type === 'aggregate', result = calculated ? entry.computed?.[field.id] : undefined;
  if (calculated && !result) throw new AppError('formulaReference');
  if (result?.error) throw new AppError(result.error);
  const value = result ? result.value : entry.data[field.id];
  if (value == null || value === '') return null;
  const type = calculated ? (JSON.parse(field.config) as FieldConfig).result_type ?? 'decimal' : field.type;
  if (type === 'integer' || decimalTypes.has(type)) {
    const exact = (result as (typeof result & { exact?: { numerator: string; denominator: string } }))?.exact;
    return exact ? new Decimal(BigInt(exact.numerator), BigInt(exact.denominator)) : Decimal.parse(String(value));
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  throw new AppError('formulaType');
}
/** Widget formula references resolve to complete filtered columns, never a renderer's visible page. */
export async function evaluateQueryFormula(session: SqlSession, query: EntryQuery, source: string, signal?: AbortSignal): Promise<JsonValue> {
  query = await freezeQueryDates(session,query);
  requireId(query.collection_id ?? '');
  const expression = parseFormula(source), now = new Date();
  const fields = await session.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [query.collection_id!]);
  const reader = await queryPathReader(session);
  const columns = new Map<string, { path: string[]; field: Field; values: FormulaValue[]; error: string | null }>();
  for (const path of formulaReferences(expression)) {
    const field = reader.field(query.collection_id!, path);
    if (['file','image','json','coordinates','date_range','relation','backlink','multiselect'].includes(field.type)) throw new AppError('formulaType');
    const key = path.join('.');
    if (!columns.has(key)) columns.set(key, { path, field, values: [], error: null });
  }
  if (columns.size) {
    let cursor: EntryQuery['cursor'] = null;
    do {
      signal?.throwIfAborted();
      const page = await queryEntries(session, { ...query, cursor, limit: 200 });
      for (const row of page.items) for (const column of columns.values()) {
        if (column.values.length >= 100_000) throw new AppError('formulaBudget');
        try { column.values.push(column.path.length === 1 ? fieldValue(column.field, row) : await reader.value(row.id, query.collection_id!, column.path)); }
        catch (error) { column.error ??= error instanceof AppError ? error.code : 'formulaType'; column.values.push(null); }
      }
      cursor = page.next;
    } while (cursor);
  }
  signal?.throwIfAborted();
  const result = await evaluateFormula(expression, { resolve: async path => { const column = columns.get(path.join('.'))!; if (column.error) throw new AppError(column.error); return column.values; }, now: () => now });
  if (Array.isArray(result)) throw new AppError('formulaType');
  return result instanceof Decimal ? result.toString() : result;
}
