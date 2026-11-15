import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { csvRecords, exportCsv, parseCsv, type CsvDocument, type CsvLocale } from '../core/csv';
import type { EntryQuery, Field } from '../core/model';
import { RowError } from '../core/entry-data';
import type { Repository } from '../core/repository';
import { chooseCsvWriter } from '../platform/csv-files';
import { errorKey } from './common';
export function CsvPanel({
  api,
  query,
  fields,
  name,
  busy,
  run,
}: {
  api: Repository;
  query: EntryQuery & { collection_id: string };
  fields: Field[];
  name: string;
  busy: boolean;
  run: (action: () => Promise<void>, close?: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<CsvLocale>('ru'),
    [delimiter, setDelimiter] = useState(';');
  const [doc, setDoc] = useState<CsvDocument | null>(null),
    [mapping, setMapping] = useState<(string | null)[]>([]);
  const [preview, setPreview] = useState<string[][]>([]),
    [issue, setIssue] = useState(''),
    [status, setStatus] = useState('');
  const [exportIds, setExportIds] = useState(() => fields.map((f) => f.id)),
    [encoding, setEncoding] = useState('utf-8');
  const [filtered, setFiltered] = useState(false);
  function clearPreview() {
    setPreview([]);
    setIssue('');
    setStatus('');
  }
  async function readFile(file: File) {
    await run(async () => {
      clearPreview();
      if (file.size > 100 * 1024 * 1024) throw new Error('csvTooLarge');
      const text = new TextDecoder(encoding, { fatal: true }).decode(await file.arrayBuffer());
      const parsed = parseCsv(text);
      setDoc(parsed);
      setDelimiter(parsed.delimiter);
      setMapping(
        parsed.headers.map(
          (h) =>
            fields.find((f) => f.name.toLocaleLowerCase(locale) === h.trim().toLocaleLowerCase(locale))?.id ??
            null
        )
      );
    }, false);
  }
  async function check() {
    if (!doc) return;
    await run(async () => {
      try {
        if (mapping.every((id) => !id)) throw new Error('csvMapping');
        const result = await api.previewImport(query.collection_id, csvRecords(doc, mapping, fields, locale));
        setPreview(result.preview.map((data) => mapping.map((id) => (id ? String(data[id] ?? '') : ''))));
        setIssue('');
        setStatus(t('csvPreviewCount', { count: result.count }));
      } catch (e) {
        setPreview([]);
        setStatus('');
        setIssue(
          e instanceof RowError
            ? t('csvRowError', {
                row: e.row,
                field: e.field,
                error: t(`errors.${errorKey(e)}`, { defaultValue: t('errors.invalidData') }),
              })
            : t(`errors.${errorKey(e)}`, { defaultValue: t('errors.generic') })
        );
      }
    }, false);
  }
  return (
    <div className="csv-panel">
      <label>
        {t('csvLocale')}
        <select
          value={locale}
          disabled={busy}
          onChange={(e) => {
            setLocale(e.target.value as CsvLocale);
            clearPreview();
          }}
        >
          <option value="ru">{t('languageRussian')}</option>
          <option value="en">{t('languageEnglish')}</option>
        </select>
      </label>
      <label>
        {t('csvDelimiter')}
        <select value={delimiter} disabled={busy} onChange={(e) => setDelimiter(e.target.value)}>
          {[';', ',', '\t'].map((d) => (
            <option key={d} value={d}>
              {t(d === ';' ? 'semicolon' : d === ',' ? 'comma' : 'tab')}
            </option>
          ))}
        </select>
      </label>
      <>
        {issue && (
          <p role="alert" className="error">
            {issue}
          </p>
        )}
        {status && <p role="status">{status}</p>}
      </>
      <fieldset disabled={busy}>
        <legend>{t('csvImport')}</legend>
        <p>{t('csvImportHint')}</p>
        <label>
          {t('csvEncoding')}
          <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
            <option value="utf-8">UTF-8</option>
            <option value="windows-1251">Windows-1251</option>
          </select>
        </label>
        <label>
          {t('csvFile')}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              if (e.target.files?.[0]) void readFile(e.target.files[0]);
            }}
          />
        </label>
        {doc && (
          <>
            <h3>{t('csvMapping')}</h3>
            {doc.headers.map((header, column) => (
              <label key={column}>
                {header}
                <select
                  value={mapping[column] ?? ''}
                  onChange={(e) => {
                    setMapping((old) => old.map((id, i) => (i === column ? e.target.value || null : id)));
                    clearPreview();
                  }}
                >
                  <option value="">{t('skipColumn')}</option>
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              onClick={() => {
                void check();
              }}
            >
              {t('preview')}
            </button>

            {!!preview.length && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {doc.headers.map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    void run(async () => {
                      const count = await api.importEntries(
                        query.collection_id,
                        csvRecords(doc, mapping, fields, locale),
                        (count) => {
                          if (count % 600 === 0) setStatus(t('csvImportProgress', { count }));
                        }
                      );
                      setStatus(t('csvImported', { count }));
                      setPreview([]);
                      setDoc(null);
                    }, false);
                  }}
                >
                  {t('confirmImport')}
                </button>
              </>
            )}
          </>
        )}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>{t('csvExport')}</legend>
        <p>{t('csvExportHint')}</p>
        {fields.map((f) => (
          <label key={f.id} className="check">
            <input
              type="checkbox"
              checked={exportIds.includes(f.id)}
              onChange={(e) =>
                setExportIds((old) => (e.target.checked ? [...old, f.id] : old.filter((id) => id !== f.id)))
              }
            />
            {f.name}
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} />
          {t('exportFiltered')}
        </label>
        <button
          disabled={busy || !exportIds.length}
          onClick={() => {
            void run(async () => {
              const writer = await chooseCsvWriter(
                name.replace(/[\\/:*?"<>|]/g, '_') + '.csv',
                t('csvExport')
              );
              if (!writer) return;
              const count = await exportCsv(
                api,
                filtered
                  ? query
                  : {
                      collection_id: query.collection_id,
                      search: '',
                      filters: [],
                      sort_field: 'updated_at',
                      group_field: '',
                      direction: 'desc',
                    },
                fields.filter((f) => exportIds.includes(f.id)),
                locale,
                delimiter,
                writer
              );
              setStatus(t('csvExported', { count }));
            }, false);
          }}
        >
          {t('saveCsv')}
        </button>
      </fieldset>
    </div>
  );
}
