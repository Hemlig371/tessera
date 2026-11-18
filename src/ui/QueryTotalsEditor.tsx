import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Field } from '../core/model';
import { validateSummaryMeasure, type SummaryMeasure, type SummaryOperation } from '../core/query-summary';

export function QueryTotalsEditor({ fields, measures, change, busy }: { fields: Field[]; measures: SummaryMeasure[]; change: (value: SummaryMeasure[]) => void; busy: boolean }) {
  const { t } = useTranslation(), [operation, setOperation] = useState<SummaryOperation>('count'), [fieldId, setFieldId] = useState('');
  const available = fields.filter(field => { try { validateSummaryMeasure({ operation, field_id: field.id }, [field]); return true; } catch { return false; } });
  const valid = operation === 'count' && !fieldId || available.some(field => field.id === fieldId);
  return <fieldset disabled={busy} className="query-totals-editor"><legend>{t('queryTotals')}</legend><p>{t('queryTotalsHint')}</p>
    {measures.map((measure, index) => <div className="summary-measure" key={index}>
      <span>{t('summaryOperations.' + measure.operation)} · {fields.find(field => field.id === measure.field_id)?.name ?? t('allMatchingRecords')}</span>
      <button type="button" aria-label={t('removeTotal', { number: index + 1 })} onClick={() => change(measures.filter((_, i) => i !== index))}>{t('remove')}</button>
    </div>)}
    <label>{t('summaryOperation')}<select value={operation} onChange={event => { setOperation(event.target.value as SummaryOperation); setFieldId(''); }}>
      {(['count','counta','sum','average','min','max'] as const).map(value => <option value={value} key={value}>{t('summaryOperations.' + value)}</option>)}
    </select></label>
    <label>{t('summaryField')}<select value={fieldId} onChange={event => setFieldId(event.target.value)}>
      <option value="">{t(operation === 'count' ? 'allMatchingRecords' : 'chooseField')}</option>{available.map(field => <option value={field.id} key={field.id}>{field.name}</option>)}
    </select></label>
    <button type="button" disabled={!valid} onClick={() => change([...measures, { operation, ...(fieldId ? { field_id: fieldId } : {}) }])}>{t('addTotal')}</button>
  </fieldset>;
}
