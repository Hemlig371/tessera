import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, Entry, Field, Library, RecordData, UiDefinition } from '../core/model';
import type { Repository } from '../core/repository';
import { RecordForm } from './RecordForm';
import { ErrorMessage, errorKey } from './common';

export function InboxMoveForm({ api, entry, libraries, busy, cancel, save }: {
  api: Repository; entry: Entry; libraries: Library[]; busy: boolean;
  cancel: () => void; save: (collectionId: string, data: RecordData) => void;
}) {
  const { t } = useTranslation();
  const [libraryId, setLibraryId] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [context, setContext] = useState<{ collection: Collection; fields: Field[]; layout: UiDefinition; initial: RecordData; original: string; mapping_status: 'split' | 'fallback' | 'none' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (libraryId) api.listCollections(libraryId).then(rows => {
      if (active) setCollections(rows);
    }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, libraryId]);
  useEffect(() => {
    let active = true;
    const collection = collections.find(c => c.id === collectionId);
    if (collection) Promise.all([api.listFields(collectionId), api.getUiConfig(collectionId, 'form'), api.previewInboxMove(entry.id, collectionId, entry.hlc)])
      .then(([fields, layout, preview]) => {
        if (active) setContext({ collection, fields, layout, initial: preview.data, original: preview.original, mapping_status: preview.mapping_status });
      }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, collectionId, collections, entry]);
  return <>
    <p>{t('inboxMoveHint')}</p>
    <label>{t('targetLibrary')}
      <select value={libraryId} disabled={busy} onChange={e => {
        setLibraryId(e.target.value); setCollectionId(''); setCollections([]); setContext(null); setError(null);
      }}>
        <option value="">{t('chooseLibrary')}</option>
        {libraries.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
    <label>{t('targetCollection')}
      <select value={collectionId} disabled={busy || !libraryId} onChange={e => {
        setCollectionId(e.target.value); setContext(null); setError(null);
      }}>
        <option value="">{t('chooseCollection')}</option>
        {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    {error && <ErrorMessage code={error} />}
    {context && <>
      {context.mapping_status !== 'none' && <p role="status">{t(context.mapping_status === 'split' ? 'inboxMarkdownMapped' : 'inboxMappingFallback')}</p>}
      <details><summary>{t('inboxOriginal')}</summary><pre className="original-content">{context.original}</pre></details>
    </>}
    {context ? <RecordForm key={context.collection.id} api={api} collection={context.collection} creating={false}
      fields={context.fields} layout={context.layout} initialData={context.initial} busy={busy} cancel={cancel}
      save={data => save(context.collection.id, data)} />
      : <button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button>}
  </>;
}
