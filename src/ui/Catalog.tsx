import { useTranslation } from 'react-i18next';
import type { Collection, Library } from '../core/model';
import { Icon, LibraryGlyph } from './Icon';

export function Catalog({kind, items, layout = 'list', busy, open, metadata = {}}: {
  kind: 'libraries' | 'collections'; items: (Library | Collection)[]; layout?: 'list' | 'cards';
  busy: boolean; open: (id: string) => void; metadata?: Record<string, string>;
}) {
  const {t} = useTranslation();
  return <section data-catalog={kind} aria-label={t(kind)}>
    {items.length === 0 && <div className="empty"><h2>{t(kind === 'libraries' ? 'emptyLibraries' : 'emptyCollections')}</h2>
      <p>{t(kind === 'libraries' ? 'emptyLibrariesHint' : 'emptyCollectionsHint')}</p></div>}
    <ul className={'catalog catalog-' + layout} data-layout={layout}>{items.map(item => {
      const {icon, color} = JSON.parse(item.config) as {icon?: string; color?: string};
      return <li key={item.id}><button className="catalog-item" disabled={busy} onClick={() => open(item.id)}
        aria-label={t(kind === 'libraries' ? 'openLibrary' : 'openCollection', {name:item.name})}>
        <span className="library-glyph" style={{color}}><LibraryGlyph symbol={icon}/></span>
        <span className="catalog-copy"><strong>{item.name}</strong>{metadata[item.id] && <small><Icon name="document"/>{metadata[item.id]}</small>}</span>
        <Icon name="chevron"/>
      </button></li>;
    })}</ul>
  </section>;
}
