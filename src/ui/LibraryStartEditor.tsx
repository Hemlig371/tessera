import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, DisplayProfile } from '../core/model';
import type { LibraryNavigation } from '../core/library-navigation';
import type { Repository } from '../core/repository';
import { ErrorMessage, errorKey } from './common';

export function LibraryStartEditor({ api, libraryId, busy, save, cancel }: {
  api: Repository; libraryId: string; busy: boolean; save: (value: LibraryNavigation) => void; cancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<LibraryNavigation | null>(null), [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState(''), [profileId, setProfileId] = useState(''), [profiles, setProfiles] = useState<DisplayProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([api.getLibraryNavigation(libraryId), api.listCollections(libraryId)]).then(([navigation, rows]) => {
      if (!active) return;
      setValue(navigation); setCollections(rows);
      setCollectionId(navigation.start.kind === 'collection' ? navigation.start.collection_id : rows[0]?.id ?? '');
      setProfileId(navigation.start.kind === 'collection' ? navigation.start.profile_id ?? '' : '');
    }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, libraryId]);
  useEffect(() => {
    let active = true;
    if (collectionId && collections.some(row => row.id === collectionId)) void api.listDisplayProfiles(collectionId)
      .then(rows => { if (active) setProfiles(rows); }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, collectionId, collections]);
  if (!value) return error ? <ErrorMessage code={error} /> : <p role="status">{t('loading')}</p>;
  return <form onSubmit={event => {
    event.preventDefault();
    save({ ...value, start: value.start.kind === 'collection' ? { kind: 'collection', collection_id: collectionId, ...(profileId ? { profile_id: profileId } : {}) } : value.start });
  }}>
    {error && <ErrorMessage code={error} />}
    <label>{t('libraryStart')}<select disabled={busy} value={value.start.kind} onChange={event => {
      const kind = event.target.value as LibraryNavigation['start']['kind'];
      setValue({ ...value, start: kind === 'collection' ? { kind, collection_id: collectionId } : { kind } });
    }}><option value="collections">{t('collections')}</option><option value="collection" disabled={!collections.length}>{t('startCollection')}</option><option value="last">{t('startLast')}</option></select></label>
    {value.start.kind === 'collection' && <>
      <label>{t('startCollection')}<select required disabled={busy} value={collectionId} onChange={event => {
        if (event.target.value !== collectionId) { setCollectionId(event.target.value); setProfileId(''); setProfiles([]); }
      }}>
        {!collections.some(row => row.id === collectionId) && <option value={collectionId}>{t('missingStartTarget')}</option>}
        {collections.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <label>{t('displayProfile')}<select disabled={busy} value={profileId} onChange={event => setProfileId(event.target.value)}>
        <option value="">{t('startDefaultProfile')}</option>
        {profileId && !profiles.some(row => row.id === profileId) && <option value={profileId}>{t('missingStartTarget')}</option>}
        {profiles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
    </>}
    <label>{t('collectionsLayout')}<select disabled={busy} value={value.collections_layout} onChange={event => setValue({ ...value, collections_layout: event.target.value as LibraryNavigation['collections_layout'] })}>
      <option value="cards">{t('catalogCards')}</option><option value="list">{t('catalogList')}</option>
    </select></label>
    <p>{t('libraryStartHint')}</p>
    <div className="actions"><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button className="primary" disabled={busy || (value.start.kind === 'collection' && !collectionId)}>{t('save')}</button></div>
  </form>;
}
