import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Field } from '../core/model';
import { quickControls, type QuickActionDefinition, type QuickControl } from '../core/quick-actions';

export function QuickActionsEditor({ fields, actions, change, busy }: { fields: Field[]; actions: QuickActionDefinition[]; change: (value: QuickActionDefinition[]) => void; busy: boolean }) {
  const { t } = useTranslation(), [selected, setSelected] = useState(''), [control, setControl] = useState<QuickControl>('counter');
  const available = fields.filter(field => quickControls(field).length && !actions.some(action => action.field_id === field.id)), current = available.find(field => field.id === selected);
  return <fieldset disabled={busy} className="quick-actions-editor"><legend>{t('quickActions')}</legend><p>{t('quickActionsHint')}</p>
    {actions.map((action, index) => { const field = fields.find(field => field.id === action.field_id); return <div className="quick-action-setting" key={action.field_id}>
      <span>{field?.name ?? t('unavailableField')} · {t('quickControls.' + action.control)}</span>
      <button type="button" disabled={index === 0} aria-label={t('moveUp', { name: field?.name ?? t('unavailableField') })} onClick={() => { const next = [...actions]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; change(next); }}>↑</button>
      <button type="button" aria-label={t('removeQuickAction', { name: field?.name ?? t('unavailableField') })} onClick={() => change(actions.filter((_, position) => position !== index))}>{t('remove')}</button>
    </div>; })}
    <label>{t('quickActionField')}<select value={selected} onChange={event => { setSelected(event.target.value); const field = available.find(field => field.id === event.target.value); if (field) setControl(quickControls(field)[0]!); }}><option value="">{t('chooseField')}</option>{available.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label>
    {current && <label>{t('quickActionControl')}<select value={control} onChange={event => setControl(event.target.value as QuickControl)}>{quickControls(current).map(value => <option key={value} value={value}>{t('quickControls.' + value)}</option>)}</select></label>}
    <button type="button" disabled={!current} onClick={() => { if (current) { change([...actions, { field_id: current.id, control }]); setSelected(''); } }}>{t('addQuickAction')}</button>
  </fieldset>;
}
