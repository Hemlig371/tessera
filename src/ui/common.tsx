import { MarkdownInput } from './MarkdownInput';
import { Icon } from './Icon';
import { markdownPreview } from '../core/markdown';
import { useTranslation } from 'react-i18next';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Field, JsonValue } from '../core/model';
import { TypedFieldInput, typedInputs } from './TypedFieldInput';
import { formatDecimal } from '../core/decimal';
import { fieldConfig } from '../core/validation';
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
  const { t } = useTranslation(), heading = useRef<HTMLHeadingElement>(null), page = useRef<HTMLElement>(null), bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  useLayoutEffect(() => {
    const root = page.current, header = bar.current;
    if (!root || !header) return;
    const measure = () => root.style.setProperty('--editor-heading-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(header);
    return () => observer.disconnect();
  }, []);
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
    <div className="editor-heading" ref={bar}>
      <button className="icon-button" title={t('backScreen')} aria-label={t('backScreen')} disabled={busy} onClick={close}><Icon name="back" /><span className="visually-hidden">{t('backScreen')}</span></button>
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
  field: Pick<Field, 'name' | 'type'> & { config?: string };
  value: JsonValue | undefined;
  change: (value: JsonValue) => void;
  required?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const text = value == null ? '' : String(value);
  const attrs = { disabled, 'aria-label': label ?? field.name };
  if (typedInputs.has(field.type) || (field.config && ['integer', 'boolean'].includes(field.type) && JSON.parse(field.config).widget && JSON.parse(field.config).widget !== 'input')) return <TypedFieldInput {...{ field, value, change, required, label, disabled }} />;
  if (['file','image'].includes(field.type)) return <small>{t('fileDefaultsUnavailable')}</small>;
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
      type={field.type === 'integer' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
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
    if (field.type === 'secret') return value ? '••••••' : t('unset');
    if (['file','image'].includes(field.type)) return Array.isArray(value) && value.length ? t('attachmentCount', { count: value.length }) : t('noAttachments');
    if (value == null || value === '') return t('unset');
    const config = fieldConfig(field);
    if (['decimal', 'money', 'duration'].includes(field.type) && typeof value === 'string') return formatDecimal(value, i18n.language, field.type === 'money' ? config.precision ?? 2 : config.precision) + (field.type === 'money' ? ' ' + (config.currency ?? '') : field.type === 'duration' ? ' ' + t('seconds') : '');
    if (field.type === 'select' || field.type === 'multiselect') return (Array.isArray(value) ? value : [value]).map(id => config.options?.find(option => option.id === id)?.label ?? t('unavailableChoice')).join(', ') || t('unset');
    if (field.type === 'json') return JSON.stringify(value);
    if (field.type === 'date_range' && typeof value === 'object' && !Array.isArray(value)) return String(value.start) + ' — ' + String(value.end);
    if (field.type === 'coordinates' && typeof value === 'object' && !Array.isArray(value)) return String(value.latitude) + ', ' + String(value.longitude);
    if (field.type === 'local_datetime' && typeof value === 'string') return value.replace('T', ' ');
    if (field.type === 'barcode' && config.barcode_label) return config.barcode_label + ': ' + String(value);
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
