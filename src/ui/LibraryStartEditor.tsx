import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, DisplayProfile } from '../core/model';
import type { LibraryNavigation } from '../core/library-navigation';
import type { Repository } from '../core/repository';
import { errorKey } from './common';

export function LibraryStartEditor({ api, libraryId, busy, save, cancel }: {
  api: Repository; libraryId: string; busy: boolean; save: (value: LibraryNavigation) => void; cancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<LibraryNavigation | null>(null), [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState(''), [profileId, setProfileId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, retry] = useState(0), [profileAttempt, retryProfiles] = useState(0);
  const [profileResult, setProfileResult] = useState<{ key: string; items: DisplayProfile[]; error?: string } | null>(null);
  const profileKey = JSON.stringify([collectionId, profileAttempt]);
  const collectionAvailable = collections.some(row => row.id === collectionId);
  const profilesLoading = collectionAvailable && profileResult?.key !== profileKey;
  const profileError = profileResult?.key === profileKey ? profileResult.error : null;
  const profiles = profileResult?.key === profileKey ? profileResult.items : [];
  useEffect(() => {
    let active = true;
    void Promise.all([api.getLibraryNavigation(libraryId), api.listCollections(libraryId)]).then(([navigation, rows]) => {
      if (!active) return;
      setValue(navigation); setCollections(rows);
      setCollectionId(navigation.start.kind === 'collection' ? navigation.start.collection_id : rows[0]?.id ?? '');
      setProfileId(navigation.start.kind === 'collection' ? navigation.start.profile_id ?? '' : '');
    }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, libraryId, attempt]);
  useEffect(() => {
    let active = true;
    if (collectionAvailable) void api.listDisplayProfiles(collectionId)
      .then(items => { if (active) setProfileResult({ key: profileKey, items }); })
      .catch(e => { if (active) setProfileResult({ key: profileKey, items: [], error: errorKey(e) }); });
    return () => { active = false; };
  }, [api, collectionId, collectionAvailable, profileKey]);
  const failure = (code: string, repeat: () => void) => <div className="error" role="alert"><strong>{t('libraryStartUnavailable')}</strong>
    <p>{code === 'generic' ? t('readUnavailableHint') : t(`errors.${code}`, { defaultValue: t('readUnavailableHint') })}</p>
    <button type="button" disabled={busy} onClick={repeat}>{t('retryEntries')}</button></div>;
  if (!value) return <div className="settings-form">
    {error ? failure(error, () => { setError(null); retry(value => value + 1); }) : <p role="status">{t('loadingSettings')}</p>}
    <button disabled={busy} onClick={cancel}>{t('cancel')}</button>
  </div>;
  const invalidTarget = !collectionAvailable || profilesLoading || !!profileError || (!!profileId && !profiles.some(row => row.id === profileId));
  return <form className="settings-form" onSubmit={event => {
    event.preventDefault();
    if (value.start.kind === 'collection' && invalidTarget) return;
    save({ ...value, start: value.start.kind === 'collection' ? { kind: 'collection', collection_id: collectionId, ...(profileId ? { profile_id: profileId } : {}) } : value.start });
  }}>
    <label>{t('libraryStart')}<select disabled={busy} value={value.start.kind} onChange={event => {
      const kind = event.target.value as LibraryNavigation['start']['kind'];
      setValue({ ...value, start: kind === 'collection' ? { kind, collection_id: collectionId } : { kind } });
    }}><option value="collections">{t('collections')}</option><option value="collection" disabled={!collections.length}>{t('startCollection')}</option><option value="last">{t('startLast')}</option></select></label>
    {value.start.kind === 'collection' && <>
      <label>{t('startCollection')}<select required disabled={busy} value={collectionId} onChange={event => {
        if (event.target.value !== collectionId) { setCollectionId(event.target.value); setProfileId(''); }
      }}>
        {!collections.some(row => row.id === collectionId) && <option value={collectionId}>{t('missingStartTarget')}</option>}
        {collections.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <label>{t('displayProfile')}<select disabled={busy || profilesLoading || !!profileError || !collectionAvailable} value={profileId} onChange={event => setProfileId(event.target.value)}>
        <option value="">{t('startDefaultProfile')}</option>
        {profileId && !profiles.some(row => row.id === profileId) && <option value={profileId}>{t(profilesLoading ? 'loadingProfiles' : profileError ? 'profilesUnavailable' : 'missingStartTarget')}</option>}
        {profiles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {profilesLoading && <p className="visually-hidden" role="status">{t('loadingProfiles')}</p>}
      {profileError && failure(profileError, () => retryProfiles(value => value + 1))}
    </>}
    <label>{t('collectionsLayout')}<select disabled={busy} value={value.collections_layout} onChange={event => setValue({ ...value, collections_layout: event.target.value as LibraryNavigation['collections_layout'] })}>
      <option value="cards">{t('catalogCards')}</option><option value="list">{t('catalogList')}</option>
    </select></label>
    <p className="screen-hint">{t('libraryStartHint')}</p>
    <div className="form-actions"><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button className="primary" disabled={busy || (value.start.kind === 'collection' && invalidTarget)}>{t('save')}</button></div>
  </form>;
}
