import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import { ErrorMessage, errorKey } from './common';
export function AttachmentSettings({ api, busy, cancel, save }: { api: Repository; busy: boolean; cancel: () => void; save: (bytes: number) => void }) {
  const { t } = useTranslation(), [limit, setLimit] = useState<number | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void api.getAttachmentLimit().then(value => { if (active) setLimit(value / 1048576); }).catch(e => { if (active) setError(errorKey(e)); }); return () => { active = false; }; }, [api]);
  return <form onSubmit={event => { event.preventDefault(); if (limit !== null) save(Math.round(limit * 1048576)); }}>
    {error && <ErrorMessage code={error} />}
    <p>{t('attachmentLimitHint')}</p>
    <label>{t('attachmentLimitLabel')}<input aria-label={t('attachmentLimitLabel')} type="number" min="0" step="any" max={Number.MAX_SAFE_INTEGER / 1048576} required disabled={busy || limit === null} value={limit ?? ''} onChange={event => setLimit(event.target.value === '' ? null : Number(event.target.value))} /></label>
    <div className="actions"><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button disabled={busy || limit === null}>{t('saveFileSettings')}</button></div>
  </form>;
}
