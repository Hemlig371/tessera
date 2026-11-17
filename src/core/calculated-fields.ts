import { AppError } from './errors';
import { Decimal, decimalKey, normalizeDecimal } from './decimal';
import { evaluateFormula, formulaDynamic, formulaReferences, parseFormula, type Expression, type FormulaValue } from './formula';
import { activeRecords, type StoredEntry } from './entry-storage';
import { canonical, UUID_RE, type Field, type FieldConfig, type JsonValue, type RecordData } from './model';
import type { SqlSession } from './ports';
import { decimalTypes, validDate, validTime } from './field-values';
import { textSortKey } from './search-keys';

export const isCalculated = (type: string) => type === 'formula' || type === 'aggregate';
const config = (field: Field): FieldConfig => JSON.parse(field.config) as FieldConfig;
function nextCollection(field: Field, fields: Map<string, Field>): string {
  if (field.type === 'relation') return config(field).target_collection_id!;
  if (field.type === 'backlink') {
    const source = fields.get(config(field).source_field_id!);
    if (source?.type === 'relation' && config(source).target_collection_id === field.collection_id) return source.collection_id;
  }
  throw new AppError('formulaReference');
}
function pathField(collection: string, path: string[], fields: Map<string, Field>): Field {
  let leaf: Field | undefined;
  for (let index = 0; index < path.length; index++) {
    leaf = fields.get(path[index]!);
    if (!leaf || leaf.collection_id !== collection || leaf.type === 'secret') throw new AppError('formulaReference');
    if (index < path.length - 1) collection = nextCollection(leaf, fields);
  }
  if (!leaf) throw new AppError('formulaReference'); return leaf;
}
async function catalog(s: SqlSession): Promise<Map<string, Field>> {
  return new Map((await s.query<Field>('SELECT * FROM fields WHERE deleted_at IS NULL')).map(field => [field.id, field]));
}
const relevantCollections = new WeakMap<SqlSession, Set<string>>();
export function resetCalculatedMetadata(s: SqlSession) { relevantCollections.delete(s); }
async function relevant(s: SqlSession): Promise<Set<string>> {
  const cached = relevantCollections.get(s); if (cached) return cached;
  const fields = await catalog(s), collections = new Set<string>();
  for (const field of fields.values()) if (isCalculated(field.type)) {
    collections.add(field.collection_id);
    try {
      for (const path of formulaReferences(parseFormula(config(field).formula ?? ''))) {
        let collection = field.collection_id;
        try {
          for (const id of path) {
            collections.add(collection); const target = fields.get(id);
            if (!target || target.collection_id !== collection) break;
            if (['relation', 'backlink'].includes(target.type)) { collection = nextCollection(target, fields); collections.add(collection); }
          }
        } catch { /* Other paths can still be used by a lazy IF branch. */ }
      }
    } catch { /* A broken expression remains an explicit per-field error. */ }
  }
  relevantCollections.set(s, collections); return collections;
}
export async function validateCalculatedField(s: SqlSession, field: Field): Promise<void> {
  const fields = await catalog(s), graph = new Map<string, string[]>();
  for (const current of fields.values()) if (isCalculated(current.type)) {
    let expression: Expression;
    try { expression = parseFormula(config(current).formula ?? ''); } catch (error) { if (current.id === field.id) throw error; else continue; }
    const dependencies: string[] = [];
    for (const path of formulaReferences(expression)) {
      try { const leaf = pathField(current.collection_id, path, fields); if (isCalculated(leaf.type)) dependencies.push(leaf.id); }
      catch (error) { if (current.id === field.id) throw error; /* Existing broken references remain visible, without blocking unrelated edits. */ }
    }
    graph.set(current.id, dependencies);
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new AppError('formulaCycle'); if (visited.has(id)) return;
    visiting.add(id); for (const dependency of graph.get(id) ?? []) visit(dependency); visiting.delete(id); visited.add(id);
  }
  for (const id of graph.keys()) visit(id);
  if (isCalculated(field.type) && config(field).indexed && new Calculator(s, fields).dynamic.has(field.id)) throw new AppError('dynamicFormulaIndex');
}

