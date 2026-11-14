import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Collection, Entry, Library, Page } from '../core/model';
import type { Repository } from '../core/repository';
import { useUi } from './store';

function errorKey(error: unknown): string {
  return error instanceof Error && /^[a-zA-Z]+$/.test(error.message) ? error.message : 'generic';
}
export function ErrorMessage({ code }: { code: string }) {
  const { t } = useTranslation();
  return <div role="alert" className="error"><strong>{t('errorTitle')}</strong><p>{t(`errors.${code}`, { defaultValue: t('errors.generic') })}</p></div>;
}
export function App({ api }: { api: Repository }) {
  const { t, i18n } = useTranslation();
  const ui = useUi();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [page, setPage] = useState<Page<Entry>>({ items: [], next: null });
  const [selected, setSelected] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const [saved, setSaved] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const collection = collections.find(c => c.id === ui.collectionId);
  const library = libraries.find(l => l.id === ui.libraryId);
  // React Compiler is not enabled; Virtual's imperative measurement API is intentional.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({ count: page.items.length, getScrollElement: () => scroll.current, estimateSize: () => 72, overscan: 6, getItemKey: index => page.items[index]!.id });
  useEffect(() => {
    let active = true;
    api.listLibraries().then(rows => { if (active) setLibraries(rows); }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, revision]);
  useEffect(() => {
    let active = true;
    setCollections([]);
    if (ui.libraryId) api.listCollections(ui.libraryId).then(rows => { if (active) setCollections(rows); }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, ui.libraryId, revision]);
  useEffect(() => {
    let active = true;
    setPage({ items: [], next: null }); setSelected(null);
    if (ui.collectionId) api.listEntries(ui.collectionId).then(rows => { if (active) setPage(rows); }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, ui.collectionId, revision]);

  async function save() {
    if (busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      if (ui.editor === 'library') {
        const row = await api.createLibrary(ui.text); ui.select(row.id);
      } else if (ui.editor === 'collection' && ui.libraryId) {
        const row = await api.createCollection(ui.libraryId, ui.text, t('entryTitle')); ui.select(ui.libraryId, row.id);
      } else if (ui.editor === 'entry' && collection) {
        const row = await api.saveEntry(collection.id, { [collection.primary_field_id]: ui.text }, ui.editingId ?? undefined);
        // Explicit read back through the common API, never a synthetic UI-only row.
        const persisted = await api.getEntry(row.id);
        if (!persisted) throw new Error('notFound');
        setSaved(true);
      }
      ui.openEditor(null); refresh(n => n + 1);
    } catch (e) { setError(errorKey(e)); }
    finally { setBusy(false); }
  }
  async function more() {
    if (!collection || !page.next || busy) return;
    setBusy(true);
    try {
      const next = await api.listEntries(collection.id, page.next);
      setPage(previous => ({ items: [...previous.items, ...next.items], next: next.next }));
    } catch (e) { setError(errorKey(e)); }
    finally { setBusy(false); }
  }
  async function selectEntry(id: string) {
    try { setSelected(await api.getEntry(id)); setSaved(false); }
    catch (e) { setError(errorKey(e)); }
  }
  const editorTitle = ui.editor === 'library' ? t('newLibrary') : ui.editor === 'collection' ? t('newCollection') : t('newEntry');
  const fieldLabel = ui.editor === 'library' ? t('libraryName') : ui.editor === 'collection' ? t('collectionName') : t('entryTitle');
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">▦</span><div><b>{t('brand')}</b><small>{t('tagline')}</small></div></div>
      <div className="nav-heading">{t('libraries')}</div>
      <nav aria-label={t('libraries')}>
        {libraries.map(l => <div className="library" key={l.id}>
          <button className={l.id === ui.libraryId ? 'active library-button' : 'library-button'} disabled={!!ui.editor || busy} onClick={() => ui.select(l.id)}><span aria-hidden="true">◇</span>{l.name}</button>
          {l.id === ui.libraryId && <div className="collections">{collections.map(c => <button key={c.id} disabled={!!ui.editor || busy} className={c.id === ui.collectionId ? 'active' : ''} onClick={() => { ui.select(l.id, c.id); setSaved(false); }}>{c.name}</button>)}
            <button className="quiet" disabled={!!ui.editor || busy} onClick={() => ui.openEditor('collection')}>+ {t('newCollection')}</button></div>}
        </div>)}
      </nav>
      <button className="quiet" disabled={!!ui.editor || busy} onClick={() => ui.openEditor('library')}>+ {t('newLibrary')}</button>
      <footer><span className="local-dot" aria-hidden="true"/>{t('local')}<small>{t('offline')}</small>
        <label className="language">{t('language')}<select value={i18n.language} onChange={e => { void i18n.changeLanguage(e.target.value); }}><option value="ru">Русский</option><option value="en">English</option></select></label>
      </footer>
    </aside>
    <main>
      <header><div><small>{library?.name ?? t('libraries')}</small><h1>{collection?.name ?? t('brand')}</h1></div>
        {collection && <button className="primary" disabled={!!ui.editor || busy} onClick={() => { ui.openEditor('entry'); setError(null); setSaved(false); }}>+ {t('newEntry')}</button>}
      </header>
      {error && <ErrorMessage code={error}/>}
      {saved && <div role="status" className="saved">{t('saved')}</div>}
      {!libraries.length ? <div className="empty"><span aria-hidden="true">▦</span><h2>{t('emptyLibraries')}</h2><p>{t('emptyLibrariesHint')}</p><button className="primary" disabled={!!ui.editor || busy} onClick={() => ui.openEditor('library')}>{t('newLibrary')}</button></div>
        : !collection ? <div className="empty"><h2>{t('chooseCollection')}</h2><p>{t('chooseCollectionHint')}</p></div>
        : <><div className="list-meta">{t('entryCount', { count: page.items.length })}</div>
          {!page.items.length ? <div className="empty"><h2>{t('emptyCollection')}</h2><p>{t('emptyCollectionHint')}</p></div> :
          <div className="entry-scroll" ref={scroll}>
            <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
              {virtual.getVirtualItems().map(v => { const row = page.items[v.index]!; return <button key={row.id} className={selected?.id === row.id ? 'entry active' : 'entry'} style={{ height: v.size, transform: `translateY(${v.start}px)` }} disabled={!!ui.editor || busy} onClick={() => { void selectEntry(row.id); }}>
                <span>{String(row.data[collection.primary_field_id] ?? '')}</span><small>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(row.updated_at))}</small>
              </button>; })}
            </div>
          </div>}
          {page.next && <button disabled={busy || !!ui.editor} onClick={() => { void more(); }}>{t('loadMore')}</button>}
        </>}
      {selected && collection && !ui.editor && <section className="detail"><h2>{String(selected.data[collection.primary_field_id] ?? '')}</h2><button onClick={() => ui.openEditor('entry', String(selected.data[collection.primary_field_id] ?? ''), selected.id)}>{t('edit')}</button></section>}
    </main>
    {ui.editor && <div className="shade"><section className="editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <h2 id="editor-title">{editorTitle}</h2><form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>{fieldLabel}<input autoFocus required maxLength={ui.editor === 'entry' ? undefined : 200} value={ui.text} disabled={busy} onChange={e => ui.setText(e.target.value)}/></label>
        {error && <ErrorMessage code={error}/>}
        <div className="actions"><button type="button" disabled={busy} onClick={() => { ui.openEditor(null); setError(null); }}>{t('cancel')}</button><button className="primary" disabled={busy || !ui.text.trim()}>{ui.editor === 'entry' ? t('save') : t('create')}</button></div>
      </form></section></div>}
  </div>;
}
