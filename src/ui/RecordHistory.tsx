import { AttachmentList } from './AttachmentList';
import { fileIds, isFile } from '../core/attachments';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry, Field, JsonValue } from '../core/model';
import type { HistoryState } from '../core/history';
import type { Repository } from '../core/repository';
import { errorKey, useFormatValue } from './common';

export function RecordHistory({ api, entry, busy, restore, clear, refresh }: {
  api: Repository; entry: Entry; busy: boolean; restore: (versionId: string) => void;
  clear: () => void; refresh: () => void;
}) {
  const { t, i18n } = useTranslation(), format = useFormatValue();
  const [history, setHistory] = useState<HistoryState | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<Field[]>([]), [collectionName, setCollectionName] = useState<string | null>(null);
  const [unmappedFiles, setUnmappedFiles] = useState<{ version: string; ids: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null), [confirmClear, setConfirmClear] = useState(false);
  const version = history?.versions.find(value => value.id === selected);
  useEffect(() => {
    let active = true;
    void api.getHistory(entry.id).then(value => {
      if (active) { setHistory(value); setSelected(value.versions[0]?.id ?? null); }
    }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, entry.id]);
  useEffect(() => {
    if (!version) return;
    let active = true;
    void Promise.all([api.getCollection(version.snapshot.collection_id), api.listFields(version.snapshot.collection_id), api.unmappedAttachments(version.snapshot)])
      .then(([collection, rows, files]) => { if (active) { setFields(rows); setCollectionName(collection.name); setUnmappedFiles({ version: version.id, ids: files }); } })
      .catch(() => { if (active) { setFields([]); setCollectionName(null); setUnmappedFiles(null); } });
    return () => { active = false; };
  }, [api, version]);
  const savedAt = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
  const rawValue = (value: JsonValue) => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return <div className="record-history" aria-busy={!history && !error}>
    <div className="history-toolbar"><p className="screen-hint">{t('historyHint')}</p>
    <button disabled={busy || (!history && !error)} onClick={refresh}>{t('refreshHistory')}</button></div>
    {error && <div className="error" role="alert"><strong>{t('historyUnavailable')}</strong>
      <p>{error === 'generic' ? t('readUnavailableHint') : t(`errors.${error}`, { defaultValue: t('readUnavailableHint') })}</p></div>}
    {!history && !error && <p role="status">{t('loadingHistory')}</p>}
    {history && !history.versions.length && <div className="empty" role="status">{t('emptyHistory')}</div>}
    {history && history.versions.length > 0 && <><div className="history-layout">
      <ol className="history-versions" aria-label={t('recordVersions')}>
        {history.versions.map((value, index) => <li key={value.id}>
          <button data-version-id={value.id} disabled={busy} aria-pressed={value.id === selected}
            onClick={() => { if (selected !== value.id) { setFields([]); setCollectionName(null); setSelected(value.id); } setConfirmClear(false); }}>
            <strong>{t('versionNumber', { number: history.versions.length - index })}</strong>
            <time dateTime={value.saved_at}>{savedAt(value.saved_at)}</time>
          </button>
        </li>)}
      </ol>
      {version && <section key={version.id} aria-label={t('versionSnapshot')} className="history-snapshot">
        <div className="history-snapshot-heading"><h2>{t('versionSnapshot')}</h2>
        <p>{t('historyCollection')}: {collectionName ?? version.snapshot.collection_id}</p>
        <small>{t('versionSavedAt')}: <time dateTime={version.saved_at}>{savedAt(version.saved_at)}</time></small></div>
        <dl>{Object.entries(version.snapshot.data).map(([id, value]) => {
          const field = fields.find(value => value.id === id);
          return <div key={id}><dt>{field?.name ?? id}</dt><dd>
            {field && isFile(field.type) ? <AttachmentList api={api} ownerId={entry.id} ids={fileIds(value)} busy={busy} /> : !field || field.type === 'secret' ? <details><summary>{t('showHistoricalValue')}</summary><pre>{rawValue(value)}</pre></details>
              : <pre>{typeof value === 'object' || field.type === 'markdown' ? rawValue(value) : format(field, value)}</pre>}
          </dd></div>;
        })}</dl>
        {unmappedFiles?.version === version.id && !!unmappedFiles.ids.length && <section aria-label={t('retainedAttachments')}><h3>{t('retainedAttachments')}</h3><AttachmentList api={api} ownerId={entry.id} ids={unmappedFiles.ids} busy={busy} /></section>}
        <button className="primary" disabled={busy} onClick={() => restore(version.id)}>{t('restoreVersion')}</button>
        <p>{t('restoreVersionHint')}</p>
      </section>}</div>
      <div className="form-actions">
        {!confirmClear ? <button className="danger" disabled={busy} onClick={() => setConfirmClear(true)}>{t('clearRecordHistory')}</button> : <>
          <p>{t('clearHistoryHint')}</p>
          <button disabled={busy} onClick={() => setConfirmClear(false)}>{t('cancel')}</button>
          <button className="danger" disabled={busy} onClick={clear}>{t('confirmClearHistory')}</button>
        </>}
      </div>
    </>}
  </div>;
}
