import { backlinkValues } from './relations';
import { RowError } from './entry-data';
import { AppError } from './errors';
import type { EntryQuery, Field, JsonValue, RecordData } from './model';
import type { Repository } from './repository';
import { queryEntries } from './queries';
import { fieldConfig, isText, validateValue } from './validation';
export type CsvLocale = 'ru' | 'en';
export interface CsvDocument {
  headers: string[];
  rows: string[][];
  delimiter: string;
}
export class CsvError extends RowError {}
/** RFC4180 quoting, multiline cells, UTF-8 BOM; dialect is explicit or inferred from header. */
export function parseCsv(text: string, delimiter?: string): CsvDocument {
  text = text.replace(/^\uFEFF/, '');
  if (!delimiter) {
    let quoted = false,
      header = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (c === '"') quoted = !quoted;
      if (!quoted && /[\r\n]/.test(c)) break;
      if (!quoted) header += c;
    }
    delimiter = [',', ';', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0]!;
  }
  if (![',', ';', '\t'].includes(delimiter)) throw new AppError('invalidCsv');
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false,
    started = false;
  const cell = () => {
    row.push(value);
    value = '';
    closed = false;
    started = false;
  };
  const line = () => {
    cell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === delimiter) cell();
    else if (c === '\r' || c === '\n') {
      line();
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (c === '"' && !started && !closed) {
      quoted = true;
      started = true;
    } else {
      if (closed || c === '"') throw new CsvError(rows.length + 1, '', 'invalidCsv');
      value += c;
      started = true;
    }
  }
  if (quoted) throw new CsvError(rows.length + 1, '', 'invalidCsv');
  if (started || closed || value || row.length) line();
  const headers = rows.shift();
  if (!headers?.length || headers.every((h) => !h.trim())) throw new AppError('invalidCsv');
  rows.forEach((r, i) => {
    if (r.length !== headers.length) throw new CsvError(i + 2, '', 'csvColumns');
  });
  return { headers, rows, delimiter };
}
export function csvValue(text: string, field: Field, locale: CsvLocale): JsonValue {
  if (field.type === 'backlink') throw new AppError('readOnlyField');
  if (field.type === 'relation') {
    let value: JsonValue = text.trim() || null;
    if (fieldConfig(field).multiple && text.trim()) {
      try {
        value = JSON.parse(text) as JsonValue;
      } catch {
        throw new AppError('invalidRelation');
      }
    }
    validateValue(field.type, value, { ...fieldConfig(field), required: false });
    return value;
  }
  if (isText(field.type)) return text;
  if (!text.trim()) return null;
  const value = text.trim();
  let result: JsonValue = value;
  if (field.type === 'integer') {
    const pattern =
      locale === 'ru'
        ? /^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)$/
        : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/;
    if (!pattern.test(value)) throw new AppError('invalidInteger');
    result = Number(value.replace(/[ ,\u00a0\u202f]/g, ''));
  } else if (field.type === 'boolean') {
    const lower = value.toLowerCase();
    if (['true', '1', ...(locale === 'ru' ? ['да'] : ['yes'])].includes(lower)) result = true;
    else if (['false', '0', ...(locale === 'ru' ? ['нет'] : ['no'])].includes(lower)) result = false;
    else throw new AppError('invalidBoolean');
  } else if (field.type === 'date' && locale === 'ru' && /^\d{2}\.\d{2}\.\d{4}$/.test(value))
    result = value.split('.').reverse().join('-');
  validateValue(field.type, result, { ...fieldConfig(field), required: false });
  return result;
}
export function* csvRecords(
  doc: CsvDocument,
  mapping: readonly (string | null)[],
  fields: readonly Field[],
  locale: CsvLocale
): Generator<RecordData> {
  const ids = mapping.filter((id): id is string => !!id),
    byId = new Map(fields.map((f) => [f.id, f]));
  if (
    mapping.length !== doc.headers.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byId.has(id) || byId.get(id)?.type === 'backlink')
  )
    throw new AppError('csvMapping');
  for (let i = 0; i < doc.rows.length; i++) {
    const data: RecordData = {};
    mapping.forEach((id, column) => {
      if (!id) return;
      const field = byId.get(id)!;
      try {
        data[id] = csvValue(doc.rows[i]![column]!, field, locale);
      } catch (e) {
        throw new CsvError(i + 2, field.name, e instanceof Error ? e.message : 'invalidData');
      }
    });
    yield data;
  }
}
export interface CsvWriter {
  write(text: string): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}
export function csvLine(values: readonly string[], delimiter: string): string {
  return (
    values
      .map((v) => (/["\r\n]/.test(v) || v.includes(delimiter) ? '"' + v.replaceAll('"', '""') + '"' : v))
      .join(delimiter) + '\r\n'
  );
}
/** Consistent SQLite snapshot, bounded pages and writes. Destination is chosen before locking DB. */
export async function exportCsv(
  api: Repository,
  query: EntryQuery & { collection_id: string },
  fields: readonly Field[],
  locale: CsvLocale,
  delimiter: string,
  writer: CsvWriter
): Promise<number> {
  if (![',', ';', '\t'].includes(delimiter) || !fields.length) throw new AppError('invalidCsv');
  let count = 0;
  try {
    await api.db.transaction(async (s) => {
      await writer.write(
        '\uFEFF' +
          csvLine(
            fields.map((f) => f.name),
            delimiter
          )
      );
      let cursor: EntryQuery['cursor'];
      do {
        const page = await queryEntries(s, { ...query, cursor, limit: 200 });
        let chunk = '';
        const derived = await backlinkValues(
          s,
          fields,
          page.items.map((e) => e.id)
        );
        for (const entry of page.items) {
          chunk += csvLine(
            fields.map((field) => {
              const v =
                field.type === 'backlink' ? (derived.get(entry.id)?.[field.id] ?? []) : entry.data[field.id];
              if (v == null) return '';
              if (Array.isArray(v)) return JSON.stringify(v);
              if (typeof v === 'boolean') return locale === 'ru' ? (v ? 'да' : 'нет') : v ? 'true' : 'false';
              if (field.type === 'date' && locale === 'ru') return String(v).split('-').reverse().join('.');
              return String(v);
            }),
            delimiter
          );
          count++;
          if (chunk.length > 32000) {
            await writer.write(chunk);
            chunk = '';
          }
        }
        if (chunk) await writer.write(chunk);
        cursor = page.next;
      } while (cursor);
    });
    await writer.finish();
    return count;
  } catch (e) {
    await writer.abort().catch(() => undefined);
    throw e;
  }
}
