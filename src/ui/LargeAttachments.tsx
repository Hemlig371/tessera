import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import { errorKey } from './common';
import { useFileSize } from './AttachmentList';
import { exportAttachmentGroup } from '../platform/binary-files';

type Catalog = Awaited<ReturnType<Repository['listLargeAttachments']>>;
export function LargeAttachments({ api, busy }: { api: Repository; busy: boolean }) {
  const { t } = useTranslation(), formatSize = useFileSize();
  const [items, setItems] = useState<Catalog['items']>([]);
  const [next, setNext] = useState<Catalog['next']>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, reload] = useState(0), [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api.listLargeAttachments().then(result => {
      if (!active) return;
      setItems(result.items); setNext(result.next); setSelection([]);
    }).catch(e => { if (active) setError(errorKey(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, revision]);
  async function more() {
    if (!next || loading) return;
    setLoading(true); setError(null);
    try {
      const page = await api.listLargeAttachments(next);
      setItems(items.concat(page.items)); setNext(page.next);
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }
  async function exportSelected() {
    if (!selection.length || loading || busy) return;
    setLoading(true); setError(null); setMessage(null);
    try {
      const selected = selection.map(id => items.find(value => value.id === id)).filter((item): item is Catalog['items'][number] => !!item);
      const completed = await exportAttachmentGroup(api, selected);
      if (completed !== null) setMessage(t('largeAttachmentsExported', { count: completed }));
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }
  async function removeSelected() {
    if (!selection.length || loading || busy) return;
    setLoading(true); setError(null);
    try {
      for (const id of selection) {
        const item = items.find(value => value.id === id);
        if (!item) continue;
        await api.removeAttachmentCopy(item.id, item.record_id, true);
      }
      setConfirm(false); reload(value => value + 1);
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }
  const disabled = loading || busy;
  return <section aria-label={t('largeAttachmentsTitle')}>
    <p className="screen-hint">{t('largeAttachmentsHint')}</p>
    {error && <p role="alert">{t('errors.' + error, { defaultValue: t('largeAttachmentsError') })}</p>}
    {loading && <p role="status">{t('attachmentLoading')}</p>}
    {!loading && !items.length && <p>{t('largeAttachmentsEmpty')}</p>}
    <div className="actions">
      <button type="button" disabled={disabled || !selection.length} onClick={() => { void exportSelected(); }}>{t('largeAttachmentsExport')}</button>
      <button type="button" disabled={disabled || !selection.length} onClick={() => setConfirm(true)}>{t('removeAttachmentCopy')}</button>
    </div>
    {message && <p role="status">{message}</p>}
    {confirm && <div role="region" aria-label={t('confirmRemoveAttachmentCopy')}>
      <p>{t('lastAttachmentCopyHint')}</p>
      <button type="button" disabled={disabled} onClick={() => { void removeSelected(); }}>{t('confirmRemoveAttachmentCopy')}</button>
      <button type="button" disabled={disabled} onClick={() => setConfirm(false)}>{t('cancel')}</button>
    </div>}
    <ul className="attachment-list">{items.map(item => <li key={item.id}>
      <label><input type="checkbox" checked={selection.includes(item.id)} disabled={disabled}
        onChange={e => setSelection(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
        <strong>{item.name}</strong> · {formatSize(item.size)}</label>
      <small>{item.library_name} / {item.collection_name} / {item.record_title}</small>
      <small>{t('attachmentStates.' + item.status)}</small>
      {item.status !== 'present' && item.other_copies > 0 && <small>{t('attachmentOtherCopies', { count: item.other_copies })}</small>
    </li>)}</ul>
    {next && <button type="button" disabled={disabled} onClick={() => { void more(); }}>{t('loadMore')}</button>}
  </section>;
}
