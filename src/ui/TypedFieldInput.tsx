import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Decimal, formatDecimal, normalizeDecimal } from '../core/decimal';
import { decimalTypes } from '../core/field-values';
import { canonical, type Field, type FieldConfig, type JsonValue } from '../core/model';

export const typedInputs = new Set(['decimal', 'money', 'select', 'multiselect', 'time', 'local_datetime', 'date_range', 'duration', 'secret', 'coordinates', 'json', 'color']);
export function TypedFieldInput({ field, value, change, required, label, disabled = false }: {
  field: Pick<Field, 'name' | 'type'> & { config?: string }; value: JsonValue | undefined;
  change: (value: JsonValue) => void; required?: boolean; label?: string; disabled?: boolean;
}) {
  const { t, i18n } = useTranslation(), config: FieldConfig = field.config ? JSON.parse(field.config) as FieldConfig : {};
  const name = label ?? field.name, text = value == null ? '' : String(value), attrs = { disabled, 'aria-label': name, required };
  const [jsonText, setJsonText] = useState(value == null ? '' : JSON.stringify(value, null, 2));
  if (field.type === 'secret') return <><input {...attrs} type="password" autoComplete="new-password" value={text} onChange={event => change(event.target.value)} /><small>{t('secretPlaintextHint')}</small></>;
  if (field.type === 'boolean') return <label className="check"><input disabled={disabled} aria-label={name} type="checkbox" role="switch" checked={value === true} onChange={event => change(event.target.checked)} />{value === true ? t('yes') : t('no')}</label>;
  if (field.type === 'select') return <select {...attrs} value={text} onChange={event => change(event.target.value || null)}>
    <option value="">{t('unset')}</option>{(config.options ?? []).filter(option => !option.archived || option.id === value).map(option => <option key={option.id} value={option.id}>{option.label}{option.archived ? ` (${t('archivedChoice')})` : ''}</option>)}
  </select>;
  if (field.type === 'multiselect') return <fieldset disabled={disabled} aria-label={name} className="choice-input">
    {(config.options ?? []).filter(option => !option.archived || (Array.isArray(value) && value.includes(option.id))).map(option => <label className="check" key={option.id}><input type="checkbox" data-option-id={option.id} checked={Array.isArray(value) && value.includes(option.id)} onChange={event => change(event.target.checked ? [...(Array.isArray(value) ? value : []), option.id] : (Array.isArray(value) ? value.filter(id => id !== option.id) : []))} />{option.label}{option.archived ? ` (${t('archivedChoice')})` : ''}</label>)}
  </fieldset>;
  if (field.type === 'date_range' || field.type === 'coordinates') {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}, keys = field.type === 'date_range' ? ['start', 'end'] : ['latitude', 'longitude'];
    return <div className="field-grid">{keys.map(key => <label key={key}>{t(key)}<input disabled={disabled} required={required || Object.values(object).some(Boolean)} aria-label={name + ' · ' + t(key)} type={field.type === 'date_range' ? 'date' : 'text'} inputMode={field.type === 'coordinates' ? 'decimal' : undefined} value={String(object[key] ?? '')} onChange={event => {
      const next = { ...object, [key]: event.target.value.replace(',', '.') }; change(Object.values(next).some(Boolean) ? next : null);
    }} /></label>)}</div>;
  }
  if (field.type === 'json') return <textarea {...attrs} rows={6} spellCheck={false} value={jsonText} onChange={event => {
    setJsonText(event.target.value);
    try { const next: JsonValue = event.target.value.trim() ? JSON.parse(event.target.value) as JsonValue : null; canonical(next); change(next); event.target.setCustomValidity(''); }
    catch { event.target.setCustomValidity(t('errors.invalidJson')); }
  }} />;
  if (field.type === 'time' || field.type === 'local_datetime') return <input {...attrs} type={field.type === 'time' ? 'time' : 'datetime-local'} step="0.001" value={text} onChange={event => change(event.target.value || null)} />;
  if (field.type === 'color') return <div className="color-value"><input disabled={disabled} aria-label={name + ' · ' + t('color')} type="color" value={text || '#000000'} onChange={event => change(event.target.value)} /><input {...attrs} maxLength={7} placeholder="#RRGGBB" value={text} onChange={event => change(event.target.value || null)} /></div>;
  const numeric = field.type === 'integer' || decimalTypes.has(field.type);
  if (!numeric) return <input {...attrs} value={text} onChange={event => change(event.target.value)} />;
  const widget = config.widget ?? 'input';
  let rounded = '';
  try { if (text) rounded = formatDecimal(normalizeDecimal(text), i18n.language); } catch { /* Partial numeric input remains editable. */ }
  const increment = (direction: 1 | -1) => {
    try {
      const next = Decimal.parse(text || '0').add(Decimal.parse(config.step ?? '1').multiply(new Decimal(BigInt(direction)))).toString();
      change(field.type === 'integer' ? Number(next) : normalizeDecimal(next));
    } catch { /* Save validation supplies the field-specific error. */ }
  };
  const minimum = field.type === 'integer' ? config.min ?? 0 : config.decimal_min ?? '0', maximum = field.type === 'integer' ? config.max ?? (widget === 'rating' ? 5 : 100) : config.decimal_max ?? (widget === 'rating' ? '5' : '100');
  return <div className="numeric-input">
    {widget === 'counter' && <button type="button" data-testid="numeric-decrement" aria-label={name + ' −'} disabled={disabled} onClick={() => increment(-1)}>−</button>}
    <input {...attrs} type={field.type === 'integer' ? 'number' : 'text'} inputMode={field.type === 'integer' ? 'numeric' : 'decimal'} step={field.type === 'integer' ? config.step ?? 1 : undefined} value={i18n.language.startsWith('ru') && field.type !== 'integer' ? text.replace('.', ',') : text} onChange={event => change(event.target.value === '' ? null : field.type === 'integer' ? Number(event.target.value) : event.target.value.replace(',', '.'))} onBlur={() => { if (text && field.type !== 'integer') try { change(normalizeDecimal(text)); } catch { /* Keep invalid input for correction. */ } }} />
    {widget === 'counter' && <button type="button" data-testid="numeric-increment" aria-label={name + ' +'} disabled={disabled} onClick={() => increment(1)}>+</button>}
    {rounded && field.type !== 'integer' && <output data-testid="decimal-rounded">{t('roundedValue')}: {rounded}{field.type === 'money' ? ' ' + (config.currency ?? '') : field.type === 'duration' ? ' ' + t('seconds') : ''}</output>}
    {['slider', 'rating'].includes(widget) && <input type="range" disabled={disabled} aria-label={name + ' · ' + t(widget)} min={minimum} max={maximum} step={config.step ?? '1'} value={text || '0'} onChange={event => change(field.type === 'integer' ? Number(event.target.value) : normalizeDecimal(event.target.value))} />}
    {widget === 'progress' && <progress aria-label={name + ' · ' + t('progress')} value={Number(text || 0) - Number(minimum)} max={Number(maximum) - Number(minimum)} />}
  </div>;
}

export function SecretValue({ value }: { value: JsonValue | undefined }) {
  const { t } = useTranslation(), [visible, setVisible] = useState(false);
  if (typeof value !== 'string' || !value) return <>{t('unset')}</>;
  return <span className="secret-value"><span>{visible ? value : '••••••'}</span><button type="button" aria-pressed={visible} onClick={() => setVisible(old => !old)}>{t(visible ? 'hideSecret' : 'showSecret')}</button></span>;
}
