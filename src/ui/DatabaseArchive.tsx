import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Repository } from '../core/repository';
import type { BinaryFileAdapter, DatabaseAdapter } from '../core/ports';
import { exportDatabaseArchive, importDatabaseArchive, inspectDatabaseArchive, type ArchiveManifest } from '../core/database-archive';
import { checkDatabaseIntegrity } from '../core/sqlite-check';
import { checkCancelled } from '../core/operations';
import { chooseDatabaseArchiveWriter } from '../platform/csv-files';
import { bindSystemBack } from '../platform/local-files';
import { createDatabaseImportStage, type DatabaseImportStage } from '../platform/database-import';
import { ErrorMessage, errorKey } from './common';
import { fileSource } from './AttachmentList';

export function DatabaseArchive({ api, db, files, close }: {
  api: Repository | null; db: DatabaseAdapter; files: BinaryFileAdapter; close: () => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null), [manifest, setManifest] = useState<ArchiveManifest | null>(null);
  const [independent, setIndependent] = useState(false), [ready, setReady] = useState(false), [replace, setReplace] = useState(false);
  const [phase, setPhase] = useState<'checking' | 'exporting' | 'importing' | 'activating' | null>('checking');
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false), [count, setCount] = useState(0);
  const stage = useRef<DatabaseImportStage | null>(null), controller = useRef<AbortController | null>(null);
  const focus = useRef<HTMLHeadingElement>(null);
  useEffect(() => { focus.current?.focus(); window.scrollTo(0, 0); return () => { controller.current?.abort(); }; }, []);
  useEffect(() => {
    let active = true;
    void (api ? api.collectAttachmentFiles() : Promise.resolve()).catch(e => { if (active) setError(errorKey(e)); }).finally(() => { if (active) setPhase(null); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    const back = () => {
      if (phase) { if (phase !== 'activating') controller.current?.abort(); return; }
      setPhase('checking');
      void (stage.current?.abort() ?? Promise.resolve()).then(() => { stage.current = null; close(); }).catch(e => { setError(errorKey(e)); setPhase(null); });
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); back(); } };
    const stop = bindSystemBack(back, () => setError('fileError'));
    window.addEventListener('keydown', keydown);
    return () => { stop(); window.removeEventListener('keydown', keydown); };
  }, [phase, close]);
  // No background app maintenance runs behind this screen; drain already queued file GC before IO.
  async function idle() { if (api) await api.collectAttachmentFiles(); }
  async function run(next: Exclude<typeof phase, null>, action: (signal: AbortSignal) => Promise<void>) {
    if (phase) return;
    const active = new AbortController(); controller.current = active; setPhase(next); setError(null); setSaved(false); setCount(0);
    try { await action(active.signal); }
    catch (e) { setError(errorKey(e)); }
    finally { controller.current = null; setPhase(null); }
  }
  async function discard() { if (stage.current) { await stage.current.abort(); stage.current = null; } setReady(false); }
  async function exportCurrent(signal: AbortSignal) {
    await idle(); checkCancelled(signal);
    const writer = await chooseDatabaseArchiveWriter(t('exportDatabase')); if (!writer) return;
    const exported = await exportDatabaseArchive(db, files, writer, value => setCount(value), signal);
    setSaved(true);
    if (exported.files.missing) setError('archiveMissingFiles');
  }
  async function selectFile(selected: File) {
    await run('checking', async signal => {
      await discard(); setFile(selected); setManifest(null); setReplace(false);
      const inspected = await inspectDatabaseArchive(fileSource(selected), signal); setManifest(inspected.manifest);
    });
  }
  async function prepare(signal: AbortSignal) {
    if (!file) return;
    await idle(); await discard(); checkCancelled(signal);
    const next = await createDatabaseImportStage(file.size); stage.current = next;
    try {
      const imported = await importDatabaseArchive(fileSource(file), next.db, next.files, independent, value => setCount(value), signal);
      await checkDatabaseIntegrity(next.db, true); checkCancelled(signal); await next.db.close();
      setManifest(imported); setReady(true);
    } catch (error) { await discard(); throw error; }
  }
  async function activate() {
    if (!stage.current || (api && !replace) || phase) return;
    setError(null); setPhase('activating');
    try {
      await idle(); await db.close(); await stage.current.activate(); stage.current = null;
      location.reload();
    } catch (e) {
      // The native journal restores a whole old/new dataset before opening SQLite again.
      setError(errorKey(e));
    }
  }
  const busy = phase !== null;
  return <main className="editor-page database-archive" data-testid="database-archive">
    <header className="editor-page-heading"><h1 ref={focus} tabIndex={-1}>{t('databaseArchive')}</h1>
      <button data-testid="archive-close" disabled={busy} onClick={() => { void run('checking', async () => { await discard(); close(); }); }}>{t('close')}</button></header>
    <p className="warning" data-testid="archive-unencrypted">{t('archiveUnencrypted')}</p>
    {error && <ErrorMessage code={error} />}
    {phase && <p role="status" data-testid="archive-progress">{t('archivePhases.' + phase)} · {count}</p>}
    {saved && <p role="status" data-testid="archive-exported">{t('archiveExported')}</p>}
    {api && <section><h2>{t('exportDatabase')}</h2><p>{t('archiveExportHint')}</p>
      <button data-testid="archive-export" disabled={busy} onClick={() => { void run('exporting', exportCurrent); }}>{t('exportDatabase')}</button></section>}
    <section><h2>{t('importDatabase')}</h2><p>{t('archiveImportHint')}</p>
      <label>{t('chooseDatabaseArchive')}<input data-testid="archive-input" type="file" accept=".zip,application/zip" disabled={busy} onChange={event => {
        const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void selectFile(selected);
      }} /></label>
      {manifest && <dl data-testid="archive-summary"><dt>{t('archiveDate')}</dt><dd>{new Date(manifest.exported_at).toLocaleString()}</dd>
        <dt>{t('archiveRecords')}</dt><dd>{manifest.entities.record}</dd><dt>{t('archiveFiles')}</dt><dd>{manifest.files.included}</dd>
        <dt>{t('archivePlaceholders')}</dt><dd>{manifest.files.large + manifest.files.missing}</dd></dl>}
      <label className="check"><input data-testid="archive-independent" type="checkbox" disabled={busy || ready} checked={independent} onChange={event => setIndependent(event.target.checked)} />{t('archiveIndependent')}</label>
      {!ready && <button data-testid="archive-prepare" disabled={busy || !manifest || !file} onClick={() => { void run('importing', prepare); }}>{t('archiveVerifyImport')}</button>}
      {ready && <div data-testid="archive-ready"><p>{t('archiveReady')}</p>
        {api && <><p>{t('archiveExportBeforeReplace')}</p><label className="check"><input data-testid="archive-replace-confirm" type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} disabled={busy} />{t('archiveReplaceConfirm')}</label></>}
        <button data-testid="archive-activate" className="danger" disabled={busy || (!!api && !replace)} onClick={() => { void activate(); }}>{t(api ? 'archiveReplace' : 'importDatabase')}</button>
      </div>}
    </section>
    {busy && phase !== 'activating' && <button data-testid="archive-cancel" onClick={() => controller.current?.abort()}>{t('cancel')}</button>}
    {phase === 'activating' && error && <button onClick={() => location.reload()}>{t('retry')}</button>}
  </main>;
}
