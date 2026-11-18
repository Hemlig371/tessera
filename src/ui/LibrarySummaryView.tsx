import { useTranslation } from 'react-i18next';
import type { EntryListItem, JsonValue } from '../core/model';
import type { SummaryWidget } from '../core/library-summary';
import type { SummaryGroup } from '../core/grouped-summary';
import type { QuickMutation } from '../core/quick-actions';
import { Decimal, formatDecimal } from '../core/decimal';
import { useFormatValue } from './common';
import { CalculatedValue } from './CalculatedValue';
import { QuickActions } from './QuickActions';
import { CalendarView } from './CalendarView';

export type WidgetValue = import('../core/summary-data').SummaryWidgetData;
export interface WidgetState { loading: boolean; error: string | null; data: WidgetValue | null }
export function LibrarySummaryView({ widgets, states, busy, open, create, openCollection, quick, month, day }: {
  widgets: readonly SummaryWidget[]; states: Readonly<Record<string, WidgetState | undefined>>; busy: boolean;
  open: (id: string) => void; create: (widget: SummaryWidget) => void; openCollection: (widget: SummaryWidget) => void;
  quick: (entry: EntryListItem, fieldId: string, mutation: QuickMutation) => Promise<void>;
  month: (widget: SummaryWidget, value: string) => void; day: (widget: SummaryWidget, value: string) => void;
}) {
  const { t, i18n } = useTranslation(), format = useFormatValue();
  function metric(widget: Extract<SummaryWidget, { kind: 'metric' | 'progress' }>, value: JsonValue) {
    if (value == null) return t('unset');
    if (typeof value === 'boolean') return t(value ? 'yes' : 'no');
    if (typeof value !== 'string') return t('errors.formulaType');
    try { return formatDecimal(value,i18n.language,widget.precision) + (widget.currency ? ' ' + widget.currency : ''); } catch { return value; }
  }
  return <section className="library-summary" aria-label={t('librarySummary')} data-testid="library-summary">
    {!widgets.length && <div className="empty"><h2>{t('summaryEmpty')}</h2><p>{t('summaryEmptyHint')}</p></div>}
    {widgets.map(widget => {
      const state = states[widget.id], data = state?.data;
      return <section key={widget.id} className={'summary-widget width-' + widget.width} aria-label={widget.title} aria-busy={state?.loading ?? true} data-widget-id={widget.id}>
        <h2>{widget.title}</h2>
        {state?.error ? <p role="alert">{t('errors.' + state.error,{ defaultValue: t('errors.unexpected') })}</p> : !state || state.loading ? <p role="status">{t('calculating')}</p> : data && <>
          {(widget.kind === 'metric' || widget.kind === 'progress') && (data.kind === 'metric' || data.kind === 'progress') && <>
            <output className="summary-metric" data-testid="summary-metric">{metric(widget,data.value)}</output>
            {widget.kind === 'progress' && data.value != null && (() => {
              try { const ratio = Decimal.parse(String(data.value)).divide(Decimal.parse(widget.goal)); return <><progress aria-label={widget.title} max={1} value={Math.min(1,Math.max(0,Number(ratio.toString(10))))} /><small>{t('summaryGoal',{ goal: formatDecimal(widget.goal,i18n.language) })}</small></>; }
              catch { return <p role="alert">{t('errors.formulaType')}</p>; }
            })()}
          </>}
          {widget.kind === 'chart' && data.kind === 'chart' && <SummaryChart widget={widget} groups={data.groups} field={data.field} />}
          {widget.kind === 'table' && data.kind === 'table' && <SummaryTable widget={widget} data={data} busy={busy} open={open} quick={quick} />}
          {widget.kind === 'list' && data.kind === 'list' && <>
            {!data.entries.length && <p>{t('noEntries')}</p>}
            {data.entries.map(entry => <article className="summary-record" key={entry.id}>
              <button type="button" data-entry-id={entry.id} disabled={busy} onClick={() => open(entry.id)}>{entry.title || t('unset')}</button>
              <dl>{widget.field_ids.flatMap(id => { const field = data.fields.find(field => field.id === id && field.type !== 'secret'); return field ? [<div key={id}><dt>{field.name}</dt><dd>{['formula','aggregate'].includes(field.type) ? <CalculatedValue field={field} value={entry.computed?.[field.id]} /> : format(field,entry.data[field.id])}</dd></div>] : []; })}</dl>
              <QuickActions entry={entry} fields={data.fields} actions={data.actions} busy={busy} execute={(fieldId,mutation) => quick(entry,fieldId,mutation)} />
            </article>)}
          </>}
          {widget.kind === 'calendar' && data.kind === 'calendar' && <CalendarView month={data.month} days={data.days} busy={busy} loading={false} error={null} openEntry={open} changeMonth={value => month(widget,value)} openDay={value => day(widget,value)} />}
          {widget.kind === 'create' && <button type="button" className="primary" disabled={busy} onClick={() => create(widget)}>{t('newEntry')}</button>}
          {widget.kind !== 'create' && <button type="button" disabled={busy} onClick={() => openCollection(widget)}>{t('summaryOpenSource')}</button>}
        </>}
      </section>;
    })}
  </section>;
}
function SummaryChart({ widget, groups, field }: { field: import('../core/model').Field; widget: Extract<SummaryWidget,{ kind: 'chart' }>; groups: readonly SummaryGroup[] }) {
  const { t, i18n } = useTranslation();
  let maximum = new Decimal(0n);
  for (const group of groups) if (group.result.value != null && !group.result.error) { const value = Decimal.parse(group.result.value); const absolute = value.compare(new Decimal(0n)) < 0 ? value.negate() : value; if (absolute.compare(maximum) > 0) maximum = absolute; }
  const shown = groups.slice(0,20);
  const choices = (JSON.parse(field.config) as import('../core/model').FieldConfig).options ?? [];
  const label = (group: SummaryGroup) => field.type === 'select' && typeof group.value === 'string' ? choices.find(option => option.id === group.value)?.label ?? group.value : group.value == null ? t('unset') : typeof group.value === 'boolean' ? t(group.value ? 'yes' : 'no') : typeof group.value === 'object' ? JSON.stringify(group.value) : String(group.value);
  const ratio = (group: SummaryGroup) => group.result.value == null || group.result.error || !maximum.numerator ? 0 : Math.max(-1,Math.min(1,Number(Decimal.parse(group.result.value).divide(maximum).toString(10))));
  return <div className="summary-chart">
    {!shown.length && <p>{t('noEntries')}</p>}
    {widget.style === 'line' && shown.length > 0 && !shown.some(group => group.result.error || group.result.value == null) && <svg role="img" aria-label={widget.title} viewBox="0 0 300 120"><line x1="0" y1="60" x2="300" y2="60" className="chart-axis" /><polyline className="chart-line" points={shown.map((group,index) => `${shown.length > 1 ? index / (shown.length - 1) * 290 + 5 : 150},${60 - ratio(group) * 55}`).join(' ')} /></svg>}
    <dl>{shown.map(group => <div key={group.key}><dt>{label(group)}</dt><dd>{group.result.error ? <span role="alert">{t('errors.'+group.result.error)}</span> : <><span>{group.result.value == null ? t('unset') : formatDecimal(group.result.value,i18n.language)}</span>{widget.style === 'bar' && group.result.value != null && <span className="chart-bar" aria-hidden="true" style={{ width: Math.abs(ratio(group)) * 100 + '%' }} />}</>}</dd></div>)}</dl>
    {groups.length > shown.length && <p className="screen-hint">{t('summaryChartLimit',{ count: shown.length, total: groups.length })}</p>}
  </div>;
}

