import { useTranslation } from 'react-i18next';
import type { Collection, Library } from '../core/model';

export function Catalog({ kind, items, layout = 'cards', busy, open, create }: {
  kind: 'libraries' | 'collections'; items: (Library | Collection)[]; layout?: 'list' | 'cards';
  busy: boolean; open: (id: string) => void; create: () => void;
}) {
  const { t } = useTranslation();
  return <section data-catalog={kind} aria-label={t(kind)}>
    {!items.length && <div className="empty"><span aria-hidden="true">▦</span><h2>{t(kind === 'libraries' ? 'emptyLibraries' : 'emptyCollections')}</h2>
      <p>{t(kind === 'libraries' ? 'emptyLibrariesHint' : 'emptyCollectionsHint')}</p></div>}
    <div className={`catalog catalog-${layout}`}>
      {items.map(item => {
        const appearance = JSON.parse(item.config) as { icon?: string; color?: string };
        return <button className="catalog-item" key={item.id} disabled={busy} aria-label={t(kind === 'libraries' ? 'openLibrary' : 'openCollection', { name: item.name })} onClick={() => open(item.id)}>
          <span className="catalog-icon" aria-hidden="true" style={{ color: appearance.color }}>{appearance.icon ?? '◇'}</span>
          <strong>{item.name}</strong><span aria-hidden="true">→</span>
        </button>;
      })}
    </div>
    <button className="primary catalog-create" disabled={busy} aria-label={t(kind === 'libraries' ? 'createLibrary' : 'createCollection')} onClick={create}>
      + {t(kind === 'libraries' ? 'newLibrary' : 'newCollection')}
    </button>
  </section>;
}
