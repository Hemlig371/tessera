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

// One bootstrap per WebView, including React re-renders. No browser storage fallback.
async function bootstrap() {
  const db = await openDatabase();
  try { await checkSqlite(db); await migrate(db); return await Repository.open(db); }
  catch (e) { await db.close(); throw e; }
}
const boot = bootstrap();
function Root() {
  const { t } = useTranslation();
  const [api, setApi] = useState<Repository | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void boot.then(setApi).catch((e: unknown) => setError(e instanceof Error ? e.message : 'generic')); }, []);
  if (error) return <div className="startup"><ErrorMessage code={error}/><button onClick={() => location.reload()}>{t('retry')}</button></div>;
  return api ? <App api={api}/> : <div className="startup" role="status">{t('loading')}</div>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
