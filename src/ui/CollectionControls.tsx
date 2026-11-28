import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, DisplayProfile, Field, Library } from '../core/model';
import { Icon } from './Icon';

export function CollectionControls({ collection, library, fields, filter, onFilter, search, onSearch, scope, onScope, profiles, profileId, onProfile, busy }: {
  collection: Collection; library?: Library;
  fields: Field[]; filter: string; onFilter: (field: string) => void; search: string; onSearch: (value: string) => void;
  scope: 'collection' | 'library' | 'all'; onScope: (scope: 'collection' | 'library' | 'all') => void;
  profiles: DisplayProfile[]; profileId?: string | null; onProfile: (value: string | null) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = useState(false);
  return <section className="collection-controls" aria-label={collection.name}>
    <div className="reference-collection-search">
      <Icon name="search" />
      <label>
        <span className="visually-hidden">{t('search')}</span>
        <input type="search" placeholder={t('searchPlaceholder')} value={search} onChange={event => onSearch(event.target.value)} disabled={busy} />
      </label>
      <button type="button" className="reference-filter-button" aria-label={t('viewFilters')} aria-expanded={filterOpen}
        title={t('viewFilters')} data-active={!!filter} disabled={busy} onClick={() => setFilterOpen(value => !value)}><Icon name="filter" /></button>
    </div>
    {filterOpen && <div className="filter-panel"><label>{t('fieldHasValue')}
      <select value={filter} disabled={busy} onChange={event => onFilter(event.target.value)}>
        <option value="">{t('anyField')}</option>
        {fields.filter(field => field.type !== 'secret').map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
      </select></label><label className="reference-scope-chooser">{t('searchScope')}
      <select value={scope} disabled={busy} onChange={event => onScope(event.target.value as 'collection' | 'library' | 'all')}>
        <option value="collection">{t('scopeCollection')}</option>
        <option value="library" disabled={!library}>{t('scopeLibrary')}</option>
        <option value="all">{t('scopeAll')}</option>
      </select>
    </label></div>}
    {profiles.length > 0 && <div className="reference-view-chips" role="group" aria-label={t('displayProfile')}>
      {profiles.map(profile => <button key={profile.id} value={profile.id} type="button" disabled={busy}
        className={!profileId ? profile.id === collection.default_profile_id ? 'active' : '' : profile.id === profileId ? 'active' : ''}
        aria-pressed={(!profileId && profile.id === collection.default_profile_id) || profile.id === profileId}
        onClick={() => onProfile(profile.id)}>
        {profile.name}
      </button>)}
    </div>}
    {fields.length === 0 && <span className="visually-hidden">{t('emptyCollection')}</span>}
  </section>;
}
