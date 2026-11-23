import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayProfile } from '../core/model';
import { ConstructorOverview } from './ConstructorOverview';
import type { useUi } from './store';

type Props = ComponentProps<typeof ConstructorOverview> & {
  edit: (target: NonNullable<ReturnType<typeof useUi.getState>['editor']>, id?: string) => void;
  finish: () => void;
  ready: boolean;
  pin?: () => void;
  profiles: DisplayProfile[];
  profileId?: string;
  chooseProfile: (id: string) => void;
};

export function StructureWorkspace({edit, finish, ready, pin, profiles, profileId, chooseProfile, ...preview}: Props) {
  const {t} = useTranslation();
  const {library, collection, busy} = preview;
  const configurable = collection && !collection.system_kind;
  return <section className="structure-workspace">
    <header className="constructor-banner">
      <div><h1>{t('constructor')}</h1><p>{collection?.name ?? library?.name ?? t('constructorChooseHint')}</p></div>
      <button disabled={busy} onClick={finish}>{t('finishConstructor')}</button>
    </header>
    <div className="structure-columns"><div className="structure-tools">
      {!library && <button className="primary catalog-create" disabled={busy} aria-label={t('createLibrary')} onClick={() => edit('library')}>+ {t('newLibrary')}</button>}
      {library && !library.system_kind && <section>
        <h2>{t('libraries')}</h2>
        <button disabled={busy} onClick={() => edit('library',library.id)}>{t('editLibrary')}</button>
        <button disabled={busy} onClick={() => edit('library-start')}>{t('libraryStart')}</button>
        <button disabled={busy} onClick={() => edit('library-summary')}>{t('librarySummary')}</button>
        {pin && <button disabled={busy} onClick={pin}>{t('pinLibraryShortcut')}</button>}
        <button disabled={busy} aria-label={t('createCollection')} onClick={() => edit('collection')}>+ {t('newCollection')}</button>
      </section>}
      {configurable && <>
        <section><h2>{collection.name}</h2>
          <button disabled={busy || !ready} onClick={() => edit('collection',collection.id)}>{t('editCollection')}</button>
          <button disabled={busy || !ready} onClick={() => edit('fields')}>{t('fields')}</button>
          <button disabled={busy || !ready} onClick={() => edit('csv')}>{t('csv')}</button>
        </section>
        <section><h2>{t('displayProfiles')}</h2>
          {profiles.length > 0 && <label>{t('displayProfile')}<select value={profileId ?? ''} disabled={busy} onChange={e => chooseProfile(e.target.value)}>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>}
          <button disabled={busy || !ready} onClick={() => edit('profiles')}>{t('displayProfiles')}</button>
          {(['list','card','form'] as const).map(kind => <button key={kind} disabled={busy || !ready} onClick={() => edit(kind)}>{t('layouts.'+kind)}</button>)}
          <button disabled={busy || !ready} onClick={() => edit('named-cards')}>{t('namedCards')}</button>
        </section>
        <section><h2>{t('newEntry')}</h2>
          <button disabled={busy || !ready} onClick={() => edit('quick')}>{t('layouts.quick')}</button>
          <button disabled={busy || !ready} onClick={() => edit('presets')}>{t('creationPresets')}</button>
          <button disabled={busy || !ready} onClick={() => edit('quick-entry')}>+ {t('quickEntry')}</button>
        </section>
      </>}
    </div><ConstructorOverview {...preview} /></div>
  </section>;
}
