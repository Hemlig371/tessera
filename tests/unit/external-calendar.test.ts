import { describe, expect, it } from 'vitest';
import { calendarIcs } from '../../src/core/external-calendar';
import { recordCalendarDraft } from '../../src/core/record-calendar';
import type { Entry, Field } from '../../src/core/model';

describe('external calendar ICS', () => {
  const base = { id: 'record_123', title: 'Встреча, A; B\\C', start: '2026-11-21', end: '2026-11-22' };
  it('serializes all-day dates with exclusive end and escaped text', () => {
    const ics = calendarIcs({ ...base, description: 'line 1\nline 2' }, new Date('2026-11-21T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261121\r\nDTEND;VALUE=DATE:20261122');
    expect(ics).toContain('DTSTAMP:20261121T000000Z');
    expect(ics).toContain('SUMMARY:Встреча\\, A\\; B\\\\C');
    expect(ics).toContain('DESCRIPTION:line 1\\nline 2');
    expect(ics.endsWith('\r\n')).toBe(true);
  });
  it('normalizes offset timestamps to UTC, preserving instants', () => {
    const ics = calendarIcs({ ...base, start: '2026-11-21T11:15:00+03:00', end: '2026-11-21T12:15:00+03:00' });
    expect(ics).toContain('DTSTART:20261121T081500Z');
    expect(ics).toContain('DTEND:20261121T091500Z');
  });
  it('folds Unicode without splitting UTF-8 sequences', () => {
    const ics = calendarIcs({ ...base, title: 'Ж'.repeat(90) });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(decoder.decode(new TextEncoder().encode(line))).toBe(line);
    }
    expect(ics).toContain('\r\n ');
  });
  it('rejects invalid and mixed date types, reverse ranges, unsafe identifiers and controls', () => {
    expect(() => calendarIcs({ ...base, start: '2026-02-30' })).toThrow('invalidDate');
    expect(() => calendarIcs({ ...base, end: '2026-11-20' })).toThrow('invalidCalendarEvent');
    expect(() => calendarIcs({ ...base, end: '2026-11-22T00:00:00Z' })).toThrow('invalidCalendarEvent');
    expect(() => calendarIcs({ ...base, id: 'x\r\nBEGIN:VTODO' })).toThrow('invalidCalendarEvent');
    expect(() => calendarIcs({ ...base, title: 'unsafe\u0000text' })).toThrow('invalidCalendarEvent');
  });
});

describe('record calendar draft', () => {
  const entry = { id: '12345678-1234-4123-8123-123456789abc', data: { day: '2026-03-29', range: { start: '2026-03-29', end: '2026-03-30' }, local: '2026-11-21T11:30' } } as unknown as Entry;
  const field = (id: string, type: string) => ({ id, type }) as Field;
  it('uses exclusive all-day boundaries across DST', () => {
    const day = recordCalendarDraft(entry, field('day', 'date'), 'Task');
    expect(day.event.start).toBe('2026-03-29');
    expect(day.event.end).toBe('2026-03-30');
    expect(day.allDay).toBe(true);
    const range = recordCalendarDraft(entry, field('range', 'date_range'), 'Task');
    expect(range.event.end).toBe('2026-03-31');
    expect(range.endMillis).toBeGreaterThan(range.startMillis);
  });
  it('uses a one-hour default only for local datetime', () => {
    const draft = recordCalendarDraft(entry, field('local', 'local_datetime'), 'Meeting');
    expect(draft.allDay).toBe(false);
    expect(draft.endMillis - draft.startMillis).toBe(3600000);
    expect(calendarIcs(draft.event)).toContain('DTSTART:');
  });
  it('does not invent an event for invalid values', () => {
    expect(() => recordCalendarDraft(entry, field('missing', 'date'), 'Task')).toThrow('invalidDate');
    expect(() => recordCalendarDraft(entry, field('day', 'text'), 'Task')).toThrow('invalidDate');
  });
});
