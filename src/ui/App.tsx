import { DeviceAppearanceEditor } from './DeviceAppearanceEditor';
import { useAppearance } from './use-appearance';
import { defaultAppearance } from '../core/device-appearance';
import { MarkdownView } from './MarkdownView';
import { splitInboxMarkdown } from '../core/markdown';
import { CreateButton } from './CreateButton';
import { PresetsEditor } from './PresetsEditor';
import { collectionCreationChoice } from '../core/creation-presets';
import { ProfilesEditor } from './ProfilesEditor';
import { fieldConfig } from '../core/validation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  Collection,
  CreationChoice,
  CreationPreset,
  DisplayProfile,
  Entry,
  EntryListItem,
  EntryQuery,
  Field,
  Library,
  Page,
  RecordData,
  UiDefinition,
  UiKind,
} from '../core/model';
import type { Repository } from '../core/repository';
import { layoutItems } from '../core/ui-definition';
import { useUi } from './store';
import { ErrorMessage, errorKey, Modal, useFormatValue } from './common';
import { StructureEditor } from './StructureEditor';
import { FieldsEditor } from './FieldsEditor';
import { LayoutEditor } from './LayoutEditor';
import { RelationBlock } from './RelationBlock';
import { CsvPanel } from './CsvPanel';
import { InboxMoveForm } from './InboxMoveForm';
import { DraftRecordForm } from './DraftRecordForm';
import { RecordForm } from './RecordForm';
import type { Draft, DraftAction, DraftStore } from '../core/drafts';
import { bindSystemBack } from '../platform/local-files';
export { ErrorMessage } from './common';
const emptyLayouts = { form: { fields: [] }, card: { fields: [] }, list: { fields: [] } } as Record<
  UiKind,
  UiDefinition
