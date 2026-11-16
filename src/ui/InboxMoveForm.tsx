import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, Entry, Field, Library, RecordData, UiDefinition } from '../core/model';
import type { Repository } from '../core/repository';
import { RecordForm } from './RecordForm';
import { errorKey } from './common';

export function InboxMoveForm({ api, entry, libraries, busy, cancel, save, registerFileClose }: {
  api: Repository; entry: Entry; libraries: Library[]; busy: boolean;
  registerFileClose?: (close: (() => Promise<void>) | null) => void;
  cancel: () => void; save: (collectionId: string, data: RecordData) => void;
}) {
  const { t } = useTranslation();
  const [libraryId, setLibraryId] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [context, setContext] = useState<{ collection: Collection; fields: Field[]; layout: UiDefinition; initial: RecordData; original: string; mapping_status: 'split' | 'fallback' | 'none' } | null>(null);
  const [error, setError] = useState<{ scope: 'collections' | 'preview'; code: string } | null>(null);
  const [libraryAttempt, retryLibrary] = useState(0), [previewAttempt, retryPreview] = useState(0);
  const [loadedLibrary, setLoadedLibrary] = useState<string | null>(null);
  const libraryKey = JSON.stringify([libraryId, libraryAttempt]);
  const loadingCollections = !!libraryId && loadedLibrary !== libraryKey;
  const loadingPreview = !!collectionId && !context && !error;
  useEffect(() => {
    let active = true;
    if (libraryId) api.listCollections(libraryId).then(rows => {
      if (active) { setCollections(rows); setLoadedLibrary(libraryKey); }
    }).catch(e => { if (active) { setError({ scope: 'collections', code: errorKey(e) }); setLoadedLibrary(libraryKey); } });
    return () => { active = false; };
  }, [api, libraryId, libraryKey]);
  useEffect(() => {
    let active = true;
    const collection = collections.find(c => c.id === collectionId);
    if (collection) Promise.all([api.listFields(collectionId), api.getUiConfig(collectionId, 'form'), api.previewInboxMove(entry.id, collectionId, entry.hlc)])
      .then(([fields, layout, preview]) => {
        if (active) setContext({ collection, fields, layout, initial: preview.data, original: preview.original, mapping_status: preview.mapping_status });
      }).catch(e => { if (active) setError({ scope: 'preview', code: errorKey(e) }); });
    return () => { active = false; };
  }, [api, collectionId, collections, entry, previewAttempt]);
  return <div className="inbox-move">
    <p className="screen-hint">{t('inboxMoveHint')}</p>
    <div className="inbox-move-targets" aria-busy={loadingCollections || loadingPreview}>
    <label>{t('targetLibrary')}
      <select value={libraryId} disabled={busy} onChange={e => {
        if (e.target.value === libraryId) return;
        setLibraryId(e.target.value); setCollectionId(''); setCollections([]); setContext(null); setError(null);
      }}>
        <option value="">{t('chooseLibrary')}</option>
        {libraries.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
    <label>{t('targetCollection')}
      <select value={collectionId} disabled={busy || !libraryId || loadingCollections || !collections.length || error?.scope === 'collections'} onChange={e => {
        if (e.target.value === collectionId) return;
        setCollectionId(e.target.value); setContext(null); setError(null);
      }}>
        <option value="">{t('chooseCollection')}</option>
        {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    </div>
    {loadingCollections && <p role="status">{t('loadingCollections')}</p>}
    {loadingPreview && <p role="status">{t('loadingMovePreview')}</p>}
    {libraryId && !loadingCollections && !error && !collections.length && <p className="screen-hint" role="status">{t('noMoveTargets')}</p>}
    {error && <div className="error" role="alert"><strong>{t('moveTargetUnavailable')}</strong>
      <p>{error.code === 'generic' ? t('readUnavailableHint') : t(`errors.${error.code}`, { defaultValue: t('readUnavailableHint') })}</p>
      <button disabled={busy} onClick={() => {
        if (error.scope === 'collections') { setCollections([]); retryLibrary(value => value + 1); }
        else retryPreview(value => value + 1);
        setError(null);
      }}>{t('retryEntries')}</button>
    </div>}
    {context && <>
      {context.mapping_status !== 'none' && <p className="screen-hint" role="status">{t(context.mapping_status === 'split' ? 'inboxMarkdownMapped' : 'inboxMappingFallback')}</p>}
      <details className="move-original"><summary>{t('inboxOriginal')}</summary><pre className="original-content">{context.original}</pre></details>
    </>}
    {context ? <RecordForm key={context.collection.id} api={api} collection={context.collection} creating={false} attachmentOwnerId={entry.id} registerFileClose={registerFileClose}
      fields={context.fields} layout={context.layout} initialData={context.initial} busy={busy} cancel={cancel}
      save={data => save(context.collection.id, data)} />
      : <button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button>}
  </div>;
}
