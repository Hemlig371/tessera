import { DatabaseArchive } from './ui/DatabaseArchive';
import { databaseInitialized } from './core/database-archive';
import type { DatabaseAdapter, BinaryFileAdapter } from './core/ports';
import { openBinaryFiles } from './platform/binary-files';
import { acknowledgeAndroidShare, pendingAndroidShares, sharedFileSource, subscribeAndroidShares } from './platform/external-actions';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ui/i18n';
import './ui/style.css';
import './ui/hybrid-workspace.css';
import './ui/tessera-v4.css';
import { App, ErrorMessage } from './ui/App';
import { openDatabase } from './platform/open';
import { checkSqlite } from './core/sqlite-check';
import { migrate } from './core/migrate';
import { Repository } from './core/repository';
import { openDraftStore } from './platform/local-files';
import type { DraftStore } from './core/drafts';

// One bootstrap per WebView, including React re-renders. No browser storage fallback.
async function bootstrap() {
  const db = await openDatabase();
  try {
    await checkSqlite(db);
    await migrate(db);
    const files = openBinaryFiles();
    const initialized = await databaseInitialized(db);
    // Vite removes this branch and its dynamic import from normal production builds.
    const qa = import.meta.env.MODE === 'qa';
    const api = initialized || qa ? await Repository.open(db, files) : null;
    if (qa && !initialized && api) {
      await (await import('./acceptance/seed')).seedAcceptanceLibraries(api);
    }
    return { db, files, api, drafts: await openDraftStore() };
  }
  catch (e) { await db.close(); throw e; }
}
const boot = bootstrap();
function Root() {
  const { t } = useTranslation();
  const [state, setState] = useState<{ db: DatabaseAdapter; files: BinaryFileAdapter; api: Repository | null; drafts: DraftStore } | null>(null);
  const archiveOrigin = useRef<{ top: number; focus: HTMLElement | null }>({ top: 0, focus: null });
  const [archive, setArchive] = useState(false), [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void boot.then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : 'generic')); }, []);
  // Android Shares bypass the creation form by contract. The incoming UUID is the
  // SQLite record UUID: a crash between Save and native ACK cannot duplicate it.
  useEffect(() => {
    if (!state?.api) return;
    const api = state.api;
    let alive = true, draining = false, again = false;
    const drain = async () => {
      if (draining) { again = true; return; }
      draining = true;
      try {
        do {
          again = false;
          const pending = await pendingAndroidShares();
          if (pending.error) throw new Error(pending.error);
          for (const share of pending.items) {
            const inbox = await api.getInbox();
            const previous = await api.getEntry(share.id);
            if (previous) {
              if (previous.collection_id !== inbox.id) throw new Error('staleRecord');
              await acknowledgeAndroidShare(share.id);
              continue;
            }
            const fileFields = share.files.length ? await api.listFields(inbox.id) : [];
            const attachmentField = fileFields.find(field => field.type === 'file');
            if (share.files.length && !attachmentField) throw new Error('invalidAttachment');
            const ids: string[] = [];
            for (const file of share.files) {
              const staged = await api.stageAttachment(inbox.id, share.id, sharedFileSource(share.id, file));
              ids.push(staged.id);
            }
            const text = share.text.trim() || share.files.map(file => file.name).join('\n');
            await api.saveNewEntry(inbox.id, {
              [inbox.incoming_field_id]: text,
              ...(attachmentField ? { [attachmentField.id]: ids } : {}),
            }, share.id);
            await acknowledgeAndroidShare(share.id);
          }
        } while (again && alive);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'shareUnavailable');
      } finally { draining = false; }
    };
    let remove: (() => void) | undefined;
    void subscribeAndroidShares(() => { void drain(); }).then(stop => {
      if (alive) { remove = stop; void drain(); }
      else stop();
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'shareUnavailable'); });
    return () => { alive = false; remove?.(); };
  }, [state?.api]);
  const openArchive = () => { archiveOrigin.current = { top: window.scrollY, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null }; setArchive(true); };
  const closeArchive = () => { setArchive(false); requestAnimationFrame(() => { archiveOrigin.current.focus?.focus({ preventScroll: true }); window.scrollTo(0, archiveOrigin.current.top); }); };
  if (error) return <div className="startup"><ErrorMessage code={error}/><button onClick={() => location.reload()}>{t('retry')}</button></div>;
  if (!state) return <div className="startup" role="status">{t('loading')}</div>;
  return <>
    {state.api ? <div hidden={archive}><App api={state.api} drafts={state.drafts} suspended={archive} openArchive={openArchive}/></div> : !archive && <main className="startup" data-testid="database-welcome">
      <h1>Tessera</h1><p>{t('databaseWelcome')}</p>
      <button data-testid="database-create" disabled={creating} onClick={() => {
        setCreating(true); void Repository.open(state.db, state.files).then(api => setState({ ...state, api })).catch(e => setError(e instanceof Error ? e.message : 'generic')).finally(() => setCreating(false));
      }}>{t('createDatabase')}</button>
      <button data-testid="database-import" disabled={creating} onClick={openArchive}>{t('importDatabase')}</button>
    </main>}
    {archive && <DatabaseArchive api={state.api} db={state.db} files={state.files} close={closeArchive}/>}
  </>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
