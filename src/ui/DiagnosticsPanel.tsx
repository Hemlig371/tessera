import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import type { SafeDiagnosticReport } from '../core/diagnostics';
import { serializeDiagnosticReport } from '../core/diagnostics';
import { chooseDiagnosticWriter } from '../platform/csv-files';
import { errorKey } from './common';

export function DiagnosticsPanel({ api, busy }: { api: Repository; busy: boolean }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<SafeDiagnosticReport | null>(null);
  const [running, setRunning] = useState(false), [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setRunning(true); setError(null);
    void api.diagnosticReport().then(result => { if (active) setReport(result); })
      .catch(e => { if (active) setError(errorKey(e)); })
      .finally(() => { if (active) setRunning(false); });
    return () => { active = false; };
  }, [api]);
  async function exportReport() {
    if (!report || running || busy) return;
    setRunning(true); setSaved(false); setError(null);
    try {
      const writer = await chooseDiagnosticWriter();
      if (!writer) return;
      try { await writer.write(serializeDiagnosticReport(report)); await writer.finish(); setSaved(true); }
      catch (e) { await writer.abort().catch(() => undefined); throw e; }
    } catch (e) { setError(errorKey(e)); }
    finally { setRunning(false); }
  }
  return <section aria-label={t('diagnosticsTitle')}>
    <p className="screen-hint">{t('diagnosticsPrivacy')}</p>
    {running && !report && <p role="status">{t('loadingSettings')}</p>}
    {error && <p role="alert">{t('errors.' + error, { defaultValue: t('diagnosticsUnavailable') })}</p>}
    {report && <dl>
      <dt>SQLite</dt><dd>{report.sqlite_version}</dd>
      <dt>{t('diagnosticsSchema')}</dt><dd>{report.app_schema}</dd>
      <dt>{t('diagnosticsIntegrity')}</dt><dd>{report.integrity === 'ok' ? t('diagnosticsOk') : t('diagnosticsCorrupt')}</dd>
      <dt>WAL</dt><dd>{report.journal_mode}</dd>
      <dt>{t('diagnosticsPageCount')}</dt><dd>{report.page_count}</dd>
    </dl>}
    {report && <button type="button" disabled={running || busy} onClick={() => { void exportReport(); }}>{t('diagnosticsExport')}</button>}
    {saved && <p role="status">{t('diagnosticsSaved')}</p>}
  </section>;
}
