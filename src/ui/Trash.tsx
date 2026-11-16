import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import { retentionDays, type TrashItem, type TrashPage, type TrashRetention } from '../core/trash';
import { errorKey } from './common';

export function Trash({ api, busy, revision, restore, purge, saveRetention }: {
  api: Repository; busy: boolean; revision: number;
  restore: (item: TrashItem) => void; purge: (item: TrashItem) => void;
  saveRetention: (days: TrashRetention) => void;
}) {
  const { t, i18n } = useTranslation();
  const [library, setLibrary] = useState(''), [libraries, setLibraries] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState<TrashPage | null>(null), [loadingMore, setLoadingMore] = useState(false);
  const [attempt, retry] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null), requestKey = library + ':' + revision + ':' + attempt;
  const loading = loadingMore || loaded !== requestKey;
  const [days, setDays] = useState<TrashRetention>(30), [savedDays, setSavedDays] = useState<TrashRetention>(30);
  const [confirm, setConfirm] = useState<TrashItem | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([api.queryTrash(library || null), api.listTrashLibraries(), api.getTrashRetention()])
      .then(([rows, choices, retention]) => { if (active) { setPage(rows); setLibraries(choices); setDays(retention); setSavedDays(retention); setLoaded(requestKey); setConfirm(null); setError(null); } })
      .catch(e => { if (active) { setError(errorKey(e)); setPage(null); setLoaded(requestKey); } });
    return () => { active = false; };
  }, [api, library, revision, requestKey]);
  const disabled = busy || loading || page === null;
  async function more() {
    if (!page?.next || disabled) return;
    setLoadingMore(true); setError(null);
    try { const next = await api.queryTrash(library || null, page.next); setPage({ items: [...page.items, ...next.items], next: next.next }); }
    catch (e) { setError(errorKey(e)); } finally { setLoadingMore(false); }
  }
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <div className="trash" data-trash="" aria-busy={loading}>
    <p className="screen-hint">{t('trashHint')}</p>
    <div className="trash-layout"><section className="trash-content" aria-label={t('trashEntries')}>
    <label>{t('trashLibrary')}<select aria-label={t('trashLibrary')} disabled={busy || loading} value={library} onChange={event => setLibrary(event.target.value)}>
      <option value="">{t('trashAllLibraries')}</option>
      {library && !libraries.some(value => value.id === library) && <option value={library}>{t('trashSelectedLibrary')}</option>}
      {libraries.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
    </select></label>
    {error && loaded === requestKey && <div className="error" role="alert">
      <strong>{t('trashUnavailable')}</strong>
      <p>{error === 'generic' ? t('readUnavailableHint') : t(`errors.${error}`, { defaultValue: t('readUnavailableHint') })}</p>
      <button disabled={busy || loading} onClick={() => retry(value => value + 1)}>{t('retryEntries')}</button>
    </div>}
    {loading && <p role="status">{t('trashLoading')}</p>}
    {!loading && page?.items.length === 0 && <div className="empty" role="status">{t('emptyTrash')}</div>}
    <ul className="trash-list" aria-label={t('trash')}>
      {loaded === requestKey && page?.items.map(item => <li key={item.id} data-trash-id={item.id}>
        <h2>{item.title || t('untitled')}</h2>
        <p className="trash-origin">{item.library_name} · {item.collection_name}</p>
        <p className="trash-date">{t('trashDeletedAt')}: <time dateTime={item.deleted_at!}>{date(item.deleted_at!)}</time></p>
        {!item.restorable && <p>{t('trashParentDeleted')}</p>}
        <div className="actions">
          <button className="primary" disabled={disabled || !item.restorable} onClick={() => { setConfirm(null); restore(item); }}>{t('restore')}</button>
          <button className="danger" disabled={disabled} onClick={() => setConfirm(item)}>{t('purgeEntry')}</button>
        </div>
        {confirm?.id === item.id && <section role="region" aria-label={t('confirmPurgeEntry')} className="trash-confirm">
          <p>{t('purgeEntryHint', { title: item.title || t('untitled') })}</p>
          <button disabled={disabled} onClick={() => setConfirm(null)}>{t('cancel')}</button>
          <button className="danger" disabled={disabled} onClick={() => purge(item)}>{t('confirmPurgeEntry')}</button>
        </section>}
      </li>)}
    </ul>
    {loaded === requestKey && page?.next && <button disabled={disabled} onClick={() => { void more(); }}>{t('loadMore')}</button>}
    </section><fieldset className="trash-retention" disabled={disabled}><legend>{t('trashRetention')}</legend>
      <label><span className="visually-hidden">{t('trashRetention')}</span><select aria-label={t('trashRetention')} value={page === null ? 'unread' : days ?? 'forever'} onChange={event => setDays(event.target.value === 'forever' ? null : Number(event.target.value) as TrashRetention)}>
        {page === null && <option value="unread" disabled>{t('unreadSetting')}</option>}
        {retentionDays.map(value => <option key={value ?? 'forever'} value={value ?? 'forever'}>{value === null ? t('trashForever') : t('trashDays', { count: value })}</option>)}
      </select></label>
      <p>{t('trashRetentionHint')}</p>
      <button disabled={days === savedDays} onClick={() => { setConfirm(null); saveRetention(days); }}>{t('saveTrashRetention')}</button>
    </fieldset></div>
  </div>;
}
