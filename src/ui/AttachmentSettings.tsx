import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import { errorKey } from './common';
export function AttachmentSettings({ api, busy, cancel, save }: { api: Repository; busy: boolean; cancel: () => void; save: (bytes: number) => void }) {
  const { t } = useTranslation(), [limit, setLimit] = useState<number | null>(null), [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void api.getAttachmentLimit().then(value => { if (active) { setLimit(value / 1048576); setLoaded(true); } })
      .catch(e => { if (active) { setError(errorKey(e)); setLoaded(true); } });
    return () => { active = false; };
  }, [api, attempt]);
  return <form className="settings-form" onSubmit={event => { event.preventDefault(); if (loaded && !error && limit !== null) save(Math.round(limit * 1048576)); }}>
    {error && <div className="error" role="alert"><strong>{t('fileSettingsUnavailable')}</strong>
      <p>{error === 'generic' ? t('readUnavailableHint') : t(`errors.${error}`, { defaultValue: t('readUnavailableHint') })}</p>
      <button type="button" disabled={busy} onClick={() => { setLoaded(false); setError(null); retry(value => value + 1); }}>{t('retryEntries')}</button>
    </div>}
    {!loaded && <p role="status">{t('loadingSettings')}</p>}
    <p className="screen-hint">{t('attachmentLimitHint')}</p>
    <label>{t('attachmentLimitLabel')}<input aria-label={t('attachmentLimitLabel')} type="number" min="0" step="any" max={Number.MAX_SAFE_INTEGER / 1048576} required disabled={busy || !loaded || !!error} value={limit ?? ''} onChange={event => setLimit(event.target.value === '' ? null : Number(event.target.value))} /></label>
    <div className="form-actions"><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button className="primary" disabled={busy || !loaded || !!error || limit === null}>{t('saveFileSettings')}</button></div>
  </form>;
}
