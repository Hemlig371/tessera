import { AppError } from './errors';
import type { Field, RecordData } from './model';
import { isText, requireId } from './validation';

/** Version 1, deterministic on every platform: NFKC, Russian case fold and ё after е.
 * These are disposable local keys, not synchronized values or user data. */
export function textSortKey(text: string): string {
  const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  return Array.from(text.normalize('NFKC').toLocaleLowerCase('ru-RU'), (char) => {
    const russian = alphabet.indexOf(char);
    const point = russian >= 0 ? 0x100 + russian : 0x10000 + char.codePointAt(0)!;
    return point.toString(16).padStart(6, '0');
  }).join('');
}
export function sortData(data: RecordData, fields: readonly Field[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((f) => isText(f.type) && typeof data[f.id] === 'string')
      .map((f) => [f.id, textSortKey(data[f.id] as string)])
  );
}
export function fieldExpression(field: Pick<Field, 'id' | 'type'>, alias = ''): string {
  requireId(field.id);
  return `json_extract(${alias}${isText(field.type) ? 'sort_data' : 'data'}, '$."${field.id}"')`;
}
export function fieldIndexName(id: string): string {
  requireId(id);
  return 'field_' + id.replaceAll('-', '');
}
export function searchTerms(query: string): string[] {
  if (query.length > 200) throw new AppError('invalidSearch');
  const words =
    query
      .normalize('NFKC')
      .toLocaleLowerCase('ru-RU')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length > 12) throw new AppError('invalidSearch');
  return [...new Set(words)].map((word) => `"${word}"*`);
}
