import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from './MarkdownView';

interface Props {
  source: string;
  disabled: boolean;
  save: (text: string) => Promise<boolean>;
}

export function RecordChecklist({source, disabled, save}: Props) {
  const {t} = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  async function toggle(text: string) {
    setPending(text);
    try { await save(text); }
    finally { setPending(null); }
  }
  const lines = (pending ?? source).split(/(\r?\n)/);
  const items = lines.flatMap((line, index) => {
    const match = /^([-*+]\s+\[)([ xX])(\]\s+)(.+)$/.exec(line);
    if (!match) return [];
    const [, prefix, mark, separator, label] = match;
    return [{index, prefix, checked: mark !== ' ', tail: separator! + label!, label: label!}];
  });
  // Documents with inline markup, links or nested blocks use the full Markdown renderer.
  if (!items.length || items.some(item => /[[\]_*~`<>\\]/.test(item.label)) ||
      items.length !== lines.filter(line => line.trim()).length) return <MarkdownView source={source} />;

  async function append() {
    if (!draft?.trim() || disabled) return;
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    if (await save(source + (source.endsWith('\n') ? '' : newline) + '- [ ] ' + draft.trim())) setDraft(null);
  }
  return <div className="record-checklist">
    {items.map(item => <label key={item.index}>
      <input type="checkbox" checked={item.checked} disabled={disabled || pending !== null} onChange={() => {
        const next = [...lines];
        next[item.index] = item.prefix + (item.checked ? ' ' : 'x') + item.tail;
        void toggle(next.join(''));
      }} /><span>{item.label}</span>
    </label>)}
    {draft === null ? <button className="checklist-add" disabled={disabled} onClick={() => setDraft('')}>+ {t('addChecklistItem')}</button>
      : <form onSubmit={e => { e.preventDefault(); void append(); }}>
        <input autoFocus aria-label={t('checklistItem')} value={draft} disabled={disabled} onChange={e => setDraft(e.currentTarget.value)} />
        <button type="submit" disabled={disabled || !draft.trim()}>{t('save')}</button>
        <button type="button" disabled={disabled} onClick={() => setDraft(null)}>{t('cancel')}</button>
      </form>}
  </div>;
}