/** Both ends are visited: forward formulas and reverse aggregates become stale
 * in the same transaction as the source edit. Old and new links are invalidated. */
export async function invalidateCalculated(s: SqlSession, changed?: readonly { id: string; collection_id: string }[]): Promise<void> {
  if (!changed) {
    resetCalculatedMetadata(s);
    await s.execute("UPDATE records SET sort_data=json_remove(sort_data,'$._formula') WHERE json_type(sort_data,'$._formula') IS NOT NULL"); return;
  }
  const collections = await relevant(s), ids = changed.filter(row => collections.has(row.collection_id)).map(row => row.id);
  if (!ids.length) return;
  const visited = new Set(ids), pending = [...ids], scope = [...collections], scopeMarks = scope.map(() => '?').join(',');
  for (let offset = 0; offset < pending.length;) {
    const batch = pending.slice(offset, offset + 100), marks = batch.map(() => '?').join(',');
    offset += batch.length;
    const adjacent = await s.query<{ id: string }>(`SELECT ri.source_record_id AS id FROM relation_index ri JOIN records r ON r.id=ri.source_record_id WHERE ri.target_record_id IN(${marks}) AND r.collection_id IN(${scopeMarks}) UNION SELECT ri.target_record_id AS id FROM relation_index ri JOIN records r ON r.id=ri.target_record_id WHERE ri.source_record_id IN(${marks}) AND r.collection_id IN(${scopeMarks})`, [...batch, ...scope, ...batch, ...scope]);
    for (const { id } of adjacent) if (!visited.has(id)) { visited.add(id); pending.push(id); }
  }
  for (let offset = 0; offset < pending.length; offset += 200) {
    const batch = pending.slice(offset, offset + 200);
    await s.execute(`UPDATE records SET sort_data=json_remove(sort_data,'$._formula') WHERE id IN(${batch.map(() => '?').join(',')})`, batch);
  }
}

