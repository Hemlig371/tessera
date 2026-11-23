import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, DisplayProfile, Field, Library } from '../core/model';
import { Icon } from './Icon';

export function CollectionControls({ collection, library, fields, count, search, onSearch, scope, onScope, profiles, profileId, onProfile, busy }: {
  collection: Collection; library?: Library;
  fields: Field[]; count: number; search: string; onSearch: (value: string) => void;
  scope: 'collection' | 'library' | 'all'; onScope: (scope: 'collection' | 'library' | 'all') => void;
  profiles: DisplayProfile[]; profileId?: string | null; onProfile: (value: string | null) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = useState(false);
  const appearance = JSON.parse(collection.config) as { icon?: string; color?: string };
  const title = collection.system_kind === 'inbox' ? t('inbox') : collection.name;
  return <section className="reference-collection-controls" aria-label={title}>
    <div className="reference-collection-identity">
      <span className="reference-collection-icon" aria-hidden="true" style={appearance.color ? { color: appearance.color } : undefined}>
        {appearance.icon && appearance.icon !== '◇' ? appearance.icon : <Icon name="collection" />}
      </span>
      <div className="reference-collection-names">
        <h1>{title}</h1>
        <p>{library?.name ? library.name + ' · ' : ''}{t('entryCount', { count })}</p>
      </div>
    </div>
    <div className="reference-collection-search">
      <Icon name="search" />
      <label>
        <span className="visually-hidden">{t('search')}</span>
        <input type="search" placeholder={t('searchPlaceholder')} value={search} onChange={event => onSearch(event.target.value)} disabled={busy} />
      </label>
      <button type="button" className="reference-filter-button" aria-label={t('searchScope')} aria-expanded={filterOpen}
        title={t('searchScope')} disabled={busy} onClick={() => setFilterOpen(value => !value)}><Icon name="filter" /></button>
    </div>
    {filterOpen && <label className="reference-scope-chooser">{t('searchScope')}
      <select value={scope} disabled={busy} onChange={event => onScope(event.target.value as 'collection' | 'library' | 'all')}>
        <option value="collection">{t('scopeCollection')}</option>
        <option value="library" disabled={!library}>{t('scopeLibrary')}</option>
        <option value="all">{t('scopeAll')}</option>
      </select>
    </label>}
    {profiles.length > 0 && <div className="reference-view-chips" role="group" aria-label={t('displayProfile')}>
      {profiles.map(profile => <button key={profile.id} type="button" disabled={busy}
        className={!profileId ? profile.id === collection.default_profile_id ? 'active' : '' : profile.id === profileId ? 'active' : ''}
        aria-pressed={(!profileId && profile.id === collection.default_profile_id) || profile.id === profileId}
        onClick={() => onProfile(profile.id)}>
        {profile.name}
      </button>)}
    </div>}
    {fields.length === 0 && <span className="visually-hidden">{t('emptyCollection')}</span>}
  </section>;
}
