import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import type { AttachmentView, ByteSource } from '../core/attachments';
import { ErrorMessage, errorKey } from './common';
import { Icon } from './Icon';
import { AttachmentThumbnail } from './AttachmentThumbnail';
export const fileSource = (file: File): ByteSource => ({ name: file.name, mime: file.type, size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) });
export function useFileSize() {
  const { t, i18n } = useTranslation();
  return (bytes: number) => { const power = Math.min(4, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024))); return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: power ? 2 : 0 }).format(bytes / 1024 ** power) + ' ' + t('fileUnits.' + power); };
}
export function AttachmentList({ api, ownerId, ids, busy = false, removeReference, compact = false }: {
  api: Repository; ownerId: string; ids: readonly string[]; busy?: boolean; removeReference?: (id: string) => void; compact?: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0), size = 10, start = Math.min(page * size, Math.max(0, Math.floor((ids.length - 1) / size) * size));
  return <div className="attachments">
    {!ids.length && <small>{t('noAttachments')}</small>}
    <ul className="attachment-list">{ids.slice(start, start + size).map(id => <AttachmentItem key={id} api={api} ownerId={ownerId} id={id} busy={busy}
      removeReference={removeReference ? () => removeReference(id) : undefined} compact={compact} />)}</ul>
    {ids.length > size && <div className="actions"><button type="button" disabled={busy || start === 0} onClick={() => setPage(Math.max(0, page - 1))}>{t('attachmentPrevious')}</button>
      <small>{t('attachmentRange', { start: start + 1, end: Math.min(start + size, ids.length), total: ids.length })}</small>
      <button type="button" disabled={busy || start + size >= ids.length} onClick={() => setPage(page + 1)}>{t('attachmentNext')}</button></div>}
  </div>;
}
function AttachmentItem({ api, ownerId, id, busy, removeReference, compact }: {
  api: Repository; ownerId: string; id: string; busy: boolean; compact: boolean; removeReference?: () => void;
}) {
  const { t } = useTranslation(), format = useFileSize();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [view, setView] = useState<AttachmentView | null>(null), [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false), [revision, refresh] = useState(0), [confirm, setConfirm] = useState(false);
  const [image, setImage] = useState<string | null>(null), [saved, setSaved] = useState(false), [expanded, setExpanded] = useState(false);
  useEffect(() => { let active = true; void api.getAttachmentView(id, ownerId).then(value => { if (active) setView(value); }).catch(e => { if (active) setError(errorKey(e)); }); return () => { active = false; }; }, [api, ownerId, id, revision]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  async function run(action: () => Promise<void>) {
    if (working || busy) return;
    setWorking(true); setError(null); setSaved(false);
    try { await action(); setConfirm(false); refresh(value => value + 1); }
    catch (e) { setError(errorKey(e)); refresh(value => value + 1); }
    finally { setWorking(false); }
  }
  const disabled = busy || working;
  return <li data-attachment-id={id}>
    <div className="attachment-heading">{compact && <AttachmentThumbnail api={api} id={id} ownerId={ownerId} />}<strong>{view?.name ?? t('attachment')}</strong>{view && <small>{format(view.size)}</small>}</div>
    {error && <ErrorMessage code={error} />}
    {!view && !error && <small role="status">{t('attachmentLoading')}</small>}
    {!view && removeReference && <button type="button" disabled={disabled} onClick={removeReference}>{t('unlinkAttachment')}</button>}
    {view && <>
      <small className={'file-state file-state-' + view.status}>{t('attachmentStates.' + view.status)}</small>
      {view.large && <p className="file-hint">{t('largeAttachmentHint')}</p>}
      {view.status === 'missing' && view.other_copies > 0 && <p>{t('attachmentOtherCopies', { count: view.other_copies })}</p>}
      {image && <img data-testid="attachment-image" className="attachment-preview" src={image} alt={view.name} />}
      {saved && <p role="status">{t('attachmentExported')}</p>}
      {compact && <button type="button" className="tessera-attachment-more" aria-label={t('attachmentOptions')} aria-expanded={expanded} disabled={disabled} onClick={() => setExpanded(value => !value)}><Icon name="more" /></button>}
      <div className={compact ? 'actions tessera-attachment-actions' : 'actions'} data-expanded={expanded}>
        {!removeReference && view.status === 'present' && <button type="button" disabled={disabled} onClick={() => { void run(async () => { setSaved(await api.exportAttachment(id, ownerId)); }); }}>{t('exportAttachment')}</button>}
        {!removeReference && view.status === 'present' && ['image/png','image/jpeg','image/gif','image/webp','image/avif','image/bmp'].includes(view.mime) && view.size <= 10 * 1024 * 1024 && <button data-testid="attachment-preview" type="button" disabled={disabled} onClick={() => { void run(async () => {
          const preview = await api.readAttachmentPreview(id, ownerId); if (!active.current) return; setImage(URL.createObjectURL(new Blob([Uint8Array.from(preview.bytes)], { type: preview.mime })));
        }); }}>{t('previewAttachment')}</button>}
        {!removeReference && view.status !== 'deleting' && view.status !== 'copying' && <button type="button" disabled={disabled} onClick={() => { void run(async () => { setView(await api.getAttachmentView(id, ownerId, true)); }); }}>{t('verifyAttachment')}</button>}
        {!removeReference && !view.staged && ['present','corrupt'].includes(view.status) && <button type="button" disabled={disabled} onClick={() => setConfirm(true)}>{t('removeAttachmentCopy')}</button>}
        {!removeReference && view.status === 'deleting' && <button type="button" disabled={disabled} onClick={() => { void run(async () => { const result = await api.collectAttachmentFiles(); if (result.pending) throw new Error('attachmentCleanup'); }); }}>{t('retryAttachmentCleanup')}</button>}
        {removeReference && <button type="button" disabled={disabled} onClick={removeReference}>{t('unlinkAttachment')}</button>}
      </div>
      {!removeReference && view.status === 'missing' && !view.staged && <label className="file-picker">{t('restoreAttachmentCopy')}
        <input type="file" aria-label={t('restoreAttachmentCopyName', { name: view.name })} disabled={disabled} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(() => api.restoreAttachmentCopy(id, ownerId, fileSource(file)));
        }} /></label>}
      {confirm && <section className="attachment-confirm" role="region" aria-label={t('confirmRemoveAttachmentCopy')}>
        <p>{t(view.other_copies ? 'removeAttachmentCopyHint' : 'lastAttachmentCopyHint')}</p>
        <div className="actions"><button type="button" disabled={disabled} onClick={() => { void run(async () => { await api.removeAttachmentCopy(id, ownerId, true); setImage(null); }); }}>{t('confirmRemoveAttachmentCopy')}</button>
          <button type="button" disabled={disabled} onClick={() => setConfirm(false)}>{t('cancel')}</button></div>
      </section>}
    </>}
  </li>;
}
