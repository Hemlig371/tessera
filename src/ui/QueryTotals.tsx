import { useTranslation } from 'react-i18next';
import { formatDecimal } from '../core/decimal';
import type { Field } from '../core/model';
import type { SummaryMeasure, SummaryResult } from '../core/query-summary';
import { fieldConfig } from '../core/validation';

export function QueryTotals({ measures, values, fields, loading, error }: {
  measures: readonly SummaryMeasure[]; values: readonly SummaryResult[] | null; fields: readonly Field[]; loading: boolean; error: string | null;
}) {
  const { t, i18n } = useTranslation();
  if (!measures.length) return null;
  return <section className="query-totals" aria-label={t('queryTotals')} aria-busy={loading} data-testid="query-totals">
    <p className="screen-hint">{t('queryTotalsHint')}</p>
    {error ? <p role="alert">{t('errors.' + error, { defaultValue: t('errors.unexpected') })}</p> : loading ? <p role="status">{t('calculating')}</p> : <dl>
      {measures.map((measure, index) => {
        const field = fields.find(field => field.id === measure.field_id), result = values?.[index], config = field ? fieldConfig(field) : {};
        let text = t('unset');
        if (result?.value != null) text = formatDecimal(result.value, i18n.language, ['count', 'counta'].includes(measure.operation) ? 0 : config.precision) + (config.currency && !['count','counta'].includes(measure.operation) ? ' ' + config.currency : '');
        return <div key={index}><dt>{t('summaryOperations.' + measure.operation)}{field ? ' · ' + field.name : ''}</dt><dd><output className={result?.error ? 'formula-error' : undefined} data-testid="query-total-value">{result?.error ? t('errors.' + result.error) : text}</output></dd></div>;
      })}
    </dl>}
  </section>;
}
