import { useTranslation } from 'react-i18next';
import type { Collection, EntryListItem, Field, Library } from '../core/model';
import { Catalog } from './Catalog';
import { Icon } from './Icon';

/** Builder landing: real navigation and a read-only preview; changes to layouts
 * are handled by existing editors, never by a second schema or record store. */
export function ConstructorOverview({ library, collection, libraries, collections, fields, entries, busy, openLibrary, openCollection }: {
  library?: Library;
  collection?: Collection;
  libraries: Library[];
  collections: Collection[];
  fields: Field[];
  entries: EntryListItem[];
  busy: boolean;
  openLibrary: (id: string) => void;
  openCollection: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (!library) return <section className="tessera-constructor-overview" aria-label={t('libraries')}>
    <div className="tessera-constructor-overview-heading">
      <Icon name="libraries" />
      <div><h2>{t('libraries')}</h2><p>{t('constructorChooseHint')}</p></div>
    </div>
    <Catalog kind="libraries" layout="list" items={libraries} busy={busy} open={openLibrary} />
  </section>;
  if (!collection || collection.system_kind) return <section className="tessera-constructor-overview" aria-label={t('collections')}>
    <div className="tessera-constructor-overview-heading">
      <Icon name="collection" />
      <div><h2>{t('collections')}</h2><p>{library.name}</p></div>
    </div>
    <Catalog kind="collections" layout="list" items={collections.filter(item => item.library_id === library.id && !item.system_kind)} busy={busy} open={openCollection} />
  </section>;
  return <section className="tessera-constructor-overview" aria-label={t('constructorPreview')}>
    <div className="tessera-constructor-overview-heading">
      <Icon name="collection" />
      <div><h2>{t('constructorPreview')}</h2><p>{collection.name}</p></div>
    </div>
    <div className="tessera-constructor-preview">
      <div className="tessera-constructor-preview-fields">
        <h3>{t('fields')}</h3>
        <div className="tessera-constructor-field-pills">
          {fields.map(field => <span key={field.id}>{field.name}</span>)}
        </div>
      </div>
      <div className="tessera-constructor-preview-rows">
        <h3>{t('layouts.list')}</h3>
        {entries.slice(0, 3).map(row => <div className="tessera-constructor-preview-record" key={row.id}>
          <span className="tessera-constructor-preview-dot" aria-hidden="true" />
          <span>{row.title || t('unset')}</span>
        </div>)}
        {!entries.length && <p>{t('emptyCollection')}</p>}
      </div>
    </div>
  </section>;
}
