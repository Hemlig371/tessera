import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from './MarkdownView';
export function MarkdownInput({ value, label, disabled, required, change }: { value: string; label: string; disabled: boolean; required?: boolean; change: (value: string) => void }) {
  const { t } = useTranslation(), [preview, setPreview] = useState(false);
  return <div className="markdown-input">
    <textarea aria-label={label} value={value} disabled={disabled} required={required} rows={8} onChange={event => change(event.target.value)} />
    <button type="button" aria-expanded={preview} onClick={() => setPreview(old => !old)}>{t(preview ? 'hideMarkdownPreview' : 'showMarkdownPreview')}</button>
    {preview && <MarkdownView source={value} />}
  </div>;
}
