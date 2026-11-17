import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canonical, type Entry, type Field, type JsonValue } from '../core/model';
import { fieldConfig } from '../core/validation';
import { quickControls, quickValue, type QuickActionDefinition, type QuickMutation } from '../core/quick-actions';
import { useFormatValue } from './common';

export function QuickActions({ entry, fields, actions, busy, execute }: {
  entry: Entry; fields: Field[]; actions: readonly QuickActionDefinition[] | undefined; busy: boolean;
  execute: (fieldId: string, mutation: QuickMutation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const visible = (actions ?? []).flatMap(action => { const field = fields.find(field => field.id === action.field_id); return field && quickControls(field).includes(action.control) ? [{ action, field }] : []; });
  if (!visible.length) return null;
  return <div className="quick-actions" role="group" aria-label={t('quickActions')} data-testid="quick-actions" data-record-id={entry.id}>
    {visible.map(({ action, field }) => <QuickField key={entry.id + ':' + entry.hlc + ':' + field.id} entry={entry} field={field} action={action} busy={busy} execute={mutation => execute(field.id, mutation)} />)}
  </div>;
}
function QuickField({ entry, field, action, busy, execute }: { entry: Entry; field: Field; action: QuickActionDefinition; busy: boolean; execute: (mutation: QuickMutation) => Promise<void> }) {
  const { t } = useTranslation(), format = useFormatValue(), config = fieldConfig(field), value = entry.data[field.id];
  const pending = useRef(false), [saving, setSaving] = useState(false), [draft, setDraft] = useState(value == null ? '0' : String(value));
  const disabled = busy || saving;
  function canIncrement(direction: 1 | -1) { try { quickValue(field, value, { kind: 'increment', direction }); return true; } catch { return false; } }
  async function submit(mutation: QuickMutation) {
    if (disabled || pending.current) return;
    pending.current = true; setSaving(true);
    try { await execute(mutation); } finally { pending.current = false; setSaving(false); }
  }
  function commitRange() {
    const next: JsonValue = field.type === 'integer' ? Number(draft) : draft;
    if (canonical(next) !== canonical(value ?? null)) void submit({ kind: 'set', value: next });
  }
  return <div className="quick-field" data-field-id={field.id}>
    {action.control === 'toggle' ? <label className="check"><input type="checkbox" role="switch" aria-label={field.name} disabled={disabled} checked={value === true} onChange={() => { void submit({ kind: 'toggle' }); }} />{field.name}</label> :
      action.control === 'choice' ? <label>{field.name}<select aria-label={field.name} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={event => { void submit({ kind: 'set', value: event.target.value || null }); }}><option value="">{t('unset')}</option>{(config.options ?? []).filter(option => !option.archived || option.id === value).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <>
        <span>{field.name}: <output data-testid="quick-value">{format(field, value)}</output></span>
        {['counter', 'progress'].includes(action.control) && <div className="quick-counter"><button type="button" aria-label={field.name + ' −'} disabled={disabled || !canIncrement(-1)} onClick={() => { void submit({ kind: 'increment', direction: -1 }); }}>−</button><button type="button" aria-label={field.name + ' +'} disabled={disabled || !canIncrement(1)} onClick={() => { void submit({ kind: 'increment', direction: 1 }); }}>+</button></div>}
        {action.control === 'progress' && <progress aria-label={field.name + ' · ' + t('progress')} value={Number(value ?? 0) - Number(config.min ?? config.decimal_min ?? 0)} max={Number(config.max ?? config.decimal_max ?? 100) - Number(config.min ?? config.decimal_min ?? 0)} />}
        {['slider', 'rating'].includes(action.control) && <input type="range" aria-label={field.name + ' · ' + t(action.control)} disabled={disabled} min={config.min ?? config.decimal_min ?? 0} max={config.max ?? config.decimal_max ?? (action.control === 'rating' ? 5 : 100)} step={config.step ?? '1'} value={draft} onChange={event => setDraft(event.target.value)} onPointerUp={commitRange} onKeyUp={commitRange} onBlur={commitRange} />}
      </>}
  </div>;
}
