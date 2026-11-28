import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import type { Entry, Field } from '../core/model';
import { calendarIcs } from '../core/external-calendar';
import { recordCalendarDraft } from '../core/record-calendar';
import { openAndroidCalendarEvent, openAndroidReminder } from '../platform/external-actions';
import { chooseIcsWriter } from '../platform/csv-files';
import { errorKey } from './common';

export function ExternalCalendarActions({ entry, fields, title, busy }: { entry: Entry; fields: Field[]; title: string; busy: boolean }) {
  const { t } = useTranslation();
  const dates = fields.filter(field => ['date', 'date_range', 'local_datetime'].includes(field.type) && entry.data[field.id] != null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  if (!dates.length) return null;
  const chosen = dates.find(f => f.id === fieldId) ?? dates[0]!;
  const android = Capacitor.getPlatform() === 'android';
  const desktop = !android && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  async function perform(reminder: boolean) {
    if (working || busy || (!android && !desktop)) return;
    setWorking(true); setSaved(false); setError(null);
    try {
      const draft = recordCalendarDraft(entry, chosen, title);
      if (android && reminder) await openAndroidReminder(title);
      else if (android) await openAndroidCalendarEvent({
        title, start: draft.startMillis, end: draft.endMillis, allDay: draft.allDay,
      });
      else {
        const writer = await chooseIcsWriter('Tessera-event.ics', t('calendarExport'));
        if (!writer) return;
        try {
          await writer.write(calendarIcs(draft.event));
          await writer.finish(); setSaved(true);
        } catch (e) { await writer.abort().catch(() => undefined); throw e; }
      }
    } catch (e) { setError(errorKey(e)); }
    finally { setWorking(false); }
  }

  if (!android && !desktop) return null;
  return <details className="external-calendar-actions">
    <summary>{t('calendarActions')}</summary>
    {dates.length > 1 && <label>{t('calendarDateField')}
      <select disabled={busy || working} value={chosen.id} onChange={e => setFieldId(e.target.value)}>
        {dates.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
      </select>
    </label>}
    <div className="actions">
      <button type="button" disabled={busy || working} onClick={() => { void perform(false); }}>{android ? t('calendarAdd') : t('calendarExport')}</button>
      {android && <button type="button" disabled={busy || working} onClick={() => { void perform(true); }}>{t('reminderCreate')}</button>}
    </div>
    {saved && <small role="status">{t('calendarExported')}</small>}
    {error && <p role="alert">{t('errors.' + error, { defaultValue: error === 'reminderUnavailable' ? t('reminderFallback') : error === 'calendarOpenFailed' ? t('calendarOpenFailed') : t('calendarUnavailable') })}</p>}
  </details>;
}
