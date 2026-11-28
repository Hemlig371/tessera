import { useTranslation } from 'react-i18next';
import type { Field, JsonValue } from '../core/model';
import { choiceConfig, choiceTone } from './choice-appearance';

export function RecordChoices({ field, value, disabled, change }: {
  field: Field; value?: JsonValue; disabled: boolean; change: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const { options = [], choice_display: display } = choiceConfig(field);
  if (field.type === 'select') {
    const selected = options.find(option => option.id === value);
    return <select className="property-choice" data-tone={choiceTone(selected)} aria-label={field.name}
      disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={event => change(event.currentTarget.value || null)}>
      <option value="">{t('unset')}</option>
      {!selected && typeof value === 'string' && <option value={value} disabled>{t('unavailableChoice')}</option>}
      {options.filter(option => !option.archived || option === selected).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>;
  }

  const ids = Array.isArray(value) ? value : [];
  if (!ids.length) return t('unset');
  return <span className="choice-values">{ids.map((id, index) => {
    const option = options.find(item => item.id === id);
    const label = option?.label ?? t('unavailableChoice');
    return <span key={index} data-tone={choiceTone(option)} data-initials={display === 'initials' && !!option}>
      {display === 'initials' && option ? <><span aria-hidden="true">{Array.from(label.trim())[0]}</span><span className="visually-hidden">{label}</span></> : label}
    </span>;
  })}</span>;
}
