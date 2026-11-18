import { useTranslation } from 'react-i18next';
import type { CalendarDay } from '../core/calendar-projection';
import { localDateLiteral } from '../core/relative-dates';

export function CalendarView({ month, days, loading, error, busy, changeMonth, openEntry, openDay }: {
  month: string; days: readonly CalendarDay[]; loading: boolean; error: string | null; busy: boolean;
  changeMonth: (month: string) => void; openEntry: (id: string) => void; openDay: (date: string) => void;
}) {
  const { t, i18n } = useTranslation(), today = localDateLiteral();
  const label = (date: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  function adjacent(direction: -1 | 1) {
    const [year, current] = month.split('-').map(Number), date = new Date(0);
    date.setUTCFullYear(year!, current! - 1 + direction, 1);
    changeMonth(date.toISOString().slice(0, 7));
  }
  return <section className="collection-calendar" aria-label={t('calendar')} data-testid="collection-calendar" aria-busy={loading}>
    <div className="calendar-toolbar"><button type="button" aria-label={t('previousMonth')} disabled={busy} onClick={() => adjacent(-1)}>←</button>
      <label>{t('calendarMonth')}<input type="month" value={month} disabled={busy} onChange={event => { if (event.target.value) changeMonth(event.target.value); }} /></label>
      <button type="button" aria-label={t('nextMonth')} disabled={busy} onClick={() => adjacent(1)}>→</button>
      <button type="button" disabled={busy} onClick={() => changeMonth(today.slice(0, 7))}>{t('today')}</button>
    </div>
    {error ? <p role="alert">{t('errors.' + error, { defaultValue: t('errors.unexpected') })}</p> : loading ? <p role="status">{t('loadingEntries')}</p> : <>
      <div className="calendar-weekdays" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index}>{new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 16 + index)))}</span>)}</div>
      <div className="calendar-days">{days.map(day => <section key={day.date} data-date={day.date} className={'calendar-day' + (!day.current_month ? ' outside-month' : '') + (day.date === today ? ' today' : '')} aria-label={label(day.date)}>
        <button type="button" className="calendar-day-heading" disabled={busy} aria-current={day.date === today ? 'date' : undefined} aria-label={t('openCalendarDay', { date: label(day.date), count: day.count })} onClick={() => openDay(day.date)}><time dateTime={day.date}>{label(day.date)}</time><span>{day.count}</span></button>
        {day.entries.map(entry => <button type="button" className="calendar-entry" key={entry.id} data-entry-id={entry.id} disabled={busy} onClick={() => openEntry(entry.id)}>{entry.title || t('unset')}</button>)}
        {day.count > day.entries.length && <button type="button" disabled={busy} onClick={() => openDay(day.date)}>{t('showAllCount', { count: day.count })}</button>}
      </section>)}</div>
    </>}
  </section>;
}
