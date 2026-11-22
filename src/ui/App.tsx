import { freezeDateSelection } from '../core/date-selection';
import type { CollectionProjection } from '../core/collection-projection';
import type { SummaryMeasure, SummaryResult } from '../core/query-summary';
import { QueryTotals } from './QueryTotals';
import { KanbanBoard } from './KanbanBoard';
import { CalendarView } from './CalendarView';
import { LibrarySummaryView, type WidgetState } from './LibrarySummaryView';
import { LibrarySummaryEditor } from './LibrarySummaryEditor';
import { librarySummary, type SummaryWidget } from '../core/library-summary';
import { TreeView } from './TreeView';
import { localDateLiteral } from '../core/relative-dates';
import { quickLayout } from '../core/quick-forms';
import { SecretValue } from './TypedFieldInput';
import { CalculatedValue } from './CalculatedValue';
import { isCalculated } from '../core/calculated-fields';
import { QuickActions } from './QuickActions';
import { Catalog } from './Catalog';
import { ConstructorOverview } from './ConstructorOverview';
import { Icon } from './Icon';
import { AttachmentSettings } from './AttachmentSettings';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { AndroidMailSyncSettings } from './AndroidMailSyncSettings';
import { startAndroidMailScheduler } from '../platform/mail-sync-scheduler';
import { nativeMailSyncSupported } from '../platform/native-mail-sync';
import { LargeAttachments } from './LargeAttachments';
import { androidDeviceLock, confirmDeviceIdentity, deviceAuthAvailable } from '../platform/device-auth';
import { ExternalCalendarActions } from './ExternalCalendarActions';
import { AttachmentList } from './AttachmentList';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { RecordCover } from './RecordCover';
import { fileIds, isFile } from '../core/attachments';
import { Trash } from './Trash';
import { RecordHistory } from './RecordHistory';
import { LibraryStartEditor } from './LibraryStartEditor';
import { libraryNavigation } from '../core/library-navigation';
import { androidLibraryShortcuts, libraryShortcutSupported, pinLibraryShortcut, subscribeLibraryLaunch } from '../platform/external-actions';
import { LayoutRowsView } from './LayoutRowsView';
import { NamedCardLayoutsEditor } from './NamedCardLayoutsEditor';
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { layoutItems, resolveCardLayout } from '../core/ui-definition';
import { useUi } from './store';
import { ErrorMessage, errorKey, EditorPage, useFormatValue } from './common';
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
const emptyTotals: readonly SummaryMeasure[] = [];
type Context = { collection: Collection; fields: Field[]; layouts: Record<UiKind, UiDefinition>; inboxOriginal?: string | null; unmappedAttachments: string[] };
type BrowsePosition = { token: string; count: number; documentTop: number; listTop: number; focus: HTMLElement | null; focusId?: string };
export function App({ api, drafts, suspended = false, openArchive }: { api: Repository; drafts: DraftStore; suspended?: boolean; openArchive?: () => void }) {
  const { t, i18n } = useTranslation(),
    format = useFormatValue(),
    ui = useUi();
  const [fileCleanupPending, setFileCleanupPending] = useState(0);
  useEffect(() => { if (!nativeMailSyncSupported() || suspended) return; return startAndroidMailScheduler(api); }, [api, suspended]);
  const [libraryGate, setLibraryGate] = useState<{ id: string; required: boolean; approved: boolean } | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateWorking, setGateWorking] = useState(false);
  useEffect(() => {
    if (!androidDeviceLock() || !ui.libraryId) return;
    const id = ui.libraryId;
    let active = true;
    void api.isLibraryLocked(id).then(required => {
      if (active) setLibraryGate({ id, required, approved: false });
    }).catch(e => { if (active) setGateError(errorKey(e)); });
    return () => { active = false; };
  }, [api, ui.libraryId]);
  useEffect(() => {
    if (!androidDeviceLock()) return;
    const obscure = () => {
      if (document.hidden) setLibraryGate(previous => previous && { ...previous, approved: false });
    };
    document.addEventListener('visibilitychange', obscure);
    return () => document.removeEventListener('visibilitychange', obscure);
  }, []);
  async function unlockLibrary() {
    if (!ui.libraryId || gateWorking) return;
    setGateWorking(true); setGateError(null);
    try {
      await confirmDeviceIdentity();
      const required = await api.isLibraryLocked(ui.libraryId);
      setLibraryGate({ id: ui.libraryId, required, approved: true });
    } catch (e) { setGateError(errorKey(e)); }
    finally { setGateWorking(false); }
  }
  async function toggleLibraryLock() {
    if (!ui.libraryId || gateWorking) return;
    setGateWorking(true); setGateError(null);
    try {
      if (!(await deviceAuthAvailable())) throw new Error('authUnavailable');
      await confirmDeviceIdentity();
      const current = await api.isLibraryLocked(ui.libraryId);
      await api.setLibraryLocked(ui.libraryId, !current);
      setLibraryGate({ id: ui.libraryId, required: !current, approved: true });
    } catch (e) { setGateError(errorKey(e)); }
    finally { setGateWorking(false); }
  }

  const [appearance, setAppearance] = useState(defaultAppearance);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [shortcutAvailable, setShortcutAvailable] = useState(false), [shortcutRequested, setShortcutRequested] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<{ id: string; sequence: number } | null>(null);
  const launchSequence = useRef(0), consumingLaunch = useRef<number | null>(null);
  useAppearance(appearance);
  useEffect(() => { let active = true; void api.getDeviceAppearance().then(value => { if (active) setAppearance(value); }).catch(error => { if (active) setError(errorKey(error)); }).finally(() => { if (active) setAppearanceReady(true); }); return () => { active = false; }; }, [api]);
  useEffect(() => {
    if (suspended) return;
    const cleanup = () => { if (!document.hidden) void api.cleanTrash().then(async count => { const files = await api.collectAttachmentFiles(); setFileCleanupPending(files.pending); if (count) refresh(value => value + 1); }).catch(e => setError(errorKey(e))); };
    void api.collectAttachmentFiles().then(result => setFileCleanupPending(result.pending)).catch(e => setError(errorKey(e)));
    const stop = drafts.lifecycle.subscribe(state => { if (state === 'active') cleanup(); });
    const timer = window.setInterval(cleanup, 5 * 60 * 1000);
    return () => { stop(); window.clearInterval(timer); };
  }, [api, drafts, suspended]);
  const [libraries, setLibraries] = useState<Library[]>([]),
    [collections, setCollections] = useState<Collection[]>([]);
  const [libraryMeta, setLibraryMeta] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Field[]>([]),
    [layouts, setLayouts] = useState(emptyLayouts);
  const [presets, setPresets] = useState<CreationPreset[]>([]);
  const [creationInitial, setCreationInitial] = useState<RecordData>({});
  const [profiles, setProfiles] = useState<DisplayProfile[]>([]);
  const [quickDefinition, setQuickDefinition] = useState<UiDefinition>({ fields: [] });
  const [draftRecoveryPath, setDraftRecoveryPath] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState<Draft | null>(null);
  const [staleEdit, setStaleEdit] = useState<{ data: RecordData; current: Entry } | null>(null);
  const fileClose = useRef<(() => Promise<void>) | null>(null);
  const designerDirty = useRef(false);
  const settingsReturn = useRef(false);
  const registerDesignerDirty = useCallback((value: boolean) => { designerDirty.current = value; }, []);
  const registerFileClose = useCallback((close: (() => Promise<void>) | null) => { fileClose.current = close; }, []);
  const creationClose = useRef<(() => Promise<void>) | null>(null);
  const creationMenuClose = useRef<(() => void) | null>(null);
  const registerCreationMenuClose = useCallback((close: (() => void) | null) => { creationMenuClose.current = close; }, []);
  const fieldPropertiesClose = useRef<(() => void) | null>(null);
  const registerFieldPropertiesClose = useCallback((close: (() => void) | null) => { fieldPropertiesClose.current = close; }, []);
  const registerCreationClose = useCallback((cancel: (() => Promise<void>) | null) => { creationClose.current = cancel; }, []);
  const warnDraftCleanup = () => setError('draftCleanup');
  const [page, setPage] = useState<Page<EntryListItem>>({ items: [], next: null }),
    [selected, setSelected] = useState<Entry | null>(null);
  const [projection, setProjection] = useState<CollectionProjection | null>(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [totals, setTotals] = useState<SummaryResult[] | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [totalsError, setTotalsError] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => localDateLiteral().slice(0, 7));
  const [summaryMonths, setSummaryMonths] = useState<Record<string, string>>({});
  const [widgetStates, setWidgetStates] = useState<Record<string, WidgetState>>({});
  const [drilldown, setDrilldown] = useState<{ scope: string; field: string; value: import('../core/model').JsonValue; date?: string } | null>(null);
  const [context, setContext] = useState<Context | null>(null),
    [revision, refresh] = useState(0);
  const [failedBrowse, setFailedBrowse] = useState<{ token: string; revision: number; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!androidLibraryShortcuts) return;
    let active = true, stop: (() => void) | undefined;
    void libraryShortcutSupported().then(value => { if (active) setShortcutAvailable(value); }).catch(() => { if (active) setShortcutAvailable(false); });
    void subscribeLibraryLaunch(id => { if (active) setLaunchTarget({ id, sequence: ++launchSequence.current }); })
      .then(unsubscribe => { if (active) stop = unsubscribe; else unsubscribe(); })
      .catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; stop?.(); };
  }, []);
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
  const browsePosition = useRef<BrowsePosition | null>(null);
  const browsePositions = useRef(new Map<string, BrowsePosition>());
  const searchRecordOrigin = useRef<{ token: string; id: string; trail: string[] } | null>(null);
  const pendingRecordReturn = useRef<{ token: string; id: string; trail: string[] } | null>(null);
  const restoreBrowse = useRef(false);
  const editorOrigin = useRef<{ id: string | null; top: number } | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<{ token: string; revision: number } | null>(null);
  const [readyBrowse, setReadyBrowse] = useState<{ token: string; revision: number } | null>(null);
  const cardHeading = useRef<HTMLHeadingElement>(null);
  const [search, setSearch] = useState('');
  const [recentMode, setRecentMode] = useState(false);
  const searchFor = ui.searchFor;
  const scroll = useRef<HTMLDivElement>(null),
    navigationRequest = useRef(0),
    selectionRequest = useRef(0),
    queryRequest = useRef(0);
  const collection = collections.find((c) => c.id === ui.collectionId),
    library = libraries.find((l) => l.id === ui.libraryId);
  const browsing = ui.screen === 'records' && (ui.scope === 'all' || (ui.scope === 'library' && !!library) || !!collection);
  useEffect(() => {
    if (!browsing && ui.screen !== 'summary') return;
    let day = localDateLiteral(), timer: ReturnType<typeof setTimeout>;
    const checkDay = () => {
      const today = localDateLiteral();
      if (today !== day) { day = today; refresh(value => value + 1); }
      clearTimeout(timer);
      const now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(checkDay, Math.max(1000, midnight.getTime() - now.getTime() + 50));
    };
    checkDay();
    window.addEventListener('focus', checkDay);
    document.addEventListener('visibilitychange', checkDay);
    return () => { clearTimeout(timer); window.removeEventListener('focus', checkDay); document.removeEventListener('visibilitychange', checkDay); };
  }, [browsing, ui.screen]);
  const activeDateSelection = browsing && ui.scope === 'collection' ? layouts.list.list?.date_selection : null;
  const activeDateRange = activeDateSelection ? freezeDateSelection(activeDateSelection) : null;
  const activeProfileId = ui.profileId ?? collection?.default_profile_id ?? undefined;
  const viewMode = ui.scope === 'collection' && !collection?.system_kind ? (layouts.list.list?.mode ?? 'rows') : 'rows';
  const viewField = layouts.list.list?.mode_field;
  const drillScope = collection?.id ?? '';
  const activeDrilldown = drilldown?.scope === drillScope ? drilldown : null;
  const query: EntryQuery = {
    ...(ui.scope === 'collection'
      ? { collection_id: collection?.id, ...(activeProfileId ? { profile_id: activeProfileId } : {}) }
      : ui.scope === 'library'
        ? { library_id: library?.id }
        : {}),
    search: ui.search,
    ...(activeDrilldown && layouts.list.list ? {
      filters: [...(layouts.list.list.filters ?? []), ...(activeDrilldown.date ? [] : [{ field_id: activeDrilldown.field, op: activeDrilldown.value == null ? 'empty' as const : 'eq' as const, ...(activeDrilldown.value != null ? { value: activeDrilldown.value } : {}) }])],
      date_selection: activeDrilldown.date ? { field_id: activeDrilldown.field, period: 'range' as const, start: activeDrilldown.date, end: activeDrilldown.date } : layouts.list.list.date_selection ?? null,
    } : {}),
  };
  const queryToken = JSON.stringify(query);
  const summaryWidgets = library && ui.screen === 'summary' ? librarySummary(library).widgets : [];
  const summaryToken = JSON.stringify([library?.id, ui.screen, summaryWidgets, summaryMonths, revision]);
  useEffect(() => {
    if (ui.screen !== 'summary' || !library) { setWidgetStates({}); return; }
    const controller = new AbortController();
    const widgets = librarySummary(library).widgets;
    setWidgetStates(Object.fromEntries(widgets.map(widget => [widget.id, { loading: true, error: null, data: null }])));
    for (const widget of widgets) {
      void api.readSummaryWidget(library.id, widget, summaryMonths[widget.id], controller.signal)
        .then(data => { if (!controller.signal.aborted) setWidgetStates(old => ({ ...old, [widget.id]: { loading: false, error: null, data } })); })
        .catch(error => { if (!controller.signal.aborted) setWidgetStates(old => ({ ...old, [widget.id]: { loading: false, error: errorKey(error), data: null } })); });
    }
    return () => controller.abort();
    // Widgets and requested months are represented in summaryToken.
  }, [api, summaryToken, ui.screen, library, summaryMonths]);
  const specialMode = !activeDrilldown && ['kanban', 'calendar', 'tree'].includes(viewMode) && !!viewField && ui.scope === 'collection';
  const projectionToken = JSON.stringify([queryToken, viewMode, viewField, calendarMonth, revision, layouts.list.fields, layouts.list.quick_actions]);
  useEffect(() => {
    if (!specialMode) { setProjection(null); setProjectionError(null); setProjectionLoading(false); return; }
    const controller = new AbortController();
    setProjectionLoading(true); setProjection(null); setProjectionError(null);
    const options = { mode: viewMode as 'kanban' | 'calendar' | 'tree', mode_field: viewField };
    const previewFields = [...(layouts.list.fields.filter(item => item.visible).map(item => item.field_id)), ...(layouts.list.quick_actions?.map(action => action.field_id) ?? [])];
    void api.projectCollection(JSON.parse(queryToken) as EntryQuery, options, calendarMonth, controller.signal, previewFields)
      .then(value => { if (!controller.signal.aborted) setProjection(value); })
      .catch(error => { if (!controller.signal.aborted) setProjectionError(errorKey(error)); })
      .finally(() => { if (!controller.signal.aborted) setProjectionLoading(false); });
    return () => controller.abort();
    // Options and preview IDs are represented by the serialized token.
  }, [api, projectionToken, specialMode, queryToken, viewMode, viewField, calendarMonth, layouts.list.fields, layouts.list.quick_actions]);
  const totalMeasures = ui.scope === 'collection' ? layouts.list.totals ?? emptyTotals : emptyTotals;
  const totalToken = JSON.stringify([queryToken, totalMeasures, revision]);
  useEffect(() => {
    if (!browsing || ui.scope !== 'collection' || !totalMeasures.length) { setTotals(null); setTotalsError(null); setTotalsLoading(false); return; }
    const controller = new AbortController();
    setTotalsLoading(true); setTotals(null); setTotalsError(null);
    void api.queryTotals(JSON.parse(queryToken) as EntryQuery, totalMeasures, controller.signal)
      .then(value => { if (!controller.signal.aborted) setTotals(value); })
      .catch(error => { if (!controller.signal.aborted) setTotalsError(errorKey(error)); })
      .finally(() => { if (!controller.signal.aborted) setTotalsLoading(false); });
    return () => controller.abort();
    // The serialized token captures query, measures and revision.
  }, [api, totalToken, browsing, ui.scope, totalMeasures, queryToken]);
  const rowsReady = readyBrowse?.token === queryToken && readyBrowse.revision === revision;
  const queryFailure = !loading && failedBrowse?.token === queryToken && failedBrowse.revision === revision ? failedBrowse.code : null;
  const readingEntries = loading || (!rowsReady && !queryFailure);
  const searchContextToken = JSON.stringify([ui.screen, ui.scope, ui.libraryId, ui.collectionId, !!ui.searchOrigin]);
  const rememberBrowse = useCallback(() => {
    if (rowsReady && browsing && !selected && !useUi.getState().editor) {
      browsePosition.current = { token: queryToken, count: page.items.length, documentTop: window.scrollY, listTop: scroll.current?.scrollTop ?? 0,
        focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        focusId: document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId : undefined };
      browsePositions.current.set(queryToken, { ...browsePosition.current, focus: null });
      restoreBrowse.current = true;
    }
  }, [rowsReady, browsing, selected, queryToken, page.items.length]);
  const selectedId = selected?.id ?? null;
  useLayoutEffect(() => {
    if (ui.editor || !selectedId) return;
    cardHeading.current?.focus({ preventScroll: true });
    const origin = editorOrigin.current, target = origin?.id === selectedId ? origin.top : 0;
    editorOrigin.current = null;
    let frame = 0, observer: ResizeObserver | undefined;
    const inputs = ['pointerdown', 'wheel', 'touchstart', 'keydown', 'resize'] as const;
    const stop = () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      inputs.forEach(type => window.removeEventListener(type, stop, true));
    };
    const restore = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) < 1) stop();
    };
    const card = cardHeading.current?.closest('.detail');
    if (target > 0 && card) {
      // Relation blocks may still be loading when the card returns. A clamped
      // first scroll must not discard its saved position; user input always wins.
      observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); });
      observer.observe(card);
      inputs.forEach(type => window.addEventListener(type, stop, { capture: true, passive: true }));
    }
    frame = requestAnimationFrame(restore);
    return stop;
  }, [ui.editor, selectedId]);
  useLayoutEffect(() => {
    if (!browsing || ui.editor || selectedId) { setReadyBrowse(null); return; }
    if (loadedQuery?.token !== queryToken || loadedQuery.revision !== revision) return;
    const ready = () => setReadyBrowse({ token: queryToken, revision });
    if (!restoreBrowse.current) { ready(); return; }
    const frame = requestAnimationFrame(() => {
      const position = browsePosition.current;
      if (position?.token === queryToken) {
        if (scroll.current) scroll.current.scrollTop = position.listTop;
        window.scrollTo(0, position.documentTop);
      }
      restoreBrowse.current = false; editorOrigin.current = null;
      ready();
    });
    return () => cancelAnimationFrame(frame);
  }, [ui.editor, selectedId, queryToken, loadedQuery, revision, browsing]);
  useLayoutEffect(() => {
    if (!rowsReady || ui.editor || selectedId) return;
    const position = browsePosition.current;
    if (position?.token !== queryToken) return;
    // Rows must be enabled before focus can be restored; focusing a disabled button is ignored.
    if (position.focus?.isConnected && !position.focus.closest('[inert]')) position.focus.focus({ preventScroll: true });
    else if (position.focusId) {
      const frame = requestAnimationFrame(() => {
        scroll.current?.querySelector<HTMLElement>(`[data-entry-id="${position.focusId}"]`)?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [rowsReady, ui.editor, selectedId, queryToken]);
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
  const listItems = layoutItems(layouts.list, fields).filter((item) => item.visible && fields.find(field => field.id === item.field_id)?.type !== 'secret'),
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
  }, [search, searchFor, searchContextToken]);
  useEffect(() => {
    setSearch(ui.search);
  }, [ui.search, searchContextToken]);
  useEffect(() => {
    let active = true;
    api
      .listLibraries()
      .then((rows) => {
        if (active) setLibraries(rows);
        void Promise.all(rows.map(async library => {
          const collections = await api.listCollections(library.id);
          return [library.id, t('collectionCount', { count: collections.filter(item => !item.system_kind).length })] as const;
        })).then(meta => { if (active) setLibraryMeta(Object.fromEntries(meta)); }).catch(() => { /* Metadata is optional; library navigation stays available. */ });
      })
      .catch((e) => {
        if (active) setError(errorKey(e));
      });
    return () => {
      active = false;
    };
  }, [api, t]);
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
    if (!library || library.system_kind) return;
    const location = ui.screen === 'summary' ? { kind: 'summary' as const } : ui.screen === 'library' ? { kind: 'collections' as const } :
      ui.screen === 'records' && ui.scope === 'collection' && collection?.library_id === library.id ?
        { kind: 'collection' as const, collection_id: collection.id, ...(activeProfileId ? { profile_id: activeProfileId } : {}) } : null;
    if (location) void api.rememberLibraryLocation(library.id, location).catch(e => setError(errorKey(e)));
  }, [api, library, collection, activeProfileId, ui.screen, ui.scope]);
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
    const sameQuery = previousQuery.current === queryToken;
    const retainedCount = browsePositions.current.get(queryToken)?.count ?? (sameQuery && browsePosition.current?.token === queryToken ? browsePosition.current.count : 0);
    if (!sameQuery || !browsing) setPage({ items: [], next: null });
    if (!sameQuery) {
      setSelected(null);
      selectionRequest.current++;
      setContext(null);
      setTrail([]);
      previousQuery.current = queryToken;
      browsePosition.current = browsePositions.current.get(queryToken) ?? null;
      restoreBrowse.current = !!browsePosition.current;
    }
    if (browsing) {
      setLoading(true);
      api
        .queryEntries(JSON.parse(queryToken) as EntryQuery)
        .then(async (first) => {
          let rows = first;
          // Refresh only the range already loaded before opening the page.
          // Keep its DOM/scroll context until all bounded SQL pages are ready.
          while (active && request === queryRequest.current && rows.next && rows.items.length < retainedCount) {
            const next = await api.queryEntries({ ...JSON.parse(queryToken) as EntryQuery, cursor: rows.next });
            rows = { items: [...rows.items, ...next.items], next: next.next };
          }
          if (active && request === queryRequest.current) { setPage(rows); setLoadedQuery({ token: queryToken, revision }); setFailedBrowse(null); }
        })
        .catch((e) => {
          if (active && request === queryRequest.current) setFailedBrowse({ token: queryToken, revision, code: errorKey(e) });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      active = false;
    };
  }, [api, queryToken, browsing, revision]);
  const selectEntry = useCallback(async (id: string, preserveSaved = false, captureBrowse = true) => {
    if (captureBrowse) rememberBrowse();
    const request = ++selectionRequest.current;
    try {
      const entry = await api.getEntry(id);
      if (!entry) throw new Error('notFound');
      const parent = await api.getCollection(entry.collection_id);
      const [entryFields, form, card, list, original, unmappedAttachments] = await Promise.all([
        api.listFields(parent.id),
        api.getUiConfig(parent.id, 'form'),
        api.getUiConfig(parent.id, 'card'),
        api.getUiConfig(parent.id, 'list'),
        api.inboxOriginal(entry),
        api.unmappedAttachments(entry),
      ]);
      if (request === selectionRequest.current) {
        setSelected(entry);
        setContext({ collection: parent, fields: entryFields, layouts: { form, card, list }, inboxOriginal: original, unmappedAttachments });
        if (!preserveSaved) setSaved(false);
        return true;
      }
    } catch (e) {
      if (request === selectionRequest.current) setError(errorKey(e));
    }
    return false;
  }, [api, rememberBrowse]);
  useEffect(() => {
    const origin = pendingRecordReturn.current;
    if (!origin || ui.searchOrigin || ui.screen !== 'records' || origin.token !== queryToken || loadedQuery?.token !== queryToken || loadedQuery.revision !== revision) return;
    pendingRecordReturn.current = null;
    void selectEntry(origin.id, false, false).then(opened => { if (opened) setTrail(origin.trail); });
  }, [ui.searchOrigin, ui.screen, queryToken, loadedQuery, revision, selectEntry]);
  async function run(action: () => Promise<void>, close = true, reloadSelected = true) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false); setShortcutRequested(false);
    try {
      await action();
      const cleanup = await api.collectAttachmentFiles(); setFileCleanupPending(cleanup.pending);
      if (close) await fileClose.current?.();
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
    rememberBrowse();
    searchRecordOrigin.current = null; pendingRecordReturn.current = null;
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
    setDraftRecoveryPath(null);
    let draft: Draft | null;
    try { draft = await drafts.load(scope); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'invalidDraft') throw error;
      const recovered = await drafts.recoverCorrupt(scope);
      draft = recovered.draft; setDraftRecoveryPath(recovered.recovered_path);
    }
    if (draft && await api.getDraftTarget(draft.action.create_id)) { await drafts.remove(scope); return null; }
    return draft;
  }
  function clearRecordContext() {
    searchRecordOrigin.current = null; pendingRecordReturn.current = null;
    selectionRequest.current++; setSelected(null); setContext(null); setTrail([]); setSaved(false); setShortcutRequested(false); setError(null);
  }
  async function openLibrary(id: string, closeDrawer = false) {
    if (busy || ui.editor) return;
    rememberBrowse(); const request = ++navigationRequest.current; setBusy(true); clearRecordContext();
    try {
      const target = await api.resolveLibraryStart(id);
      if (request === navigationRequest.current) {
        if (target.kind === 'summary') ui.selectSummary(id);
        else ui.select(id, target.kind === 'collection' ? target.collection_id : undefined, target.kind === 'collection' ? target.profile_id : undefined);
        if (closeDrawer) useUi.setState({ navOpen: false });
      }
    } catch (e) { if (request === navigationRequest.current) setError(errorKey(e)); }
    finally { if (request === navigationRequest.current) setBusy(false); }
  }
  useEffect(() => {
    if (!launchTarget || busy || ui.editor || consumingLaunch.current !== null) return;
    const target = launchTarget; consumingLaunch.current = target.sequence;
    void openLibrary(target.id, true).finally(() => {
      consumingLaunch.current = null;
      setLaunchTarget(current => current?.sequence === target.sequence ? null : current ? { ...current } : null);
    });
  });
  async function requestShortcut() {
    if (!library || busy || ui.editor) return;
    setBusy(true); setSaved(false); setShortcutRequested(false); setError(null);
    try { await pinLibraryShortcut(library.id, library.name); setShortcutRequested(true); }
    catch (e) { setError(errorKey(e)); }
    finally { setBusy(false); }
  }
  function goHome() {
    if (busy || ui.editor) return;
    rememberBrowse(); clearRecordContext(); setRecentMode(false); ui.home();
  }
  function openGlobalSearch(recent = false) {
    if (busy || ui.editor) return;
    if (ui.searchOrigin && ui.scope === 'all') { setRecentMode(recent); return; }
    const origin = selected ? { token: queryToken, id: selected.id, trail: [...trail] } : null;
    const proceed = () => { rememberBrowse(); clearRecordContext(); searchRecordOrigin.current = origin; setRecentMode(recent); ui.globalSearch(); };
    if (!androidDeviceLock()) { proceed(); return; }
    setBusy(true); setError(null);
    void api.listLibraries().then(async items => {
      const locked = await Promise.all(items.map(library => api.isLibraryLocked(library.id)));
      if (locked.some(Boolean)) setError('globalSearchLocked');
      else proceed();
    }).catch(e => setError(errorKey(e))).finally(() => setBusy(false));
  }
  function beginCreate(choice?: CreationChoice) {
    if (busy || !collection) return;
    selectionRequest.current++;
    rememberBrowse(); editorOrigin.current = { id: selected?.id ?? null, top: window.scrollY };
    // Creating a record edits values, not the library structure: leave the
    // constructor before opening the form and return to the data list on Save.
    useUi.setState({ navOpen: false, constructorOpen: false });
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
  async function createFromWidget(widget: SummaryWidget) {
    if (busy || !library) return;
    const collectionId = widget.collection_id;
    setBusy(true); setError(null); clearRecordContext(); setOpeningDraft(null); setCreationInitial({});
    try {
      const target = await api.getCollection(collectionId);
      const [nextFields, form, card, list, quick] = await Promise.all([
        api.listFields(collectionId),
        api.getUiConfig(collectionId, 'form'),
        api.getUiConfig(collectionId, 'card'),
        api.getUiConfig(collectionId, 'list', widget.profile_id),
        api.getQuickForm(collectionId),
      ]);
      const draft = await loadCreationDraft(target);
      let editor: 'entry' | 'quick-entry' = 'entry';
      if (draft) setOpeningDraft(draft);
      else {
        const resolved = await api.resolveCreation(collectionId);
        setCreationInitial(resolved.data);
        editor = resolved.form === 'quick' ? 'quick-entry' : 'entry';
      }
      setFields(nextFields); setLayouts({ form, card, list }); setQuickDefinition(quick);
      ui.select(library.id, collectionId, widget.profile_id);
      ui.openEditor(editor);
    } catch (error) { setError(errorKey(error)); }
    finally { setBusy(false); }
  }
  function open(editor: typeof ui.editor, editingId?: string) {
    setDraftRecoveryPath(null);
    settingsReturn.current = ui.editor === 'settings' && editor !== 'settings';
    if (!editingId && collection && (editor === 'entry' || editor === 'quick-entry')) { beginCreate({ kind: editor === 'quick-entry' ? 'quick' : 'standard' }); return; }
    selectionRequest.current++;
    rememberBrowse(); editorOrigin.current = { id: selected?.id ?? null, top: window.scrollY };
    if (editor) useUi.setState({ navOpen: false });
    if (editor && ['library-start','library-summary','library','collection','fields','form','card','list','quick','profiles','presets'].includes(editor)) useUi.setState({ constructorOpen: true });
    setLinked(null); setOpeningDraft(null); setCreationInitial({}); setStaleEdit(null); setError(null); setSaved(false);
    ui.openEditor(editor, '', editingId);
  }
  const close = useCallback(() => {
    if (busy) return;
    if (fieldPropertiesClose.current) { fieldPropertiesClose.current(); return; }
    if (designerDirty.current && !window.confirm(t('hybridDiscardWarning'))) return;
    designerDirty.current = false;
    const returnToSettings = settingsReturn.current && ui.editor !== 'settings';
    settingsReturn.current = false;
    setBusy(true);
    void (async () => {
      try { await fileClose.current?.(); await creationClose.current?.(); setLinked(null); setOpeningDraft(null); setStaleEdit(null); ui.openEditor(returnToSettings ? 'settings' : null); setError(null); }
      catch { setError('draftWrite'); }
      finally { setBusy(false); }
    })();
  }, [busy, ui, t]);
  const backRecord = useCallback(() => {
    if (busy) return;
    const parent = trail.at(-1);
    if (parent) { setTrail(old => old.slice(0, -1)); void selectEntry(parent); }
    else { selectionRequest.current++; setSelected(null); setContext(null); setTrail([]); }
  }, [busy, trail, selectEntry]);
  const backSection = useCallback(() => {
    if (busy) return;
    rememberBrowse();
    if (ui.searchOrigin) {
      pendingRecordReturn.current = searchRecordOrigin.current; searchRecordOrigin.current = null;
      ui.leaveSearch();
    }
    else if ((ui.screen === 'records' || ui.screen === 'summary') && ui.libraryId && !collection?.system_kind) ui.select(ui.libraryId);
    else ui.home();
  }, [busy, rememberBrowse, ui, collection?.system_kind]);
  useEffect(() => {
    if (suspended) return;
    const bind = (action: () => void) => bindSystemBack(() => {
      const menu = creationMenuClose.current;
      if (menu) menu(); else action();
    }, () => setError('fileError'));
    if (ui.editor) return bind(close);
    if (selected) return bind(backRecord);
    if (ui.constructorOpen) return bind(() => { if (!busy) useUi.setState({ constructorOpen: false }); });
    if (ui.screen !== 'libraries' || ui.navOpen) return bind(() => {
      if (ui.navOpen) useUi.setState({ navOpen: false }); else backSection();
    });
  }, [ui.editor, ui.constructorOpen, ui.screen, ui.navOpen, close, busy, selected, backRecord, backSection, suspended]);
  useEffect(() => {
    if (suspended || ui.editor || selected || ui.screen === 'libraries') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || busy) return;
      event.preventDefault();
      if (ui.navOpen) useUi.setState({ navOpen: false });
      else if (ui.constructorOpen) useUi.setState({ constructorOpen: false });
      else backSection();
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [ui.editor, selected, ui.screen, ui.navOpen, ui.constructorOpen, busy, backSection, suspended]);
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
      await api.setDeleted(kind, id, true, kind === 'record' && selected?.id === id ? selected.hlc : undefined);
      setUndo({ kind, id });
      if (kind === 'library') ui.home();
      if (kind === 'collection' && ui.libraryId) ui.select(ui.libraryId);
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
  async function createRelated(fieldId: string) {
    if (!selected || busy) return;
    editorOrigin.current = { id: selected.id, top: window.scrollY };
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
        context: { collection: target, fields: targetFields, layouts: { form, card, list }, unmappedAttachments: [] },
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
  function toggleConstructor() {
    if (disabled) return;
    if (!ui.constructorOpen && selected) { setSelected(null); setContext(null); setTrail([]); }
    useUi.setState({ constructorOpen: !ui.constructorOpen, navOpen: false });
  }
  const fieldsReady = fields.length > 0 && fields[0]?.collection_id === collection?.id;
  const title =
    ui.editor === 'named-cards' ? t('namedCards') : ui.editor === 'settings' ? t('globalSettings') : ui.editor === 'mail-sync' ? t('mailSyncTitle') : ui.editor === 'file-settings' ? t('fileSettings') : ui.editor === 'diagnostics' ? t('diagnosticsTitle') : ui.editor === 'large-attachments' ? t('largeAttachmentsTitle') : ui.editor === 'library-summary' ? t('librarySummary') : ui.editor === 'trash' ? t('trash') : ui.editor === 'history' ? t('recordHistory') : ui.editor === 'history-clear' ? t('clearAllHistory') : ui.editor === 'appearance' ? t('deviceAppearance') : ui.editor === 'library-start' ? t('libraryStart') : ui.editor === 'presets' ? t('creationPresets') : ui.editor === 'profiles' ? t('displayProfiles') : ui.editor === 'library'
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
  if (androidDeviceLock() && ui.libraryId && ui.scope !== 'all' &&
      (libraryGate?.id !== ui.libraryId || (libraryGate.required && !libraryGate.approved))) {
    return <main className="startup" role="region" aria-label={t('libraryLocked')}>
      <h1>{t('libraryLocked')}</h1>
      {gateError && <ErrorMessage code={gateError} />}
      {libraryGate?.id === ui.libraryId && libraryGate.required && <button type="button" disabled={gateWorking} onClick={() => { void unlockLibrary(); }}>{t('unlockLibrary')}</button>}
      <button type="button" disabled={gateWorking} onClick={goHome}>{t('backToLibraries')}</button>
    </main>;
  }
  return (
    <div className={'app hybrid-shell tessera-v4' + (ui.navOpen ? ' nav-open' : '') + (ui.editor ? ' editor-open' : '') + (selected ? ' record-open' : '')} data-workspace={ui.editor ? 'editor' : selected ? 'record' : ui.constructorOpen ? 'constructor' : ui.screen}>
      <aside className="sidebar">
        <button className="sidebar-close" onClick={() => useUi.setState({ navOpen: false })}>{t('closeNavigation')}</button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="libraries" /></span>
          <div>
            <b>{t('brand')}</b>
            <small>{t('tagline')}</small>
          </div>
        </div>
        <div className="hybrid-nav-global">
          <button className={ui.screen === 'libraries' ? 'active' : ''} aria-label={t('hybridSidebarLibraries')} disabled={disabled} onClick={goHome} aria-current={ui.screen === 'libraries' ? 'page' : undefined}><Icon name="libraries" />{t('allLibraries')}</button>
          <button disabled={disabled} className={collection?.system_kind === 'inbox' ? 'active' : ''} aria-current={collection?.system_kind === 'inbox' ? 'page' : undefined} onClick={() => showInbox()}><Icon name="inbox" />{t('inbox')}</button>
        </div>
        <div className="nav-heading">{t('libraries')}</div>
        <nav aria-label={t('libraries')}>
          {libraries.map((l) => {
            const a = JSON.parse(l.config) as { icon?: string; color?: string };
            return (
              <div className="library" key={l.id}>
                <button
                  className={l.id === ui.libraryId ? 'active library-button' : 'library-button'}
                  aria-current={l.id === ui.libraryId && !ui.collectionId ? 'page' : undefined}
                  disabled={disabled}
                  title={l.name}
                  onClick={() => { void openLibrary(l.id); }}
                >
                  <span className="nav-item-icon" aria-hidden="true" style={{ backgroundColor: a.color ? `color-mix(in srgb, ${a.color} 20%, var(--panel))` : undefined }}>
                    {a.icon && a.icon !== '◇' ? a.icon : <Icon name="collection" />}
                  </span>
                  <span className="nav-name">{l.name}</span>
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
                            title={c.name}
                            disabled={disabled}
                            className={c.id === ui.collectionId ? 'active' : ''}
                            aria-current={c.id === ui.collectionId ? 'page' : undefined}
                            onClick={() => {
                              rememberBrowse(); clearRecordContext();
                              ui.select(l.id, c.id);
                              setSaved(false);
                            }}
                          >
                            <span className="nav-item-icon" aria-hidden="true" style={{ backgroundColor: appearance.color ? `color-mix(in srgb, ${appearance.color} 20%, var(--panel))` : undefined }}>
                              {appearance.icon && appearance.icon !== '◇' ? appearance.icon : <Icon name="libraries" />}
                            </span>
                            <span className="nav-name">{c.name}</span>
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
          <button type="button" className="hybrid-sidebar-settings tessera-constructor-link" disabled={disabled} aria-pressed={ui.constructorOpen} onClick={toggleConstructor}><Icon name="tools" />{ui.constructorOpen ? t('finishConstructor') : t('constructor')}</button>
          <div className="hybrid-local-status"><span className="local-dot" aria-hidden="true" />{t('local')}</div>
          <small>{t('offline')}</small>
          <button type="button" className="hybrid-sidebar-settings" aria-label={t('hybridSidebarSettings')} disabled={disabled} onClick={() => open('settings')}><Icon name="settings" />{t('globalSettings')}</button>
        </footer>
      </aside>
      <main className="hybrid-main">
        <div className="topbar" role="group" aria-label={t('globalNavigation')}>
          <span className="tessera-mobile-brand" aria-hidden="true"><span className="tessera-mobile-mark"><Icon name="libraries" /></span>{t('brand')}</span>
          <div className="topbar-navigation">
          <button
            className="nav-toggle icon-button"
            title={t('navigation')}
            aria-expanded={ui.navOpen}
            disabled={disabled}
            onClick={ui.toggleNav}
          >
            <Icon name="menu" /><span className="visually-hidden">{t('navigation')}</span>
          </button>
          <button className="icon-button tessera-home-button" title={t('allLibraries')} disabled={disabled} onClick={goHome}><Icon name="libraries" /><span className="visually-hidden">{t('allLibraries')}</span></button>
          
          <button className="icon-button tessera-secondary-nav" title={t('openInbox')} disabled={disabled} onClick={() => showInbox()}><Icon name="inbox" /><span className="visually-hidden">{t('openInbox')}</span></button>
          <button className="icon-button capture-button tessera-secondary-nav" title={'+ ' + t('captureInbox')} disabled={disabled} onClick={() => showInbox(true)}><Icon name="capture" /><span className="visually-hidden">+ {t('captureInbox')}</span></button>
          </div>
          <div className="hybrid-topbar-context" aria-live="off">
            <span className="hybrid-topbar-trail">{library?.name ?? t('libraries')}</span>
            {collection && !collection.system_kind && <><span className="hybrid-topbar-separator" aria-hidden="true">/</span><strong>{collection.name}</strong></>}
          </div>
          <div className="topbar-tools">
          <button className="icon-button" title={t('globalSearch')} disabled={disabled} onClick={() => openGlobalSearch()}><Icon name="search" /><span className="visually-hidden">{t('globalSearch')}</span></button>
          <button className="icon-button tessera-overflow-tool" title={t('trash')} disabled={disabled} onClick={() => { void run(async () => { await api.cleanTrash(); open('trash'); }, false); }}><Icon name="trash" /><span className="visually-hidden">{t('trash')}</span></button>
          <button className="icon-button tessera-overflow-tool tessera-builder-button" title={t('constructor')} id="constructor-toggle" aria-pressed={ui.constructorOpen} disabled={disabled} onClick={toggleConstructor}><Icon name="tools" /><span className="visually-hidden">{t('constructor')}</span></button>
          {openArchive && <button className="icon-button tessera-overflow-tool" title={t('databaseArchive')} disabled={disabled} data-testid="database-archive-open" onClick={openArchive}><Icon name="archive"/><span className="visually-hidden">{t('databaseArchive')}</span></button>}
          {androidDeviceLock() && ui.libraryId && ui.scope !== 'all' && <button type="button" disabled={disabled || gateWorking} onClick={() => { void toggleLibraryLock(); }}>{libraryGate?.required ? t('disableLibraryLock') : t('enableLibraryLock')}</button>}
          <button className="icon-button tessera-overflow-tool tessera-appearance-button" title={t('deviceAppearance')} disabled={disabled || !appearanceReady} onClick={() => open('appearance')}><Icon name="appearance" /><span className="visually-hidden">{t('deviceAppearance')}</span></button>
          <button className="icon-button tessera-overflow-tool tessera-settings-button" title={t('globalSettings')} aria-label={t('globalSettings')} disabled={disabled} onClick={() => open('settings')}><Icon name="settings" /></button>
          <label className="language tessera-overflow-tool">
            <span className="visually-hidden">{t('language')}</span>
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
        </div>
        {fileCleanupPending > 0 && !ui.editor && <div role="status" className="error"><p>{t('attachmentCleanupHint')}</p><button disabled={busy} onClick={() => { void run(async () => {}, false); }}>{t('retryAttachmentCleanup')}</button></div>}
        {error && !ui.editor && <ErrorMessage code={error} />}
        {launchTarget && ui.editor && <p role="status">{t('libraryLaunchPending')}</p>}
        {shortcutRequested && !ui.editor && <p role="status">{t('libraryShortcutRequested')}</p>}
        {saved && !ui.editor && (
          <div role="status" className="saved">
            {t('saved')}
          </div>
        )}
        {undo && !ui.editor && (
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
        <section className={'browse-screen hybrid-browse' + (ui.editor || selected ? ' screen-inactive' : '')} inert={!!ui.editor || !!selected} aria-hidden={!!ui.editor || !!selected}>
        <header>
          <div className="browse-heading-title">
            {ui.screen !== 'libraries' && <span className="hybrid-eyebrow">{ui.screen === 'summary' ? t('librarySummary') : ui.screen === 'library' ? t('libraries') : t('collections')}</span>}
            {ui.screen !== 'libraries' && <button className="section-back" disabled={disabled} onClick={backSection} aria-label={t(ui.searchOrigin ? 'backScreen' : ui.screen === 'records' && library && !collection?.system_kind ? 'backToCollections' : 'backToLibraries')}>← {t(ui.searchOrigin ? 'backScreen' : ui.screen === 'records' && library && !collection?.system_kind ? 'backToCollections' : 'backToLibraries')}</button>}
            <small>{library?.name ?? t('brand')}</small>
            <h1>
              {ui.constructorOpen ? t('constructor') : ui.screen === 'libraries' ? t('libraries') : ui.screen === 'summary' ? t('librarySummary') : ui.screen === 'library' ? library?.name ?? t('collections') : ui.scope === 'all'
                ? (recentMode ? t('recentRecords') : t('allEntries'))
                : ui.scope === 'library'
                  ? library?.name
                  : (collection?.system_kind === 'inbox' ? t('inbox') : collection?.name ?? t('brand'))}
            </h1>
            {ui.screen === 'libraries' && !ui.constructorOpen && <span className="tessera-library-count" aria-label={String(libraries.length)}>{libraries.length}</span>}
          </div>
          {(ui.screen === 'libraries' || ui.screen === 'library') && <button className="primary catalog-create" disabled={disabled} aria-label={t(ui.screen === 'libraries' ? 'createLibrary' : 'createCollection')} onClick={() => open(ui.screen === 'libraries' ? 'library' : 'collection')}>
            + {t(ui.screen === 'libraries' ? 'newLibrary' : 'newCollection')}
          </button>}
          {browsing && ui.scope === 'collection' && collection && !collection.system_kind && (
            <CreateButton disabled={disabled || !fieldsReady} create={beginCreate} registerMenuClose={registerCreationMenuClose} options={[
              { label: t('standardForm'), choice: { kind: 'standard' } }, { label: t('quickEntry'), choice: { kind: 'quick' } },
              ...presets.filter(preset => preset.collection_id === collection.id).map(preset => ({ label: preset.name, choice: { kind: 'preset' as const, preset_id: preset.id } })),
            ]} />
          )}
          {browsing && collection && !collection.system_kind && <div className="profile-switcher">
            {profiles.some(profile => profile.collection_id === collection.id) && <label>{t('displayProfile')}
              <select disabled={disabled || ui.scope !== 'collection'} value={activeProfileId ?? ''} onChange={event => useUi.setState({ profileId: event.target.value })}>
                {profiles.filter(profile => profile.collection_id === collection.id).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>}
            {ui.constructorOpen && <button disabled={disabled || !fieldsReady} onClick={() => open('profiles')}>{t('displayProfiles')}</button>}
            <button disabled={disabled || !fieldsReady} onClick={() => open('csv')}>{t('csv')}</button>
          </div>}
        </header>
        {ui.constructorOpen && <section className="constructor-banner" aria-label={t('constructor')}>
          <div><h2>{t('constructor')}</h2><p>{t(collection && !collection.system_kind ? 'constructorCollectionHint' : 'constructorChooseHint')}</p></div>
          <button disabled={disabled} onClick={toggleConstructor}>{t('finishConstructor')}</button>
        </section>}
        <div className="toolbar">

          {ui.constructorOpen && library && !library.system_kind && (
            <><button disabled={disabled} onClick={() => open('library', library.id)}>
              {t('editLibrary')}
            </button><button disabled={disabled} onClick={() => open('library-start')}>{t('libraryStart')}</button><button disabled={disabled} onClick={() => open('library-summary')}>{t('librarySummary')}</button>
              {shortcutAvailable && <button disabled={disabled} onClick={() => { void requestShortcut(); }}>{t('pinLibraryShortcut')}</button>}</>
          )}
          {collection && !collection.system_kind && (
            <>
              {ui.constructorOpen && <>
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
              <button disabled={disabled || !fieldsReady} onClick={() => open('named-cards')}>{t('namedCards')}</button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('quick')}>{t('layouts.quick')}</button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('presets')}>{t('creationPresets')}</button>
              <button disabled={disabled || !fieldsReady} onClick={() => open('quick-entry')}>+ {t('quickEntry')}</button>
              </>}
            </>
          )}
        </div>
        {ui.constructorOpen && <ConstructorOverview
          library={library} collection={collection} libraries={libraries} collections={collections}
          fields={fields} entries={page.items} busy={disabled}
          openLibrary={id => { void openLibrary(id, true); }}
          openCollection={id => { if (library) { rememberBrowse(); clearRecordContext(); ui.select(library.id, id); } }}
        />}
        {browsing && (
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
        <div className="tessera-data-workspace" hidden={ui.constructorOpen} inert={ui.constructorOpen}>
        {activeDateSelection && <p className="screen-hint" role="status">
          {t('dateSelection.active', { field: fields.find(field => field.id === activeDateSelection.field_id)?.name ?? '', period: t(`dateSelection.${activeDateSelection.period}`) })}
          {activeDateRange?.period === 'range' && ` · ${activeDateRange.start}${activeDateRange.start === activeDateRange.end ? '' : ` — ${activeDateRange.end}`}`}
        </p>}
        {ui.screen === 'libraries' ? (
          <Catalog kind="libraries" items={libraries} layout={appearance.libraries_layout} metadata={libraryMeta} busy={disabled} open={id => { void openLibrary(id, true); }} />
        ) : ui.screen === 'summary' && library ? (
          <LibrarySummaryView widgets={summaryWidgets} states={widgetStates} busy={disabled}
            open={id => { void selectEntry(id); }}
            openCollection={widget => { clearRecordContext(); ui.select(library.id, widget.collection_id, widget.profile_id); }}
            create={widget => { void createFromWidget(widget); }}
            quick={async (entry, fieldId, mutation) => { await run(async () => { await api.quickAction(entry.id, fieldId, mutation, entry.hlc); }, false); }}
            month={(widget, value) => setSummaryMonths(old => ({ ...old, [widget.id]: value }))}
            day={(widget, date) => { clearRecordContext(); ui.select(library.id, widget.collection_id, widget.profile_id); setDrilldown({ scope: widget.collection_id, field: widget.kind === 'calendar' ? widget.calendar_field : '', value: date, date }); }} />
        ) : ui.screen === 'library' && library ? (
          <><button type="button" disabled={disabled} onClick={() => { clearRecordContext(); ui.selectSummary(library.id); }}>{t('librarySummary')}</button><Catalog kind="collections" items={collections.filter(row => row.library_id === library.id)} layout={libraryNavigation(library).collections_layout}
            busy={disabled} open={id => { rememberBrowse(); clearRecordContext(); ui.select(library.id, id); }} /></>
        ) : !browsing ? (
          <div className="empty">
            <h2>{t('chooseCollection')}</h2>
            <p>{t('chooseCollectionHint')}</p>
          </div>
        ) : (
          <>
            {activeDrilldown && <button type="button" disabled={disabled} onClick={() => setDrilldown(null)}>{t('backToView')}</button>}
            {ui.scope === 'collection' && !!totalMeasures.length && <QueryTotals measures={totalMeasures} values={totals} fields={fields} loading={totalsLoading} error={totalsError} />}
            {specialMode && viewMode === 'kanban' ? <KanbanBoard
              columns={projection?.mode === 'kanban' ? projection.columns : []} busy={disabled} loading={projectionLoading} error={projectionError}
              open={id => { void selectEntry(id); }}
              move={(entry,value) => { if (viewField) void run(async () => { await api.saveEntry(entry.collection_id, { [viewField]: value }, entry.id, entry.hlc); }, false); }}
              showColumn={column => { if (viewField) setDrilldown({ scope: drillScope, field: viewField, value: column.value }); }}
            /> : null}
            {specialMode && viewMode === 'calendar' && <CalendarView month={calendarMonth} days={projection?.mode === 'calendar' ? projection.days : []} loading={projectionLoading} error={projectionError} busy={disabled} changeMonth={setCalendarMonth}
              openEntry={id => { void selectEntry(id); }} openDay={date => { if (viewField) setDrilldown({ scope: drillScope, field: viewField, value: date, date }); }} />}
            {specialMode && viewMode === 'tree' && <TreeView rows={projection?.mode === 'tree' ? projection.rows : []} busy={disabled} loading={projectionLoading} error={projectionError} open={id => { void selectEntry(id); }} />}
            {!specialMode && <>
            {!queryFailure && <div className="list-meta" aria-live="polite">
              {readingEntries ? t('loadingEntries') : t('entryCount', { count: page.items.length })}
            </div>}
            {queryFailure ? <div className="error" role="alert">
              <strong>{t('entriesUnavailable')}</strong>
              <p>{queryFailure === 'generic' ? t('entriesUnavailableHint') : t(`errors.${queryFailure}`, { defaultValue: t('entriesUnavailableHint') })}</p>
              <button disabled={disabled || loading} onClick={() => refresh(value => value + 1)}>{t('retryEntries')}</button>
            </div> : !page.items.length ? readingEntries ? null : (
              <div className="empty">
                <h2>
                  {t(ui.search || layouts.list.list?.filters?.length || layouts.list.list?.date_selection ? 'noResults' : 'emptyCollection')}
                </h2>
                <p>{t(ui.search || layouts.list.list?.filters?.length || layouts.list.list?.date_selection ? 'noResultsHint' : 'emptyCollectionHint')}</p>
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
                <div className="entry-scroll" ref={scroll} aria-busy={loading || !rowsReady}>
                  <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                    {virtual.getVirtualItems().map((v) => {
                      const row = page.items[v.index]!,
                        collectionMode = ui.scope === 'collection' && !collection?.system_kind;
                      const actions = collectionMode ? layouts.list.quick_actions : undefined;
                      const withActions = actions?.some(action => fields.some(field => field.id === action.field_id)) === true;
                      const content = (
                        <button
                          key={row.id}
                          data-index={v.index}
                          data-entry-id={row.id}
                          ref={withActions ? undefined : virtual.measureElement}
                          className={
                            'entry ' +
                            (collectionMode ? (layouts.list.list?.mode ?? 'rows') : 'rows') +
                            (selected?.id === row.id ? ' active' : '')
                          }
                          style={{ minHeight: rowHeight, ...(!withActions ? { transform: `translateY(${v.start}px)` } : {}) }}
                          disabled={disabled || !rowsReady}
                          onClick={() => {
                            void selectEntry(row.id);
                          }}
                        >
                          {collectionMode && fields.find(field => field.type === 'image' && fileIds(row.data[field.id]).length > 0) && <AttachmentThumbnail api={api} id={fileIds(row.data[fields.find(field => field.type === 'image' && fileIds(row.data[field.id]).length > 0)!.id])[0]!} ownerId={row.id} />}
                          {collectionMode && groupField && (
                            <small className="list-group">
                              {groupField.name}: {isCalculated(groupField.type) ? <CalculatedValue field={groupField} value={row.computed?.[groupField.id]} /> : format(groupField, row.data[groupField.id])}
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
                                  <span key={f.id} className={(item.width === 'half' ? 'half' : 'full') + (f.id === collection?.primary_field_id ? ' entry-primary' : '') + (['select', 'multiselect'].includes(f.type) ? ' tessera-select-field' : '')}>
                                    {item.group && <small>{item.group} · </small>}
                                    <small className="entry-field-label">{f.name}: </small>
                                    {isCalculated(f.type) ? <CalculatedValue field={f} value={row.computed?.[f.id]} /> : ['relation', 'backlink'].includes(f.type)
                                      ? formatRelations(row, f.id)
                                      : format(f, row.data[f.id])}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="entry-summary">
                              <strong>{(row.collection_system_kind === 'inbox' ? splitInboxMarkdown(row.title).title : row.title) || t('unset')}</strong>
                              <small>{row.collection_system_kind === 'inbox' ? t('inbox') : row.collection_name}</small>
                            </span>
                          )}
                          <small className="entry-date">
                            {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                              new Date(row.updated_at)
                            )}
                          </small>
                        </button>
                      );
                      return withActions ? <div key={row.id} data-index={v.index} className="entry-shell" ref={virtual.measureElement} style={{ transform: `translateY(${v.start}px)` }}>
                        {content}<QuickActions entry={row} fields={fields} actions={actions} busy={disabled || !rowsReady} execute={(fieldId, mutation) => run(async () => { await api.quickAction(row.id, fieldId, mutation, row.hlc); }, false)} />
                      </div> : content;
                    })}
                  </div>
                </div>
              </>
            )}
            {!queryFailure && page.next && (
              <button
                disabled={disabled || readingEntries}
                onClick={() => {
                  void more();
                }}
              >
                {t('loadMore')}
              </button>
            )}
            </>}
          </>
        )}
        </div>
        </section>
        {selected && context && !ui.editor && (
          <section className="detail hybrid-record-detail" role="region" aria-labelledby="record-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); backRecord(); } }}>
            <div className="tessera-record-topline">
              <button className="icon-button tessera-record-back" title={t('backToEntries')} aria-label={t('backToEntries')} disabled={busy} onClick={() => { selectionRequest.current++; setSelected(null); setContext(null); setTrail([]); }}>
                <Icon name="back" /><span className="visually-hidden">{t('backToEntries')}</span>
              </button>
              <span className="tessera-record-location">{context.collection.name}</span>
              <div className="tessera-record-utilities">
                <button className="icon-button" aria-label={t('globalSearch')} title={t('globalSearch')} disabled={disabled} onClick={() => openGlobalSearch()}><Icon name="search" /></button>
                <button className="icon-button" aria-label={t('globalSettings')} title={t('globalSettings')} disabled={disabled} onClick={() => open('settings')}><Icon name="settings" /></button>
              </div>
            </div>
            {context.fields.find(field => field.type === 'image' && fileIds(selected.data[field.id]).length > 0) && <RecordCover api={api} ownerId={selected.id} id={fileIds(selected.data[context.fields.find(field => field.type === 'image' && fileIds(selected.data[field.id]).length > 0)!.id])[0]!} />}
            <header className="dialog-heading">
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
                <h1 id="record-title" ref={cardHeading} tabIndex={-1}>{context.collection.system_kind === 'inbox' ? splitInboxMarkdown(String(selected.data[context.collection.primary_field_id] ?? '')).title : String(selected.data[context.collection.primary_field_id] ?? '')}</h1>
                <p className="hybrid-record-meta">{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(selected.updated_at))}</p>
              </div>
            </header>
            <LayoutRowsView definition={resolveCardLayout(context.layouts.card,
              ui.scope === 'collection' && trail.length === 0 && collection?.id === context.collection.id && selected.collection_id === context.collection.id
                ? (profiles.find(profile => profile.id === activeProfileId) ? (JSON.parse(profiles.find(profile => profile.id === activeProfileId)!.config) as UiDefinition).detail_layout_id : undefined)
                : undefined)} fields={context.fields} label={field => context.collection.system_kind === 'inbox' ? t(field.id === context.collection.incoming_field_id ? 'inboxContent' : 'attachments') : field.name} render={item => {
                  const f = context.fields.find((field) => field.id === item.field_id)!;
                  return (
                    <dl key={f.id}>
                      <dt>{context.collection.system_kind === 'inbox' ? t(f.id === context.collection.incoming_field_id ? 'inboxContent' : 'attachments') : f.name}</dt>
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
                        ) : isFile(f.type) ? <AttachmentList compact api={api} ownerId={selected.id} ids={fileIds(selected.data[f.id])} busy={busy} /> : (f.type === 'markdown' || context.collection.system_kind === 'inbox') && typeof selected.data[f.id] === 'string' && selected.data[f.id] !== '' ? (
                          <MarkdownView key={selected.id + f.id} source={String(selected.data[f.id])} />
                        ) : isCalculated(f.type) ? <CalculatedValue field={f} value={selected.computed?.[f.id]} /> : f.type === 'secret' ? <SecretValue key={selected.id + f.id} value={selected.data[f.id]} /> : f.type === 'boolean' ? <span className="tessera-readonly-boolean"><input type="checkbox" checked={selected.data[f.id] === true} readOnly disabled aria-label={f.name} /><span>{format(f, selected.data[f.id])}</span></span> : ['select', 'multiselect'].includes(f.type) ? <span className="tessera-select-value">{format(f, selected.data[f.id])}</span> : format(f, selected.data[f.id])}
                      </dd>
                    </dl>
                  );
                }} />
            <QuickActions entry={selected} fields={context.fields} actions={context.layouts.card.quick_actions} busy={busy} execute={(fieldId, mutation) => run(async () => { await api.quickAction(selected.id, fieldId, mutation, selected.hlc); }, false)} />
            {context.fields.find(field => field.id === context.collection.primary_field_id)?.type !== 'secret' && <ExternalCalendarActions entry={selected} fields={context.fields} title={String(selected.data[context.collection.primary_field_id] ?? context.collection.name)} busy={busy} />}
            {context.inboxOriginal != null && <details><summary>{t('inboxOriginal')}</summary><pre className="original-content">{context.inboxOriginal}</pre></details>}
            {!!context.unmappedAttachments.length && <section aria-label={t('retainedAttachments')}><h2>{t('retainedAttachments')}</h2><AttachmentList compact api={api} ownerId={selected.id} ids={context.unmappedAttachments} busy={busy} /></section>}
            <div className="actions">
              {context.collection.system_kind === 'inbox' && <button disabled={busy} onClick={() => open('move', selected.id)}>{t('moveFromInbox')}</button>}
              <button className="tessera-record-edit" disabled={busy} onClick={() => open('entry', selected.id)}><Icon name="edit" />
                {t('edit')}
              </button>
              <button className="tessera-record-secondary tessera-history-button" aria-label={t('recordHistory')} disabled={busy} onClick={() => open('history', selected.id)}><Icon name="clock" /><span>{t('recordHistory')}</span></button>
              <button className="danger tessera-record-secondary" disabled={busy} onClick={() => remove('record', selected.id)}>
                {t('delete')}
              </button>
            </div>
          </section>
        )}
      {ui.editor && (
        <EditorPage title={title} close={close} busy={busy}>
          {error && <ErrorMessage code={error} />}
          {draftRecoveryPath && !ui.editingId && (ui.editor === 'entry' || ui.editor === 'quick-entry') && <p role="status" data-draft-recovery={draftRecoveryPath}>{t('draftRecovered')}</p>}
          {ui.editor === 'settings' && <section className="global-settings hybrid-settings-hub" aria-label={t('globalSettings')}>
            <p className="screen-hint">{t('globalSettingsHint')}</p>
            <section className="hybrid-settings-group">
              <h2>{t('hybridSettingsSync')}</h2>
              <p>{t('hybridSettingsSyncHint')}</p>
              <div className="global-settings-links">
                {nativeMailSyncSupported() && <button className="hybrid-settings-feature" disabled={busy} onClick={() => open('mail-sync')}>
                  <Icon name="inbox" /><span><strong>{t('mailSyncTitle')}</strong><small>{t('hybridSettingsSyncDescription')}</small></span><Icon name="arrow" />
                </button>}
                {!nativeMailSyncSupported() && <p className="screen-hint">{t('hybridSettingsNativeOnly')}</p>}
              </div>
            </section>
            <section className="hybrid-settings-group">
              <h2>{t('hybridSettingsAppearance')}</h2>
              <div className="global-settings-links">
                <button disabled={busy || !appearanceReady} onClick={() => open('appearance')}><Icon name="appearance" /><span>{t('deviceAppearance')}</span><Icon name="arrow" /></button>
              </div>
              <label className="hybrid-settings-language">{t('language')}
                <select value={i18n.language} onChange={event => { void i18n.changeLanguage(event.target.value); }}>
                  <option value="ru">{t('languageRussian')}</option><option value="en">{t('languageEnglish')}</option>
                </select>
              </label>
            </section>
            <section className="hybrid-settings-group">
              <h2>{t('hybridSettingsStorage')}</h2>
              <div className="global-settings-links">
                {openArchive && <button disabled={busy} onClick={openArchive}><Icon name="archive" /><span>{t('databaseArchive')}</span><Icon name="arrow" /></button>}
                <button disabled={busy} onClick={() => open('file-settings')}><Icon name="archive" /><span>{t('fileSettings')}</span><Icon name="arrow" /></button>
                <button disabled={busy} onClick={() => open('large-attachments')}><Icon name="archive" /><span>{t('largeAttachmentsTitle')}</span><Icon name="arrow" /></button>
                <button disabled={busy} onClick={() => { void run(async () => { await api.cleanTrash(); open('trash'); }, false); }}><Icon name="trash" /><span>{t('trash')}</span><Icon name="arrow" /></button>
                <button disabled={busy} onClick={() => open('diagnostics')}><Icon name="tools" /><span>{t('diagnosticsTitle')}</span><Icon name="arrow" /></button>
                <button disabled={busy} onClick={() => open('history-clear')}><Icon name="clock" /><span>{t('clearAllHistory')}</span><Icon name="arrow" /></button>
              </div>
            </section>
          </section>}
          {ui.editor === 'mail-sync' && <AndroidMailSyncSettings api={api} cancel={close} />}
          {ui.editor === 'diagnostics' && <DiagnosticsPanel api={api} busy={busy} />}
          {ui.editor === 'large-attachments' && <LargeAttachments api={api} busy={busy} />}
          {ui.editor === 'file-settings' && <AttachmentSettings api={api} busy={busy} cancel={close} save={bytes => { void run(() => api.saveAttachmentLimit(bytes)); }} />}
          {ui.editor === 'trash' && <Trash api={api} busy={busy} revision={revision}
            restore={item => { void run(async () => { await api.setDeleted('record', item.id, false, item.hlc); setUndo(null); }, false); }}
            purge={item => { void run(async () => { await api.purgeEntry(item.id, item.hlc); setUndo(null); }, false); }}
            saveRetention={days => { void run(async () => { await api.saveTrashRetention(days); await api.cleanTrash(); setUndo(null); }, false); }} />}
          {ui.editor === 'history' && selected && <RecordHistory key={selected.id + ':' + revision} api={api} entry={selected} busy={busy}
            refresh={() => { void run(async () => {}, false); }}
            restore={versionId => { void run(async () => { await api.restoreEntryVersion(selected.id, versionId, selected.hlc); setSaved(true); }); }}
            clear={() => { void run(async () => { await api.clearHistory(selected.id); }, false); }} />}
          {ui.editor === 'history-clear' && <div><p>{t('clearAllHistoryHint')}</p><p>{t('clearHistoryHint')}</p>
            <div className="form-actions"><button disabled={busy} onClick={close}>{t('cancel')}</button>
              <button className="danger" disabled={busy} onClick={() => { void run(async () => { await api.clearHistory(); }); }}>{t('confirmClearHistory')}</button></div></div>}
          {ui.editor === 'appearance' && <DeviceAppearanceEditor value={appearance} busy={busy} cancel={close} save={value => { void run(async () => { setAppearance(await api.saveDeviceAppearance(value)); }); }} />}
          {ui.editor === 'library-summary' && library && <LibrarySummaryEditor api={api} libraryId={library.id} busy={busy} cancel={close}
            save={value => { void run(async () => { await api.saveLibrarySummary(library.id, value); }); }} />}
          {ui.editor === 'library-start' && library && <LibraryStartEditor api={api} libraryId={library.id} busy={busy} cancel={close}
            save={value => { void run(async () => { await api.saveLibraryNavigation(library.id, value); }); }} />}
          {ui.editor === 'move' && selected && <InboxMoveForm registerFileClose={registerFileClose} api={api} entry={selected} libraries={libraries} busy={busy} cancel={close}
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
                      useUi.setState({ navOpen: true });
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
            <DraftRecordForm registerFileClose={registerFileClose}
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
            <RecordForm registerFileClose={registerFileClose} key={selected.id + ':' + selected.hlc} api={api} collection={context.collection} fields={context.fields}
              layout={context.layouts.form} entry={selected} busy={busy} cancel={close}
              change={data => setStaleEdit(old => old ? { ...old, data } : null)} save={data => saveEdited(data)} />
          </>}
          {ui.editor === 'quick-entry' && collection && fieldsReady && <DraftRecordForm registerFileClose={registerFileClose} key={'quick:' + collection.id} api={api} collection={collection} store={drafts} initialData={creationInitial}
            action={{ kind: 'save', create_id: crypto.randomUUID() }} registerClose={registerCreationClose} warn={warnDraftCleanup}
            fields={fields}
            layout={quickLayout(layouts.form, quickDefinition, fields)}
            busy={busy} cancel={close} save={(data, action, complete) => { void run(async () => {
              if (action.kind === 'save') await api.saveQuickEntry(collection.id, data, action.create_id);
              else await saveDraftAction(action, collection.id, data);
              await complete(); setSaved(true);
            }); }} />}
          {ui.editor === 'quick' && collection && <><p>{t('quickFormHint')}</p><LayoutEditor api={api} kind="card" onDirtyChange={registerDesignerDirty} allowQuickActions={false} fields={fields.filter(field => field.type !== 'backlink')}
            definition={quickDefinition} busy={busy} cancel={close} save={definition => { void run(() => api.saveQuickForm(collection.id, definition)); }} /></>}
          {ui.editor === 'fields' && collection && (
            <FieldsEditor
              api={api}
              registerPropertiesClose={registerFieldPropertiesClose}
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
            cardLayouts={layouts.card.named_cards ?? []}
            busy={busy} cancel={close} create={name => { void run(async () => {
              const profile = await api.createDisplayProfile(collection.id, name, layouts.list);
              useUi.setState({ profileId: profile.id });
            }); }}
            update={(id, patch) => { void run(async () => {
              const current = profiles.find(profile => profile.id === id);
              if (!current) return;
              const base = JSON.parse(current.config) as UiDefinition;
              delete base.detail_layout_id;
              await api.updateDisplayProfile(id, {
                name: patch.name, position: patch.position, make_default: patch.make_default,
                definition: patch.detail_layout_id ? { ...base, detail_layout_id: patch.detail_layout_id } : base,
              });
            }, false); }}
            remove={id => { void run(async () => { await api.deleteDisplayProfile(id); useUi.setState({ profileId: null }); }, false); }} />}
          {ui.editor === 'named-cards' && collection && <NamedCardLayoutsEditor api={api} key={collection.id} fields={fields}
            definition={layouts.card} busy={busy} cancel={close}
            save={definition => { void run(() => api.saveUiConfig(collection.id, 'card', definition)); }} />}
          {(ui.editor === 'form' || ui.editor === 'card' || ui.editor === 'list') && collection && (
            <LayoutEditor
              api={api}
              key={ui.editor}
              onDirtyChange={registerDesignerDirty}
              kind={ui.editor}
              fields={ui.editor === 'list' ? fields.filter(field => field.type !== 'secret') : fields}
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
        </EditorPage>
      )}
        {!ui.editor && !selected && ui.screen === 'libraries' && <nav className="tessera-bottom-nav" aria-label={t('globalNavigation')}>
          <button aria-current="page" disabled={disabled} onClick={goHome}><Icon name="libraries" /><span>{t('libraries')}</span></button>
          <button disabled={disabled} onClick={() => openGlobalSearch(true)}><Icon name="clock" /><span>{t('recentRecords')}</span></button>
          <button disabled={disabled} onClick={() => open('settings')}><Icon name="settings" /><span>{t('globalSettings')}</span></button>
        </nav>}
      </main>
    </div>
  );
}
