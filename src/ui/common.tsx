import { MarkdownInput } from './MarkdownInput';
import { markdownPreview } from '../core/markdown';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, type ReactNode } from 'react';
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
export function EditorPage({ title, children, close, busy }: {
  title: string; children: ReactNode; close: () => void; busy: boolean;
}) {
  const { t } = useTranslation(), heading = useRef<HTMLHeadingElement>(null), page = useRef<HTMLElement>(null);
  useEffect(() => { if (document.activeElement === document.body) heading.current?.focus(); }, []);
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !event.defaultPrevented &&
        (event.target === document.body || (event.target instanceof Node && page.current?.contains(event.target)))) {
        event.stopPropagation(); close();
      }
    };
    window.addEventListener('keydown', back);
    return () => window.removeEventListener('keydown', back);
  }, [busy, close]);
  return <section ref={page} tabIndex={-1} className="editor-page" data-editor="" role="region" aria-labelledby="editor-title">
    <div className="editor-heading">
      <button aria-label={t('backScreen')} disabled={busy} onClick={close}>← {t('backScreen')}</button>
      <h1 id="editor-title" ref={heading} tabIndex={-1}>{title}</h1>
    </div>
    {children}
  </section>;
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
  if (field.type === 'markdown') return <MarkdownInput value={text} label={label ?? field.name} disabled={disabled} required={required} change={change} />;
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
    if (field.type === 'markdown' && typeof value === 'string') return markdownPreview(value);
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
