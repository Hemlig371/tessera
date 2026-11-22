import { useTranslation } from 'react-i18next';
import type { Collection, Library } from '../core/model';
import { Icon } from './Icon';

export function Catalog({ kind, items, layout = 'cards', busy, open, metadata = {} }: {
  kind: 'libraries' | 'collections'; items: (Library | Collection)[]; layout?: 'list' | 'cards';
  busy: boolean; open: (id: string) => void; metadata?: Record<string, string>;
}) {
  const { t } = useTranslation();
  return <section data-catalog={kind} aria-label={t(kind)}>
    {!items.length && <div className="empty"><span aria-hidden="true">▦</span><h2>{t(kind === 'libraries' ? 'emptyLibraries' : 'emptyCollections')}</h2>
      <p>{t(kind === 'libraries' ? 'emptyLibrariesHint' : 'emptyCollectionsHint')}</p></div>}
    <div className={`catalog catalog-${layout}`}>
      {items.map(item => {
        const appearance = JSON.parse(item.config) as { icon?: string; color?: string };
        return <button className="catalog-item" key={item.id} disabled={busy} aria-label={t(kind === 'libraries' ? 'openLibrary' : 'openCollection', { name: item.name })} onClick={() => open(item.id)}>
          <span className="catalog-icon" aria-hidden="true" style={{ backgroundColor: appearance.color ? `color-mix(in srgb, ${appearance.color} 20%, var(--surface))` : undefined }}>{appearance.icon && appearance.icon !== '◇' ? appearance.icon : <Icon name={kind === 'libraries' ? 'collection' : 'libraries'} />}</span>
          <span className="tessera-catalog-copy"><strong>{item.name}</strong>{(metadata[item.id] || kind === 'libraries') && <small>{metadata[item.id] ?? t('collections')}</small>}</span><Icon name="chevron" />
        </button>;
      })}
    </div>
  </section>;
}
