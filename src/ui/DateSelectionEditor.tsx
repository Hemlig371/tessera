import { useTranslation } from 'react-i18next';
import { dateFieldType, type DateSelection } from '../core/date-selection';
import type { Field } from '../core/model';
import { localDateLiteral } from '../core/relative-dates';

/** Profile conditions retain relative periods; only explicit ranges store literal dates. */
export function DateSelectionEditor({ fields, value, change }: {
  fields: readonly Field[]; value: DateSelection | null | undefined; change: (value: DateSelection | null) => void;
}) {
  const { t } = useTranslation();
  const dates = fields.filter(field => ['date', 'local_datetime', 'date_range'].includes(dateFieldType(field)));
  const fieldId = value?.field_id ?? dates[0]?.id;
  return <fieldset>
    <legend>{t('dateSelection.label')}</legend>
    <label>{t('dateSelection.period')}<select value={value?.period ?? ''} disabled={!dates.length && !value} onChange={event => {
      if (!event.target.value || !fieldId) change(null);
      else if (event.target.value === 'range') {
        const today = localDateLiteral(); change({ field_id: fieldId, period: 'range', start: today, end: today });
      } else change({ field_id: fieldId, period: event.target.value as 'today' | 'week' });
    }}>
      <option value="">{t('dateSelection.all')}</option>
      <option value="today" disabled={!dates.length}>{t('dateSelection.today')}</option>
      <option value="week" disabled={!dates.length}>{t('dateSelection.week')}</option>
      <option value="range" disabled={!dates.length}>{t('dateSelection.range')}</option>
    </select></label>
    {value && <>
      <label>{t('dateSelection.field')}<select required value={dates.some(field => field.id === value.field_id) ? value.field_id : ''} onChange={event => change({ ...value, field_id: event.target.value })}>
        {!dates.some(field => field.id === value.field_id) && <option value="" />}
        {dates.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
      </select></label>
      {value.period === 'range' && <div className="field-grid">
        <label>{t('dateSelection.start')}<input required type="date" value={value.start} max={value.end} onChange={event => change({ ...value, start: event.target.value })} /></label>
        <label>{t('dateSelection.end')}<input required type="date" value={value.end} min={value.start} onChange={event => change({ ...value, end: event.target.value })} /></label>
      </div>}
    </>}
    <p className="screen-hint">{t(dates.length ? 'dateSelection.hint' : 'dateSelection.noFields')}</p>
  </fieldset>;
}
