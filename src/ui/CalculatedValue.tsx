import { useTranslation } from 'react-i18next';
import type { Entry, Field } from '../core/model';
import { fieldConfig } from '../core/validation';
import { useFormatValue } from './common';

export function CalculatedValue({ field, value }: { field: Field; value: NonNullable<Entry['computed']>[string] | undefined }) {
  const { t } = useTranslation(), format = useFormatValue(), config = fieldConfig(field);
  return <output data-testid="calculated-value" data-field-id={field.id} className={value?.error ? 'formula-error' : undefined}>
    {!value ? t('calculating') : value.error ? t('errors.' + value.error, { defaultValue: t('errors.formulaType') }) : format({ ...field, type: (config.result_type ?? 'decimal') === 'decimal' && config.currency ? 'money' : config.result_type ?? 'decimal' }, value.value)}
  </output>;
}
