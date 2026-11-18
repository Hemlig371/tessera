import { AppError } from './errors';
import { validDate, validTime } from './field-values';
import type { EntryListItem, Field } from './model';
import { shiftLocalDate } from './relative-dates';

export interface CalendarDay { date: string; current_month: boolean; count: number; entries: EntryListItem[] }
export function monthGrid(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01')) throw new AppError('invalidDate');
  const first = month + '-01', weekday = new Date(first + 'T12:00:00Z').getUTCDay(), start = shiftLocalDate(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, day) => shiftLocalDate(start, day));
}
/** Bounded previews; counts include all matching rows, including events spanning several days. */
export class CalendarProjection {
  readonly days: CalendarDay[];
  private readonly byDate: Map<string, CalendarDay>;
  private readonly valueType: string;
  constructor(private readonly field: Pick<Field, 'id' | 'type'> & Partial<Pick<Field,'config'>>, month: string, private readonly previewLimit = 5) {
    this.valueType = ['formula','aggregate'].includes(field.type) ? (JSON.parse(field.config ?? '{}') as { result_type?: string }).result_type ?? 'decimal' : field.type;
    if (!['date','local_datetime','date_range'].includes(this.valueType)) throw new AppError('invalidFilter');
    if (!Number.isSafeInteger(previewLimit) || previewLimit < 0 || previewLimit > 200) throw new AppError('invalidData');
    this.days = monthGrid(month).map(date => ({ date, current_month: date.startsWith(month), count: 0, entries: [] }));
    this.byDate = new Map(this.days.map(day => [day.date, day]));
  }
  add(entry: EntryListItem): void {
    const calculated = ['formula','aggregate'].includes(this.field.type),result = calculated ? entry.computed?.[this.field.id] : undefined;
    if (calculated && !result) throw new AppError('formulaReference');
    if (result?.error) throw new AppError(result.error);
    const value = result ? result.value : entry.data[this.field.id];
    if (value == null || value === '') return;
    let start: string, end: string;
    if (this.valueType === 'date_range') {
      if (typeof value !== 'object' || Array.isArray(value) || typeof value.start !== 'string' || typeof value.end !== 'string') throw new AppError('invalidDateRange');
      start = value.start; end = value.end;
      if (!validDate(start) || !validDate(end) || start > end) throw new AppError('invalidDateRange');
    } else {
      if (typeof value !== 'string') throw new AppError('invalidDate');
      start = this.valueType === 'date' ? value : value.slice(0, 10); end = start;
      if (!validDate(start) || (this.valueType === 'local_datetime' && (value[10] !== 'T' || !validTime(value.slice(11))))) throw new AppError('invalidDate');
    }
    const first = this.days[0]!.date, last = this.days.at(-1)!.date;
    if (end < first || start > last) return;
    for (let date = start < first ? first : start; date <= end && date <= last; date = shiftLocalDate(date, 1)) {
      const day = this.byDate.get(date)!; day.count++;
      if (day.entries.length < this.previewLimit) day.entries.push(entry);
    }
  }
}