function SummaryTable({ widget, data, busy, open, quick }: {
  widget: Extract<SummaryWidget,{ kind: 'list' | 'table' }>; data: Extract<WidgetValue,{ kind: 'list' | 'table' }>; busy: boolean;
  open: (id: string) => void; quick: (entry: EntryListItem,fieldId: string,mutation: QuickMutation) => Promise<void>;
}) {
  const { t } = useTranslation(), format = useFormatValue();
  const fields = widget.field_ids.flatMap(id => { const field = data.fields.find(field => field.id === id && field.type !== 'secret'); return field ? [field] : []; });
  if (!data.entries.length) return <p>{t('noEntries')}</p>;
  return <div className="summary-table-scroll"><table><caption className="visually-hidden">{widget.title}</caption><thead><tr><th scope="col">{t('entry')}</th>{fields.map(field => <th scope="col" key={field.id}>{field.name}</th>)}{data.actions?.length ? <th scope="col">{t('quickActions')}</th> : null}</tr></thead>
    <tbody>{data.entries.map(entry => <tr key={entry.id}><th scope="row"><button type="button" data-entry-id={entry.id} disabled={busy} onClick={() => open(entry.id)}>{entry.title || t('unset')}</button></th>{fields.map(field => <td key={field.id}>{['formula','aggregate'].includes(field.type) ? <CalculatedValue field={field} value={entry.computed?.[field.id]} /> : format(field,entry.data[field.id])}</td>)}{data.actions?.length ? <td><QuickActions entry={entry} fields={data.fields} actions={data.actions} busy={busy} execute={(fieldId,mutation) => quick(entry,fieldId,mutation)} /></td> : null}</tr>)}</tbody>
  </table></div>;
}
