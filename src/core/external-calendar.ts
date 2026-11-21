import { AppError } from './errors';

/** Native calendar transport is outside the core: this module only builds an RFC 5545 event. */
export interface ExternalCalendarEvent {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD (all-day) or ISO 8601 timestamp with explicit offset
  end: string; // exclusive for all-day events
  description?: string;
  location?: string;
}

const day = /^\d{4}-\d{2}-\d{2}$/;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function timestamp(value: string): { value: string; epoch: number; allDay: boolean } {
  if (day.test(value)) {
    const epoch = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) throw new AppError('invalidDate');
    return { value: value.replaceAll('-', ''), epoch, allDay: true };
  }
  if (!instant.test(value)) throw new AppError('invalidDate');
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new AppError('invalidDate');
  return { value: new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'), epoch, allDay: false };
}
function escapeText(value: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new AppError('invalidCalendarEvent');
  return value.replace(/\r\n?|\n/g, '\n').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}
/** Fold on UTF-8 code-point boundaries: no physical line may exceed 75 octets. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  let result = '', bytes = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (bytes + width > 75) { result += '\r\n '; bytes = 1; }
    result += char; bytes += width;
  }
  return result;
}
export function calendarIcs(event: ExternalCalendarEvent, createdAt: Date = new Date()): string {
  if (!event.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(event.id) || !event.title.trim() || event.title.length > 4096) throw new AppError('invalidCalendarEvent');
  if (!Number.isFinite(createdAt.getTime())) throw new AppError('invalidDate');
  const start = timestamp(event.start), end = timestamp(event.end);
  if (start.allDay !== end.allDay || end.epoch <= start.epoch) throw new AppError('invalidCalendarEvent');
  const generated = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tessera//Calendar Export//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + event.id + '@tessera.local', 'DTSTAMP:' + generated,
    'DTSTART' + (start.allDay ? ';VALUE=DATE:' : ':') + start.value,
    'DTEND' + (end.allDay ? ';VALUE=DATE:' : ':') + end.value,
    'SUMMARY:' + escapeText(event.title),
    ...(event.description ? ['DESCRIPTION:' + escapeText(event.description)] : []),
    ...(event.location ? ['LOCATION:' + escapeText(event.location)] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
