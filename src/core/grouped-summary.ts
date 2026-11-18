import { AppError } from './errors';
import { canonical, type Entry, type Field, type FieldConfig, type JsonValue } from './model';
import { QuerySummary, type SummaryMeasure, type SummaryResult } from './query-summary';
import { shiftLocalDate } from './relative-dates';
import { validDate } from './field-values';

export type GroupPeriod = 'value' | 'day' | 'week' | 'month';
export interface SummaryGroup { key: string; value: JsonValue; result: SummaryResult }
export class GroupedSummary {
  private readonly field: Field;
  private readonly groups = new Map<string, { value: JsonValue; summary: QuerySummary }>();
  constructor(fieldId: string, private readonly measure: SummaryMeasure, private readonly fields: readonly Field[], private readonly period: GroupPeriod = 'value') {
    const field = fields.find(field => field.id === fieldId);
    if (!field || ['secret','relation','backlink','file','image','json','coordinates','date_range','multiselect'].includes(field.type)) throw new AppError('invalidFilter');
    if (!['value','day','week','month'].includes(period)) throw new AppError('invalidFilter');
    const type = ['formula','aggregate'].includes(field.type) ? (JSON.parse(field.config) as FieldConfig).result_type ?? 'decimal' : field.type;
    if (period !== 'value' && !['date','local_datetime'].includes(type)) throw new AppError('invalidFilter');
    // Validate before scanning, including when the query has no records.
    new QuerySummary(measure, fields);
    this.field = field;
  }
  add(entry: Pick<Entry, 'data' | 'computed'>): void {
    const calculated = ['formula','aggregate'].includes(this.field.type), result = calculated ? entry.computed?.[this.field.id] : undefined;
    if (calculated && !result) throw new AppError('formulaReference');
    if (result?.error) throw new AppError(result.error);
    let value = (result ? result.value : entry.data[this.field.id]) ?? null;
    if (this.period !== 'value' && value != null) {
      if (typeof value !== 'string' || !validDate(value.slice(0,10))) throw new AppError('invalidDate');
      const date = value.slice(0,10);
      value = this.period === 'month' ? date.slice(0,7) : this.period === 'day' ? date : shiftLocalDate(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7));
    }
    const key = canonical(value), group = this.groups.get(key) ?? { value, summary: new QuerySummary(this.measure, this.fields) };
    group.summary.add(entry); this.groups.set(key, group);
  }
  result(): SummaryGroup[] { return [...this.groups].map(([key, group]) => ({ key, value: group.value, result: group.summary.result() })); }
}
