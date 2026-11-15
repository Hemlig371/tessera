import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { Field, JsonValue } from '../core/model';
export function errorKey(error: unknown): string {
  return error instanceof Error && /^[a-zA-Z]+$/.test(error.message) ? error.message : 'generic';
}
export function ErrorMessage({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="error">
      <strong>{t('errorTitle')}</strong>
      <p>{t(`errors.${code}`, { defaultValue: t('errors.generic') })}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  busy,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="shade">
      <section
        className="editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="dialog-heading">
          <h2 id="editor-title">{title}</h2>
          <button aria-label={t('close')} disabled={busy} onClick={close}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function FieldInput({
  field,
  value,
  change,
  required,
  label,
  disabled = false,
}: {
  field: Pick<Field, 'name' | 'type'>;
  value: JsonValue | undefined;
  change: (value: JsonValue) => void;
  required?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const text = value == null ? '' : String(value);
  const attrs = { disabled, 'aria-label': label ?? field.name };
  if (field.type === 'boolean')
    return (
      <select
        {...attrs}
        value={value == null ? '' : String(value)}
        onChange={(e) => change(e.target.value === '' ? null : e.target.value === 'true')}
      >
        <option value="">{t('unset')}</option>
        <option value="true">{t('yes')}</option>
        <option value="false">{t('no')}</option>
      </select>
    );
  if (field.type === 'multiline')
    return (
      <textarea
        {...attrs}
        required={required}
        rows={4}
        value={text}
        onChange={(e) => change(e.target.value)}
      />
    );
  return (
    <input
      {...attrs}
      required={required}
      type={field.type === 'integer' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      step={field.type === 'integer' ? 1 : undefined}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        change(
          field.type === 'integer' ? (v === '' ? null : Number(v)) : field.type === 'date' ? v || null : v
        );
      }}
    />
  );
}
export function useFormatValue() {
  const { t, i18n } = useTranslation();
  return (field: Field, value: JsonValue | undefined): string => {
    if (value == null || value === '') return t('unset');
    if (typeof value === 'boolean') return t(value ? 'yes' : 'no');
    if (field.type === 'date' && typeof value === 'string') {
      const [year, month, day] = value.split('-').map(Number);
      const d = new Date(0);
      d.setFullYear(year!, month! - 1, day!);
      d.setHours(12);
      return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(d);
    }
    return String(value);
  };
}
