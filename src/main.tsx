import { openBinaryFiles } from './platform/binary-files';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
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
  try { await checkSqlite(db); await migrate(db); return { api: await Repository.open(db, openBinaryFiles()), drafts: await openDraftStore() }; }
  catch (e) { await db.close(); throw e; }
}
const boot = bootstrap();
function Root() {
  const { t } = useTranslation();
  const [state, setState] = useState<{ api: Repository; drafts: DraftStore } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void boot.then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : 'generic')); }, []);
  if (error) return <div className="startup"><ErrorMessage code={error}/><button onClick={() => location.reload()}>{t('retry')}</button></div>;
  return state ? <App api={state.api} drafts={state.drafts}/> : <div className="startup" role="status">{t('loading')}</div>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