>;
type Context = { collection: Collection; fields: Field[]; layouts: Record<UiKind, UiDefinition>; inboxOriginal?: string | null };
export function App({ api, drafts }: { api: Repository; drafts: DraftStore }) {
  const { t, i18n } = useTranslation(),
    format = useFormatValue(),
    ui = useUi();
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [appearanceReady, setAppearanceReady] = useState(false);
  useAppearance(appearance);
  useEffect(() => { let active = true; void api.getDeviceAppearance().then(value => { if (active) setAppearance(value); }).catch(error => { if (active) setError(errorKey(error)); }).finally(() => { if (active) setAppearanceReady(true); }); return () => { active = false; }; }, [api]);
  const [libraries, setLibraries] = useState<Library[]>([]),
    [collections, setCollections] = useState<Collection[]>([]);
  const [fields, setFields] = useState<Field[]>([]),
    [layouts, setLayouts] = useState(emptyLayouts);
  const [presets, setPresets] = useState<CreationPreset[]>([]);
  const [creationInitial, setCreationInitial] = useState<RecordData>({});
  const [profiles, setProfiles] = useState<DisplayProfile[]>([]);
  const [quickDefinition, setQuickDefinition] = useState<UiDefinition>({ fields: [] });
  const [openingDraft, setOpeningDraft] = useState<Draft | null>(null);
  const [staleEdit, setStaleEdit] = useState<{ data: RecordData; current: Entry } | null>(null);
  const creationClose = useRef<(() => Promise<void>) | null>(null);
  const registerCreationClose = useCallback((cancel: (() => Promise<void>) | null) => { creationClose.current = cancel; }, []);
  const warnDraftCleanup = () => setError('draftCleanup');
  const [page, setPage] = useState<Page<EntryListItem>>({ items: [], next: null }),
    [selected, setSelected] = useState<Entry | null>(null);
  const [context, setContext] = useState<Context | null>(null),
    [revision, refresh] = useState(0);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false),
    [undo, setUndo] = useState<{ kind: 'library' | 'collection' | 'field' | 'record'; id: string } | null>(
      null
    );
  const [linked, setLinked] = useState<{
    parentId: string;
    fieldId: string;
    context: Context;
    initial: RecordData;
  } | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const previousQuery = useRef<string | null>(null);
  const [search, setSearch] = useState('');
  const searchFor = ui.searchFor;
  const scroll = useRef<HTMLDivElement>(null),
    selectionRequest = useRef(0),
    queryRequest = useRef(0);
  const collection = collections.find((c) => c.id === ui.collectionId),
    library = libraries.find((l) => l.id === ui.libraryId);
  const browsing = ui.scope === 'all' || (ui.scope === 'library' && !!library) || !!collection;
  const activeProfileId = ui.profileId ?? collection?.default_profile_id ?? undefined;
  const query: EntryQuery = {
    ...(ui.scope === 'collection'
      ? { collection_id: collection?.id, ...(activeProfileId ? { profile_id: activeProfileId } : {}) }
      : ui.scope === 'library'
        ? { library_id: library?.id }
        : {}),
    search: ui.search,
  };
  const queryToken = JSON.stringify(query);
  function formatRelations(row: EntryListItem, fieldId: string) {
    const preview = row.relation_previews?.[fieldId];
    if (!preview?.count) return t('noRelations');
    return (
      preview.items
        .map((item) =>
          item.status === 'available' ? item.title || t('unset') : t(`relationStatus.${item.status}`)
        )
        .join(' · ') + (preview.count > 3 ? t('moreRelations', { count: preview.count - 3 }) : '')
    );
  }
  const listItems = layoutItems(layouts.list, fields).filter((item) => item.visible),
    listFields = listItems.map((item) => fields.find((f) => f.id === item.field_id)!);
  const compact = appearance.density === 'compact';
  const rowHeight = appearance.font_scale * (
    ui.scope === 'collection'
      ? Math.max(
          compact ? 64 : 76,
          (compact ? 30 : 38) +
            listFields.length * (layouts.list.list?.mode === 'table' ? 0 : compact ? 22 : 26) +
            (layouts.list.list?.group_field ? 22 : 0)
        )
      : compact ? 76 : 90);
  // React Compiler is disabled; Virtual's imperative measurement API is intentional.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: page.items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 5,
    getItemKey: (index) => page.items[index]!.id,
  });
  useEffect(() => {
    virtual.measure();
  }, [virtual, rowHeight]);
  useEffect(() => {
    const timer = setTimeout(() => searchFor(search), 250);
    return () => clearTimeout(timer);
  }, [search, searchFor]);
  useEffect(() => {
    setSearch(ui.search);
  }, [ui.search]);
  useEffect(() => {
    let active = true;
    api
      .listLibraries()
      .then((rows) => {
        if (active) setLibraries(rows);
      })
      .catch((e) => {
        if (active) setError(errorKey(e));
      });
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    let active = true;
    if (ui.libraryId)
      api
        .listCollections(ui.libraryId)
        .then((rows) => {
          if (active) setCollections(rows);
        })
        .catch((e) => {
          if (active) setError(errorKey(e));
        });
    return () => {
      active = false;
    };
  }, [api, ui.libraryId]);
  useEffect(() => {
    let active = true;
    if (ui.collectionId)
      Promise.all([
        api.listFields(ui.collectionId),
        ...(['form', 'card', 'list'] as const).map((kind) => api.getUiConfig(ui.collectionId!, kind, kind === 'list' ? ui.profileId ?? undefined : undefined)),
        api.getQuickForm(ui.collectionId),
        api.listDisplayProfiles(ui.collectionId),
        api.listCreationPresets(ui.collectionId),
      ])
        .then(([rows, form, card, list, quick, profileRows, presetRows]) => {
          if (active) {
            setFields(rows as Field[]);
            setProfiles(profileRows as DisplayProfile[]);
            setPresets(presetRows as CreationPreset[]);
            setQuickDefinition(quick as UiDefinition);
            setLayouts({
              form: form as UiDefinition,
              card: card as UiDefinition,
              list: list as UiDefinition,
            });
          }
        })
        .catch((e) => {
          if (active) setError(errorKey(e));
        });
    return () => {
      active = false;
    };
  }, [api, ui.collectionId, ui.profileId]);
  useEffect(() => {
    const request = ++queryRequest.current;
    let active = true;
    setPage({ items: [], next: null });
    if (previousQuery.current !== queryToken) {
      setSelected(null);
      selectionRequest.current++;
      setContext(null);
      setTrail([]);
      previousQuery.current = queryToken;
    }
    if (browsing) {
      setLoading(true);
      api
        .queryEntries(JSON.parse(queryToken) as EntryQuery)
        .then((rows) => {
          if (active && request === queryRequest.current) setPage(rows);
        })
        .catch((e) => {
          if (active) setError(errorKey(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      active = false;
    };
  }, [api, queryToken, browsing, revision]);
  async function run(action: () => Promise<void>, close = true, reloadSelected = true) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      // Finish metadata reload before enabling editors; a new form must use the saved defaults.
      const current = useUi.getState();
      const nextLibraries = await api.listLibraries();
      const nextCollections = current.libraryId ? await api.listCollections(current.libraryId) : [];
      const currentCollection = nextCollections.find((c) => c.id === current.collectionId);
      if (currentCollection) {
        const [nextFields, form, card, list, quick, profileRows, presetRows] = await Promise.all([
          api.listFields(currentCollection.id),
          api.getUiConfig(currentCollection.id, 'form'),
          api.getUiConfig(currentCollection.id, 'card'),
          api.getUiConfig(currentCollection.id, 'list', current.profileId ?? undefined),
          api.getQuickForm(currentCollection.id),
          api.listDisplayProfiles(currentCollection.id),
          api.listCreationPresets(currentCollection.id),
        ]);
        setFields(nextFields);
        setProfiles(profileRows);
        setPresets(presetRows);
        setLayouts({ form, card, list });
        setQuickDefinition(quick);
      } else {
        setFields([]);
        setProfiles([]);
        setPresets([]);
        setLayouts(emptyLayouts);
        setQuickDefinition({ fields: [] });
      }
      setLibraries(nextLibraries);
      setCollections(nextCollections);
      if (selected && reloadSelected) {
        const currentEntry = await api.getEntry(selected.id);
        if (currentEntry) await selectEntry(selected.id, true);
        else {
          setSelected(null);
          setContext(null);
        }
      }
      if (close) {
        ui.openEditor(null);
        setLinked(null);
        setOpeningDraft(null);
      }
      refresh((n) => n + 1);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  function showInbox(capture = false) {
    void run(async () => {
      const inbox = await api.getInbox();
      ui.select(inbox.library_id, inbox.id);
      setSelected(null);
      setContext(null);
      setLinked(null);
      setCreationInitial({});
      setSaved(false);
      setOpeningDraft(capture ? await loadCreationDraft(inbox) : null);
      if (capture) ui.openEditor('entry');
    }, !capture, false);
  }
  async function loadCreationDraft(parent: Collection): Promise<Draft | null> {
    const scope = { dataset_id: api.datasetId, library_id: parent.library_id, collection_id: parent.id };
    const draft = await drafts.load(scope);
    if (draft && await api.getDraftTarget(draft.action.create_id)) { await drafts.remove(scope); return null; }
    return draft;
  }
  function beginCreate(choice?: CreationChoice) {
    if (busy || !collection) return;
    setLinked(null); setOpeningDraft(null); setCreationInitial({}); setStaleEdit(null); setError(null); setSaved(false); setBusy(true);
    void (async () => {
      const draft = await loadCreationDraft(collection);
      if (draft) { setOpeningDraft(draft); ui.openEditor('entry'); }
      else {
        const resolved = await api.resolveCreation(collection.id, choice);
        setCreationInitial(resolved.data); ui.openEditor(resolved.form === 'quick' ? 'quick-entry' : 'entry');
      }
    })().catch(error => setError(errorKey(error))).finally(() => setBusy(false));
  }
  function open(editor: typeof ui.editor, editingId?: string) {
    if (!editingId && collection && (editor === 'entry' || editor === 'quick-entry')) { beginCreate({ kind: editor === 'quick-entry' ? 'quick' : 'standard' }); return; }
    setLinked(null); setOpeningDraft(null); setCreationInitial({}); setStaleEdit(null); setError(null); setSaved(false);
    ui.openEditor(editor, '', editingId);
  }
  const close = useCallback(() => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try { await creationClose.current?.(); setLinked(null); setOpeningDraft(null); setStaleEdit(null); ui.openEditor(null); setError(null); }
      catch { setError('draftWrite'); }
      finally { setBusy(false); }
    })();
  }, [busy, ui]);
  useEffect(() => {
    if (ui.editor) return bindSystemBack(close, () => setError('fileError'));
  }, [ui.editor, close]);
  async function saveDraftAction(action: DraftAction, collectionId: string, data: RecordData): Promise<Entry> {
    if (action.kind === 'linked') return api.createLinkedEntry(action.parent_id, action.field_id, data, action.create_id);
    return api.saveNewEntry(collectionId, data, action.create_id);
  }
  function saveEdited(data: RecordData, expectedHlc = selected?.hlc) {
    if (!selected || !context || !expectedHlc) return;
    const id = selected.id, collectionId = context.collection.id;
    void run(async () => {
      try { await api.saveEntry(collectionId, data, id, expectedHlc); setStaleEdit(null); setSaved(true); }
      catch (error) {
        if (errorKey(error) === 'staleRecord') {
          const current = await api.getEntry(id);
          if (current) setStaleEdit({ data, current });
        }
        throw error;
      }
    });
  }
  function remove(kind: NonNullable<typeof undo>['kind'], id: string) {
    void run(async () => {
      await api.setDeleted(kind, id, true);
      setUndo({ kind, id });
      if (kind === 'library') useUi.setState({ libraryId: null, collectionId: null });
      if (kind === 'collection') useUi.setState({ collectionId: null });
    });
  }
  async function more() {
    if (!page.next || busy) return;
    const request = queryRequest.current;
    setBusy(true);
    try {
      const next = await api.queryEntries({ ...query, cursor: page.next });
      if (request === queryRequest.current)
        setPage((old) => ({ items: [...old.items, ...next.items], next: next.next }));
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  async function selectEntry(id: string, preserveSaved = false) {
    const request = ++selectionRequest.current;
    try {
      const entry = await api.getEntry(id);
      if (!entry) throw new Error('notFound');
      const parent = await api.getCollection(entry.collection_id);
      const [entryFields, form, card, list, original] = await Promise.all([
        api.listFields(parent.id),
        api.getUiConfig(parent.id, 'form'),
        api.getUiConfig(parent.id, 'card'),
        api.getUiConfig(parent.id, 'list'),
        api.inboxOriginal(entry),
      ]);
      if (request === selectionRequest.current) {
        setSelected(entry);
        setContext({ collection: parent, fields: entryFields, layouts: { form, card, list }, inboxOriginal: original });
        if (!preserveSaved) setSaved(false);
      }
    } catch (e) {
      if (request === selectionRequest.current) setError(errorKey(e));
    }
  }
  async function createRelated(fieldId: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const target = await api.getLinkedCollection(selected.id, fieldId);
      const [targetFields, form, card, list] = await Promise.all([
        api.listFields(target.id),
        api.getUiConfig(target.id, 'form'),
        api.getUiConfig(target.id, 'card'),
        api.getUiConfig(target.id, 'list'),
      ]);
      const origin = context?.fields.find((f) => f.id === fieldId),
        source =
          origin?.type === 'backlink'
            ? targetFields.find((f) => f.id === fieldConfig(origin).source_field_id)
            : undefined;
      const draft = await loadCreationDraft(target);
      setOpeningDraft(draft);
      setLinked({
        parentId: selected.id,
        fieldId,
        context: { collection: target, fields: targetFields, layouts: { form, card, list } },
        initial: !draft && source ? { [source.id]: fieldConfig(source).multiple ? [selected.id] : selected.id } : {},
      });
      ui.openEditor('entry');
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  const recordContext =
    linked?.context ?? (ui.editingId ? context : collection && fields[0]?.collection_id === collection.id ? { collection, fields, layouts } : null);
  const disabled = busy || !!ui.editor;
  const fieldsReady = fields.length > 0 && fields[0]?.collection_id === collection?.id;
  const title =
    ui.editor === 'appearance' ? t('deviceAppearance') : ui.editor === 'presets' ? t('creationPresets') : ui.editor === 'profiles' ? t('displayProfiles') : ui.editor === 'library'
      ? t(ui.editingId ? 'editLibrary' : 'newLibrary')
      : ui.editor === 'collection'
        ? t(ui.editingId ? 'editCollection' : 'newCollection')
        : ui.editor === 'quick-entry'
          ? t('quickEntry')
        : ui.editor === 'move'
          ? t('moveFromInbox')
        : ui.editor === 'entry'
          ? t(ui.editingId ? 'edit' : 'newEntry')
          : t(ui.editor === 'fields' ? 'fields' : ui.editor === 'csv' ? 'csv' : `layouts.${ui.editor}`);
  const groupField = fields.find((f) => f.id === layouts.list.list?.group_field);
  return (
    <div className={'app' + (ui.navOpen ? ' nav-open' : '')}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▦
          </span>
          <div>
            <b>{t('brand')}</b>
            <small>{t('tagline')}</small>
          </div>
        </div>
        <button disabled={disabled} className={collection?.system_kind === 'inbox' ? 'active' : ''} onClick={() => showInbox()}>
          {t('inbox')}
        </button>
        <div className="nav-heading">{t('libraries')}</div>
        <nav aria-label={t('libraries')}>
          {libraries.map((l) => {
            const a = JSON.parse(l.config) as { icon?: string; color?: string };
            return (
              <div className="library" key={l.id}>
                <button
                  className={l.id === ui.libraryId ? 'active library-button' : 'library-button'}
                  disabled={disabled}
                  onClick={() => ui.select(l.id)}
                >
                  <span aria-hidden="true" style={{ color: a.color }}>
                    {a.icon ?? '◇'}
                  </span>
                  {l.name}
                </button>
                {l.id === ui.libraryId && (
                  <div className="collections">
                    {collections
                      .filter((c) => c.library_id === l.id)
                      .map((c) => {
                        const appearance = JSON.parse(c.config) as { icon?: string; color?: string };
                        return (
                          <button
                            key={c.id}
                            aria-label={c.name}
                            disabled={disabled}
                            className={c.id === ui.collectionId ? 'active' : ''}
                            onClick={() => {
                              ui.select(l.id, c.id);
                              setSaved(false);
                            }}
                          >
                            <span aria-hidden="true" style={{ color: appearance.color }}>
                              {appearance.icon ?? '◇'}
                            </span>
                            {c.name}
                          </button>
                        );
                      })}
                    <button className="quiet" disabled={disabled} onClick={() => open('collection')}>
                      + {t('newCollection')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <button className="quiet" disabled={disabled} onClick={() => open('library')}>
          + {t('newLibrary')}
        </button>
        <footer>
          <span className="local-dot" aria-hidden="true" />
          {t('local')}
          <small>{t('offline')}</small>
        </footer>
      </aside>
      <main>
        <div className="topbar">
          <button
            className="nav-toggle"
            aria-expanded={ui.navOpen}
            disabled={disabled}
            onClick={ui.toggleNav}
          >
            {t('navigation')}
          </button>
          <span className="quiet-label">{t('offline')}</span>
          <button disabled={disabled} onClick={() => showInbox(true)}>+ {t('captureInbox')}</button>
          <button disabled={disabled || !appearanceReady} onClick={() => open('appearance')}>{t('deviceAppearance')}</button>
          <label className="language">
            {t('language')}
            <select
              value={i18n.language}
              onChange={(e) => {
                void i18n.changeLanguage(e.target.value);
              }}
            >
              <option value="ru">{t('languageRussian')}</option>
              <option value="en">{t('languageEnglish')}</option>
            </select>
          </label>
        </div>
        <header>
          <div>
            <small>{library?.name ?? t('libraries')}</small>
            <h1>
              {ui.scope === 'all'
                ? t('allEntries')
                : ui.scope === 'library'
                  ? library?.name
                  : (collection?.system_kind === 'inbox' ? t('inbox') : collection?.name ?? t('brand'))}
            </h1>
          {collection && !collection.system_kind && profiles.some(profile => profile.collection_id === collection.id) &&
            <div className="profile-switcher"><label>{t('displayProfile')}
              <select disabled={disabled || ui.scope !== 'collection'} value={activeProfileId ?? ''} onChange={event => useUi.setState({ profileId: event.target.value })}>
                {profiles.filter(profile => profile.collection_id === collection.id).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label><button disabled={disabled || !fieldsReady} onClick={() => open('profiles')}>{t('displayProfiles')}</button></div>}
          </div>
          {collection && !collection.system_kind && (
            <CreateButton disabled={disabled || !fieldsReady} create={beginCreate} options={[
              { label: t('standardForm'), choice: { kind: 'standard' } }, { label: t('quickEntry'), choice: { kind: 'quick' } },
              ...presets.filter(preset => preset.collection_id === collection.id).map(preset => ({ label: preset.name, choice: { kind: 'preset' as const, preset_id: preset.id } })),
            ]} />
          )}
        </header>
        <div className="toolbar">
          {library && (
            <button disabled={disabled} onClick={() => open('library', library.id)}>
              {t('editLibrary')}
            </button>
          )}
          {collection && !collection.system_kind && (
            <>
              <button disabled={disabled || !fieldsReady} onClick={() => open('collection', collection.id)}>
                {t('editCollection')}
              </button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('fields')}>
                {t('fields')}
              </button>
              {(['form', 'card', 'list'] as const).map((kind) => (
                <button key={kind} disabled={disabled || !fieldsReady} onClick={() => open(kind)}>
                  {t(`layouts.${kind}`)}
                </button>
              ))}
              <button disabled={disabled || !fieldsReady} onClick={() => open('quick')}>{t('layouts.quick')}</button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('presets')}>{t('creationPresets')}</button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('quick-entry')}>+ {t('quickEntry')}</button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('csv')}>
                {t('csv')}
              </button>
            </>
          )}
        </div>
        {(!!libraries.length || browsing) && (
          <div className="searchbar">
            <label>
              {t('search')}
              <input
                type="search"
                value={search}
                placeholder={t('searchPlaceholder')}
                disabled={disabled}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              {t('searchScope')}
              <select
                value={ui.scope}
                disabled={disabled}
                onChange={(e) => ui.searchFor(search, e.target.value as typeof ui.scope)}
              >
                <option value="collection" disabled={!collection}>
                  {t('scopeCollection')}
                </option>
                <option value="library" disabled={!library}>
                  {t('scopeLibrary')}
                </option>
                <option value="all">{t('scopeAll')}</option>
              </select>
            </label>
          </div>
        )}
        {error && !ui.editor && <ErrorMessage code={error} />}
        {saved && (
          <div role="status" className="saved">
            {t('saved')}
          </div>
        )}
        {undo && (
          <div role="status" className="undo">
            {t('deleted')}
            <button
              disabled={disabled}
              onClick={() => {
                void run(async () => {
                  await api.setDeleted(undo.kind, undo.id, false);
                  setUndo(null);
                });
              }}
            >
              {t('undo')}
            </button>
          </div>
        )}
        {!libraries.length && !browsing ? (
          <div className="empty">
            <span aria-hidden="true">▦</span>
            <h2>{t('emptyLibraries')}</h2>
            <p>{t('emptyLibrariesHint')}</p>
            <button className="primary" disabled={disabled} onClick={() => open('library')}>
              {t('newLibrary')}
            </button>
          </div>
        ) : !browsing ? (
          <div className="empty">
            <h2>{t('chooseCollection')}</h2>
            <p>{t('chooseCollectionHint')}</p>
          </div>
        ) : (
          <>
            <div className="list-meta">
              {loading ? t('loading') : t('entryCount', { count: page.items.length })}
            </div>
            {!loading && !page.items.length ? (
              <div className="empty">
                <h2>
                  {t(ui.search || layouts.list.list?.filters?.length ? 'noResults' : 'emptyCollection')}
                </h2>
                <p>{t('emptyCollectionHint')}</p>
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  {layouts.list.list?.mode === 'table' && ui.scope === 'collection' && (
                    <div
                      className="table-head"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(1, listFields.length)}, minmax(120px,1fr))`,
                      }}
                    >
                      {listFields.map((f) => (
                        <b key={f.id}>{f.name}</b>
                      ))}
                    </div>
                  )}
                </div>
                <div className="entry-scroll" ref={scroll}>
                  <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                    {virtual.getVirtualItems().map((v) => {
                      const row = page.items[v.index]!,
                        collectionMode = ui.scope === 'collection' && !collection?.system_kind;
                      return (
                        <button
                          key={row.id}
                          data-index={v.index}
                          ref={virtual.measureElement}
                          className={
                            'entry ' +
                            (collectionMode ? (layouts.list.list?.mode ?? 'rows') : 'rows') +
                            (selected?.id === row.id ? ' active' : '')
                          }
                          style={{ minHeight: rowHeight, transform: `translateY(${v.start}px)` }}
                          disabled={disabled}
                          onClick={() => {
                            void selectEntry(row.id);
                          }}
                        >
                          {collectionMode && groupField && (
                            <small className="list-group">
                              {groupField.name}: {format(groupField, row.data[groupField.id])}
                            </small>
                          )}
                          {collectionMode ? (
                            <div
                              className="entry-values"
                              style={
                                layouts.list.list?.mode === 'table'
                                  ? {
                                      gridTemplateColumns: `repeat(${Math.max(1, listFields.length)}, minmax(120px,1fr))`,
                                    }
                                  : undefined
                              }
                            >
                              {listItems.map((item) => {
                                const f = fields.find((field) => field.id === item.field_id)!;
                                return (
                                  <span key={f.id} className={item.width === 'half' ? 'half' : 'full'}>
                                    {item.group && <small>{item.group} · </small>}
                                    <small>{f.name}: </small>
                                    {['relation', 'backlink'].includes(f.type)
                                      ? formatRelations(row, f.id)
                                      : format(f, row.data[f.id])}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span>
                              {row.title || t('unset')}
                              <small> · {row.collection_system_kind === 'inbox' ? t('inbox') : row.collection_name}</small>
                            </span>
                          )}
                          <small className="entry-date">
                            {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                              new Date(row.updated_at)
                            )}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {page.next && (
              <button
                disabled={disabled}
                onClick={() => {
                  void more();
                }}
              >
                {t('loadMore')}
              </button>
            )}
          </>
        )}
        {selected && context && !ui.editor && (
          <section className="detail">
            <div className="dialog-heading">
              <div>
                {!!trail.length && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      const id = trail.at(-1)!;
                      setTrail((old) => old.slice(0, -1));
                      void selectEntry(id);
                    }}
                  >
                    {t('backToRecord')}
                  </button>
                )}
                <h2>{context.collection.system_kind === 'inbox' ? splitInboxMarkdown(String(selected.data[context.collection.primary_field_id] ?? '')).title : String(selected.data[context.collection.primary_field_id] ?? '')}</h2>
              </div>
              <button aria-label={t('closeCard')} onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <div className="field-grid">
              {layoutItems(context.layouts.card, context.fields)
                .filter((item) => item.visible)
                .map((item) => {
                  const f = context.fields.find((field) => field.id === item.field_id)!;
                  return (
                    <dl key={f.id} className={item.width === 'half' ? 'half' : 'full'}>
                      {item.group && <small>{item.group}</small>}
                      <dt>{context.collection.system_kind === 'inbox' ? t('inboxContent') : f.name}</dt>
                      <dd>
                        {['relation', 'backlink'].includes(f.type) ? (
                          <RelationBlock
                            key={f.id + revision}
                            api={api}
                            entry={selected}
                            field={f}
                            busy={busy}
                            open={(id) => {
                              setTrail((old) => [...old, selected.id]);
                              void selectEntry(id);
                            }}
                            create={() => {
                              void createRelated(f.id);
                            }}
                          />
                        ) : (f.type === 'markdown' || context.collection.system_kind === 'inbox') && typeof selected.data[f.id] === 'string' && selected.data[f.id] !== '' ? (
                          <MarkdownView key={selected.id + f.id} source={String(selected.data[f.id])} />
                        ) : format(f, selected.data[f.id])}
                      </dd>
                    </dl>
                  );
                })}
            </div>
            {context.inboxOriginal != null && <details><summary>{t('inboxOriginal')}</summary><pre className="original-content">{context.inboxOriginal}</pre></details>}
            <div className="actions">
              {context.collection.system_kind === 'inbox' && <button disabled={busy} onClick={() => open('move', selected.id)}>{t('moveFromInbox')}</button>}
              <button disabled={busy} onClick={() => open('entry', selected.id)}>
                {t('edit')}
              </button>
              <button className="danger" disabled={busy} onClick={() => remove('record', selected.id)}>
                {t('delete')}
              </button>
            </div>
          </section>
        )}
      </main>
      {ui.editor && (
        <Modal title={title} close={close} busy={busy}>
          {error && <ErrorMessage code={error} />}
          {ui.editor === 'appearance' && <DeviceAppearanceEditor value={appearance} busy={busy} cancel={close} save={value => { void run(async () => { setAppearance(await api.saveDeviceAppearance(value)); }); }} />}
          {ui.editor === 'move' && selected && <InboxMoveForm api={api} entry={selected} libraries={libraries} busy={busy} cancel={close}
            save={(collectionId, data) => { void run(async () => { await api.moveInboxEntry(selected.id, collectionId, data, selected.hlc); setSaved(true); }); }} />}
          {(ui.editor === 'library' || ui.editor === 'collection') && (
            <StructureEditor
              key={ui.editor + (ui.editingId ?? '')}
              kind={ui.editor}
              entity={ui.editingId ? (ui.editor === 'library' ? library : collection) : undefined}
              fields={fields}
              busy={busy}
              cancel={close}
              remove={() => {
                if (ui.editingId && (ui.editor === 'library' || ui.editor === 'collection'))
                  remove(ui.editor, ui.editingId);
              }}
              save={(name, appearance, position, primary, incoming, mapping) => {
                void run(async () => {
                  if (ui.editor === 'library') {
                    if (ui.editingId) await api.updateLibrary(ui.editingId, { name, appearance, position });
                    else {
                      const row = await api.createLibrary(name, appearance);
                      ui.select(row.id);
                    }
                  } else if (ui.libraryId) {
                    if (ui.editingId)
                      await api.updateCollection(ui.editingId, {
                        name,
                        appearance,
                        position,
                        primary_field_id: primary,
                        incoming_field_id: incoming,
                        inbox_mapping: mapping,
                      });
                    else {
                      const row = await api.createCollection(ui.libraryId, name, t('entryTitle'));
                      await api.updateCollection(row.id, { appearance });
                      ui.select(ui.libraryId, row.id);
                    }
                  }
                });
              }}
            />
          )}
          {ui.editor === 'entry' && !ui.editingId && recordContext && (
            <DraftRecordForm
              api={api}
              store={drafts}
              action={openingDraft?.action ?? (linked ? { kind: 'linked', parent_id: linked.parentId, field_id: linked.fieldId, create_id: crypto.randomUUID() } : { kind: 'save', create_id: crypto.randomUUID() })}
              restored={openingDraft ?? undefined}
              registerClose={registerCreationClose} warn={warnDraftCleanup}
              key={'new:' + recordContext.collection.id}
              collection={recordContext.collection}
              fields={recordContext.fields}
              layout={recordContext.layouts.form}
              initialData={linked?.initial ?? creationInitial}
              pinnedData={!openingDraft ? linked?.initial : undefined}
              busy={busy}
              cancel={close}
              save={(data, action, complete) => {
                void run(async () => {
                  const row = await saveDraftAction(action, recordContext.collection.id, data);
                  if (!(await api.getEntry(row.id))) throw new Error('notFound');
                  await complete();
                  setSaved(true);
                });
              }}
            />
          )}
          {ui.editor === 'entry' && ui.editingId && selected && context && <>
            {staleEdit && <section className="error"><p>{t('staleFormChoice')}</p>
              <button disabled={busy} onClick={() => saveEdited(staleEdit.data, staleEdit.current.hlc)}>{t('saveMyRevision')}</button>
              <button disabled={busy} onClick={() => { setSelected(staleEdit.current); setStaleEdit(null); setError(null); }}>{t('loadCurrentRevision')}</button>
            </section>}
            <RecordForm key={selected.id + ':' + selected.hlc} api={api} collection={context.collection} fields={context.fields}
              layout={context.layouts.form} entry={selected} busy={busy} cancel={close}
              change={data => setStaleEdit(old => old ? { ...old, data } : null)} save={data => saveEdited(data)} />
          </>}
          {ui.editor === 'quick-entry' && collection && fieldsReady && <DraftRecordForm key={'quick:' + collection.id} api={api} collection={collection} store={drafts} initialData={creationInitial}
            action={{ kind: 'save', create_id: crypto.randomUUID() }} registerClose={registerCreationClose} warn={warnDraftCleanup}
            fields={fields}
            layout={{ fields: fields.map(field => ({ ...layouts.form.fields.find(base => base.field_id === field.id),
              ...(quickDefinition.fields.find(item => item.field_id === field.id) ?? { field_id: field.id, visible: false }) })) }}
            busy={busy} cancel={close} save={(data, action, complete) => { void run(async () => {
              if (action.kind === 'save') await api.saveQuickEntry(collection.id, data, action.create_id);
              else await saveDraftAction(action, collection.id, data);
              await complete(); setSaved(true);
            }); }} />}
          {ui.editor === 'quick' && collection && <><p>{t('quickFormHint')}</p><LayoutEditor api={api} kind="card" fields={fields.filter(field => field.type !== 'backlink')}
            definition={quickDefinition} busy={busy} cancel={close} save={definition => { void run(() => api.saveQuickForm(collection.id, definition)); }} /></>}
          {ui.editor === 'fields' && collection && (
            <FieldsEditor
              api={api}
              key={revision}
              collection={collection}
              fields={fields}
              busy={busy}
              remove={(id) => remove('field', id)}
              save={(id, name, type, config, position) => {
                void run(async () => {
                  if (id) await api.updateField(id, { name, config, position });
                  else {
                    const field = await api.createField(collection.id, name, type, config);
                    if (position !== field.position) await api.updateField(field.id, { position });
                  }
                }, false);
              }}
            />
          )}
          {ui.editor === 'presets' && collection && <PresetsEditor api={api} presets={presets} fields={fields} choice={collectionCreationChoice(collection.config)} busy={busy}
            setChoice={choice => { void run(() => api.setCreationChoice(collection.id, choice), false); }}
            save={(id, name, position, definition, makeDefault) => { void run(async () => {
              if (id) await api.updateCreationPreset(id, { name, position, definition, make_default: makeDefault });
              else await api.createCreationPreset(collection.id, name, definition, makeDefault, position);
            }); }} remove={id => { void run(() => api.deleteCreationPreset(id), false); }} />}
          {ui.editor === 'profiles' && collection && <ProfilesEditor profiles={profiles} defaultId={collection.default_profile_id ?? null}
            busy={busy} cancel={close} create={name => { void run(async () => {
              const profile = await api.createDisplayProfile(collection.id, name, layouts.list);
              useUi.setState({ profileId: profile.id });
            }); }}
            update={(id, patch) => { void run(async () => { await api.updateDisplayProfile(id, patch); }, false); }}
            remove={id => { void run(async () => { await api.deleteDisplayProfile(id); useUi.setState({ profileId: null }); }, false); }} />}
          {(ui.editor === 'form' || ui.editor === 'card' || ui.editor === 'list') && collection && (
            <LayoutEditor
              api={api}
              key={ui.editor}
              kind={ui.editor}
              fields={fields}
              definition={layouts[ui.editor]}
              busy={busy}
              cancel={close}
              save={(definition) => {
                const kind = ui.editor as UiKind;
                void run(async () => {
                  if (kind === 'list' && activeProfileId) await api.updateDisplayProfile(activeProfileId, { definition });
                  else await api.saveUiConfig(collection.id, kind, definition);
                });
              }}
            />
          )}
          {ui.editor === 'csv' && collection && (
            <CsvPanel
              api={api}
              query={{ ...query, collection_id: collection.id }}
              fields={fields}
              name={collection.name}
              busy={busy}
              run={run}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
