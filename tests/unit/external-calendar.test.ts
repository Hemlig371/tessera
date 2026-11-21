import { describe, expect, it } from 'vitest';
import { calendarIcs } from '../../src/core/external-calendar';

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
