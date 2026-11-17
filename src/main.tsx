import { DatabaseArchive } from './ui/DatabaseArchive';
import { databaseInitialized } from './core/database-archive';
import type { DatabaseAdapter, BinaryFileAdapter } from './core/ports';
import { openBinaryFiles } from './platform/binary-files';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ui/i18n';
import './ui/style.css';
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
  try { await checkSqlite(db); await migrate(db); const files = openBinaryFiles(); return { db, files, api: await databaseInitialized(db) ? await Repository.open(db, files) : null, drafts: await openDraftStore() }; }
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
