import { AppError } from './errors';
import { Decimal } from './decimal';
import { decimalTypes } from './field-values';
import type { Entry, Field, FieldConfig } from './model';

export type SummaryOperation = 'count' | 'counta' | 'sum' | 'average' | 'min' | 'max';
export interface SummaryMeasure { operation: SummaryOperation; field_id?: string }
export interface SummaryResult { value: string | null; error: string | null; matched: number }
const operations: SummaryOperation[] = ['count', 'counta', 'sum', 'average', 'min', 'max'];
const calculated = (field: Field) => field.type === 'formula' || field.type === 'aggregate';
function numeric(field: Field) { return field.type === 'integer' || decimalTypes.has(field.type) || (calculated(field) && ((JSON.parse(field.config) as FieldConfig).result_type ?? 'decimal') === 'decimal'); }
export function validateSummaryMeasure(measure: SummaryMeasure, fields: readonly Field[]): Field | undefined {
  if (!measure || !operations.includes(measure.operation)) throw new AppError('invalidUiConfig');
  const field = fields.find(field => field.id === measure.field_id);
  if (!measure.field_id && measure.operation === 'count') return;
  if (!field) throw new AppError('invalidFilter');
  if (field.type === 'secret') throw new AppError('invalidSecret');
  if (measure.operation !== 'counta' && !numeric(field)) throw new AppError('invalidFilter');
  return field;
}
/** Feed every row of the matching query, inside one read transaction; never a UI page subtotal. */
export class QuerySummary {
  private readonly field: Field | undefined;
  private matched = 0;
  private count = 0n;
  private total = new Decimal(0n);
  private extreme: Decimal | null = null;
  private error: string | null = null;
  constructor(private readonly measure: SummaryMeasure, fields: readonly Field[]) { this.field = validateSummaryMeasure(measure, fields); }
  add(entry: Pick<Entry, 'data' | 'computed'>): void {
    this.matched++;
    if (!this.field) { this.count++; return; }
    const result = calculated(this.field) ? entry.computed?.[this.field.id] : undefined;
    if (calculated(this.field) && !result) { this.error ??= 'formulaReference'; return; }
    if (result?.error) { this.error ??= result.error; return; }
    const value = result ? result.value : entry.data[this.field.id];
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (this.measure.operation === 'counta') { this.count++; return; }
    try {
      const exact = (result as (typeof result & { exact?: { numerator: string; denominator: string } }))?.exact;
      const number = exact ? new Decimal(BigInt(exact.numerator), BigInt(exact.denominator)) : Decimal.parse(String(value));
      this.count++;
      if (this.measure.operation === 'sum' || this.measure.operation === 'average') this.total = this.total.add(number);
      if (this.measure.operation === 'min' || this.measure.operation === 'max') {
        if (!this.extreme || number.compare(this.extreme) * (this.measure.operation === 'min' ? 1 : -1) < 0) this.extreme = number;
      }
    } catch (error) { this.error ??= error instanceof AppError ? error.message : 'formulaType'; }
  }
  result(): SummaryResult {
    let value: string | null = null;
    if (!this.error) {
      if (this.measure.operation === 'count' || this.measure.operation === 'counta') value = String(this.count);
      else if (this.measure.operation === 'sum') value = this.total.toString();
      else if (this.measure.operation === 'average') value = this.count ? this.total.divide(new Decimal(this.count)).toString() : null;
      else value = this.extreme?.toString() ?? null;
    }
    return { value, error: this.error, matched: this.matched };
  }
}
