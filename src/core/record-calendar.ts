import { AppError } from './errors';
import { validDate, validTime } from './field-values';
import { shiftLocalDate } from './relative-dates';
import type { Entry, Field } from './model';
import type { ExternalCalendarEvent } from './external-calendar';

export interface RecordCalendarDraft { event: ExternalCalendarEvent; startMillis: number; endMillis: number; allDay: boolean }

/** Derive an external event without mutating a record, history or sync journal. */
export function recordCalendarDraft(record: Entry, field: Field, title: string): RecordCalendarDraft {
  const raw = record.data[field.id];
  let start: string, end: string, allDay = true;
  if (field.type === 'date' && typeof raw === 'string' && validDate(raw)) {
    start = raw; end = shiftLocalDate(raw, 1);
  } else if (field.type === 'date_range' && raw && !Array.isArray(raw) && typeof raw === 'object' &&
    typeof raw.start === 'string' && typeof raw.end === 'string' &&
    validDate(raw.start) && validDate(raw.end) && raw.end >= raw.start) {
    start = raw.start; end = shiftLocalDate(raw.end, 1);
  } else if (field.type === 'local_datetime' && typeof raw === 'string' && raw.includes('T') &&
    validDate(raw.slice(0, 10)) && validTime(raw.slice(11))) {
    allDay = false;
    const instant = new Date(raw);
    if (!Number.isFinite(instant.getTime())) throw new AppError('invalidDate');
    const startMillis = instant.getTime(), endMillis = startMillis + 3600000;
    start = new Date(startMillis).toISOString(); end = new Date(endMillis).toISOString();
  } else throw new AppError('invalidDate');

  const startMillis = allDay ? new Date(start + 'T00:00:00').getTime() : Date.parse(start);
  const endMillis = allDay ? new Date(end + 'T00:00:00').getTime() : Date.parse(end);
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis) || endMillis <= startMillis) throw new AppError('invalidDate');
  const event: ExternalCalendarEvent = { id: record.id, title, start, end };
  return { event, startMillis, endMillis, allDay };
}