type Cached = { value: JsonValue; error: string | null; dynamic: boolean; definition: string; exact?: { numerator: string; denominator: string } };
class Calculator {
  private rows = new Map<string, StoredEntry>();
  private expressions = new Map<string, Expression>();
  private parseIssues = new Map<string, string>();
  private memo = new Map<string, Cached>();
  readonly dynamic = new Set<string>();
  private budget = 200000;
  constructor(private readonly s: SqlSession, readonly fields: Map<string, Field>, private readonly preview?: { id: string; collection: string; data: RecordData }, private readonly now = () => new Date()) {
    for (const field of fields.values()) if (isCalculated(field.type)) {
      try { this.expressions.set(field.id, parseFormula(config(field).formula ?? '')); }
      catch (error) { this.parseIssues.set(field.id, error instanceof Error && /^[a-zA-Z]+$/.test(error.message) ? error.message : 'formulaSyntax'); }
    }
    const dynamic = (id: string, visiting = new Set<string>()): boolean => {
      if (visiting.has(id)) return false; visiting.add(id);
      const expression = this.expressions.get(id), field = fields.get(id);
      if (!expression || !field) return false;
      return formulaDynamic(expression) || formulaReferences(expression).some(path => {
        try { const leaf = pathField(field.collection_id, path, fields); return isCalculated(leaf.type) && dynamic(leaf.id, new Set(visiting)); } catch { return false; }
      });
    };
    for (const id of this.expressions.keys()) if (dynamic(id)) this.dynamic.add(id);
  }
  private async row(id: string): Promise<StoredEntry> {
    if (this.rows.has(id)) return this.rows.get(id)!;
    const [row] = await this.s.query<StoredEntry>('SELECT r.* ' + activeRecords + ' AND r.id=?', [id]);
    if (!row) throw new AppError('formulaReference');
    this.rows.set(id, row); if (this.rows.size > 1000) this.rows.delete(this.rows.keys().next().value!); return row;
  }
  private async data(id: string): Promise<RecordData> {
    return this.preview?.id === id ? this.preview.data : JSON.parse((await this.row(id)).data) as RecordData;
  }
  private async linked(id: string, field: Field): Promise<string[]> {
    if (field.type === 'backlink') return (await this.s.query<{ id: string }>(`SELECT ri.source_record_id AS id FROM relation_index ri
      JOIN records r ON r.id=ri.source_record_id JOIN collections c ON c.id=r.collection_id JOIN libraries l ON l.id=c.library_id
      WHERE ri.target_record_id=? AND ri.field_id=? AND r.deleted_at IS NULL AND r.purged=0 AND c.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY ri.source_record_id`, [id, config(field).source_field_id!])).map(row => row.id);
    const value = (await this.data(id))[field.id], ids = value == null ? [] : Array.isArray(value) ? value : [value];
    if (ids.some(item => typeof item !== 'string' || !UUID_RE.test(item))) throw new AppError('formulaType');
    return ids as string[];
  }
  private async resolve(id: string, collection: string, path: string[], stack: Set<string>): Promise<FormulaValue> {
    if (--this.budget < 0) throw new AppError('formulaBudget');
    const field = this.fields.get(path[0]!);
    if (!field || field.collection_id !== collection || field.type === 'secret') throw new AppError('formulaReference');
    if (path.length > 1 || ['relation', 'backlink'].includes(field.type)) {
      const target = nextCollection(field, this.fields), ids = await this.linked(id, field);
      if (config(field).required && !ids.length) throw new AppError('formulaReference');
      if (ids.length > 100000) throw new AppError('formulaBudget');
      const values: FormulaValue[] = [];
      for (const linked of ids) {
        if ((await this.row(linked)).collection_id !== target) throw new AppError('formulaReference');
        values.push(path.length > 1 ? await this.resolve(linked, target, path.slice(1), stack) : linked);
      }
      return field.type === 'relation' && !config(field).multiple && values.length === 1 ? values[0]! : values;
    }
    if (isCalculated(field.type)) {
      const result = await this.compute(id, field, stack); if (result.error) throw new AppError(result.error);
      return result.value === null ? null : (config(field).result_type ?? 'decimal') === 'decimal' ? result.exact ? new Decimal(BigInt(result.exact.numerator), BigInt(result.exact.denominator)) : Decimal.parse(result.value as string) : result.value as string | boolean;
    }
    const value = (await this.data(id))[field.id];
    if (value == null || value === '') { if (config(field).required) throw new AppError('formulaReference'); return null; }
    if (decimalTypes.has(field.type)) { if (typeof value !== 'string') throw new AppError('formulaType'); return Decimal.parse(value); }
    if (field.type === 'integer') { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new AppError('formulaType'); return Decimal.parse(String(value)); }
    if (typeof value === 'boolean' || typeof value === 'string') return value;
    throw new AppError('formulaType');
  }
  private result(value: FormulaValue, settings: FieldConfig): JsonValue {
    if (value === null) return null;
    const type = settings.result_type ?? 'decimal';
    if (type === 'decimal') { if (!(value instanceof Decimal)) throw new AppError('formulaType'); return normalizeDecimal(value.toString()); }
    if (type === 'boolean') { if (typeof value !== 'boolean') throw new AppError('formulaType'); return value; }
    if (typeof value !== 'string') throw new AppError('formulaType');
    if (value.length > 1024 * 1024) throw new AppError('formulaBudget');
    if (type === 'date' && !validDate(value)) throw new AppError('formulaDate');
    if (type === 'local_datetime' && (!validDate(value.split('T')[0]!) || !validTime(value.split('T')[1] ?? '') || value.split('T').length !== 2)) throw new AppError('formulaDate');
    return value;
  }
  async compute(id: string, field: Field, stack = new Set<string>()): Promise<Cached> {
    const key = id + ':' + field.id;
    if (stack.has(key)) throw new AppError('formulaCycle');
    if (this.memo.has(key)) return this.memo.get(key)!;
    if (!stack.size) this.budget = 200000;
    const row = this.preview?.id === id ? undefined : await this.row(id), sort = row ? JSON.parse(row.sort_data) as Record<string, JsonValue> : {};
    const cache = sort._formula && typeof sort._formula === 'object' && !Array.isArray(sort._formula) ? sort._formula as unknown as Record<string, Cached> : {};
    const cached = cache[field.id];
    if (!this.preview && !this.dynamic.has(field.id) && cached?.definition === field.hlc) { this.memo.set(key, cached); return cached; }
    const result: Cached = { value: null, error: null, dynamic: this.dynamic.has(field.id), definition: field.hlc };
    try {
      if (this.parseIssues.has(field.id)) throw new AppError(this.parseIssues.get(field.id)!);
      const next = new Set(stack); next.add(key);
      const value = await evaluateFormula(this.expressions.get(field.id)!, { resolve: path => this.resolve(id, field.collection_id, path, next), now: this.now });
      result.value = this.result(value, config(field));
      if (value instanceof Decimal) result.exact = { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
    } catch (error) { result.error = error instanceof Error && /^[a-zA-Z]+$/.test(error.message) ? error.message : 'formulaType'; }
    this.memo.set(key, result);
    if (this.memo.size > 1000) this.memo.delete(this.memo.keys().next().value!);
    if (row && !this.preview) {
      cache[field.id] = result; sort._formula = cache as unknown as JsonValue;
      sort[field.id] = result.error || result.value === null ? null : (config(field).result_type ?? 'decimal') === 'decimal' ? decimalKey(result.value as string) : config(field).result_type === 'text' ? textSortKey(result.value as string) : typeof result.value === 'boolean' ? Number(result.value) : result.value;
      row.sort_data = canonical(sort);
      await this.s.execute('UPDATE records SET sort_data=json_set(sort_data,?,json(?),?,json(?)) WHERE id=?', [`$._formula."${field.id}"`, canonical(result as unknown as JsonValue), `$."${field.id}"`, canonical(sort[field.id]!), id]);
    }
    return result;
  }
  async previewExpression(id: string, collection: string, expression: Expression, resultType: FieldConfig['result_type']): Promise<JsonValue> {
    return this.result(await evaluateFormula(expression, { resolve: path => this.resolve(id, collection, path, new Set()), now: this.now }), { result_type: resultType });
  }
}

/** Static keys are ready for the entire collection before SQLite filters/pages.
 * NOW and its dependents are display-only; only requested rows are refreshed. */
export async function ensureCalculated(s: SqlSession, collection: string, ids?: readonly string[], now?: () => Date): Promise<Set<string>> {
  const fields = await catalog(s), selected = [...fields.values()].filter(field => field.collection_id === collection && isCalculated(field.type));
  if (!selected.length) return new Set();
  const calculator = new Calculator(s, fields, undefined, now), dynamic = new Set(selected.filter(field => calculator.dynamic.has(field.id)).map(field => field.id));
  const needed = ids ? selected : selected.filter(field => !dynamic.has(field.id));
  if (!needed.length) return dynamic;
  const clauses = needed.map(field => `json_extract(r.sort_data,'$._formula."${field.id}".definition') IS NOT ?`);
  let after = '';
  for (;;) {
    const rows = ids ? ids.map(id => ({ id })) : await s.query<{ id: string }>('SELECT r.id ' + activeRecords + ` AND r.collection_id=? AND r.id>? AND (${clauses.join(' OR ')}) ORDER BY r.id LIMIT 100`, [collection, after, ...needed.map(field => field.hlc)]);
    for (const row of rows) { for (const field of needed) await calculator.compute(row.id, field); after = row.id; }
    if (ids || rows.length < 100) break;
  }
  return dynamic;
}
export async function calculatedDynamics(s: SqlSession): Promise<Set<string>> { return new Calculator(s, await catalog(s)).dynamic; }
export async function previewCalculated(s: SqlSession, collection: string, data: RecordData, id: string, source?: string, now?: () => Date, resultType: FieldConfig['result_type'] = 'decimal') {
  const fields = await catalog(s), calculator = new Calculator(s, fields, { id, collection, data }, now);
  if (source != null) {
    return calculator.previewExpression(id, collection, parseFormula(source), resultType);
  }
  const values: Record<string, Cached> = {};
  for (const field of fields.values()) if (field.collection_id === collection && isCalculated(field.type)) values[field.id] = await calculator.compute(id, field);
  return values;
}
