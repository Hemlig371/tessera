import { AppError } from './errors';
import { validDate } from './field-values';

export type RelativeDatePeriod = 'today' | 'week';
/** Calendar arithmetic on literal dates, independent of UTC offsets and DST. */
export function shiftLocalDate(value: string, days: number): string {
  if (!validDate(value) || !Number.isSafeInteger(days)) throw new AppError('invalidDate');
  const [year, month, day] = value.split('-').map(Number), date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day! + days); date.setUTCHours(0, 0, 0, 0);
  if (!Number.isFinite(date.getTime())) throw new AppError('invalidDate');
  const result = date.toISOString().slice(0, 10);
  if (!validDate(result)) throw new AppError('invalidDate');
  return result;
}
export function localDateLiteral(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new AppError('invalidDate');
  return [String(now.getFullYear()).padStart(4, '0'), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
/** Half-open local interval; a week starts on Monday for both supported locales. */
export function relativeDateInterval(period: RelativeDatePeriod, now = new Date()): { start: string; end: string } {
  const today = localDateLiteral(now);
  if (period === 'today') return { start: today, end: shiftLocalDate(today, 1) };
  if (period !== 'week') throw new AppError('invalidFilter');
  const start = shiftLocalDate(today, -((now.getDay() + 6) % 7));
  return { start, end: shiftLocalDate(start, 7) };
}
