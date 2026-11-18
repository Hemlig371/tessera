import { AppError } from './errors';
import { validDate } from './field-values';
import type { Field, FieldConfig } from './model';
import type { SqlValue } from './ports';
import { relativeDateInterval, shiftLocalDate } from './relative-dates';

export type DateSelection = { field_id: string; period: 'today' | 'week' } | { field_id: string; period: 'range'; start: string; end: string };
export function dateFieldType(field: Pick<Field, 'type' | 'config'>): string {
  return ['formula','aggregate'].includes(field.type) ? (JSON.parse(field.config) as FieldConfig).result_type ?? 'decimal' : field.type;
}
export function selectionInterval(selection: DateSelection, now = new Date()): { start: string; end: string } {
  if (selection.period === 'today' || selection.period === 'week') return relativeDateInterval(selection.period, now);
  if (selection.period !== 'range' || !validDate(selection.start) || !validDate(selection.end) || selection.start > selection.end) throw new AppError('invalidDateRange');
  return { start: selection.start, end: shiftLocalDate(selection.end, 1) };
}
/** SQL expression comes only from the query compiler; values are always bound parameters. */
export function dateSelectionCondition(field: Pick<Field, 'type' | 'config'>, expression: string, interval: { start: string; end: string }): { sql: string; params: SqlValue[] } {
  if (!validDate(interval.start) || !validDate(interval.end) || interval.start >= interval.end) throw new AppError('invalidDateRange');
  const type = dateFieldType(field);
  if (type === 'date_range') return { sql: `(json_extract(${expression},'$.start')<? AND json_extract(${expression},'$.end')>=?)`, params: [interval.end,interval.start] };
  if (!['date','local_datetime'].includes(type)) throw new AppError('invalidFilter');
  const suffix = type === 'local_datetime' ? 'T00:00' : '';
  return { sql: `(${expression}>=? AND ${expression}<?)`, params: [interval.start + suffix, interval.end + suffix] };
}

/** Freeze a relative condition once for multi-page totals/graphs; never save this resolved date to a profile. */
export function freezeDateSelection(selection: DateSelection, now = new Date()): DateSelection {
  const interval = selectionInterval(selection,now);
  return { field_id: selection.field_id,period: 'range',start: interval.start,end: shiftLocalDate(interval.end,-1) };
}
