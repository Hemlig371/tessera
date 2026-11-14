export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RecordData = Record<string, JsonValue>;
export interface Stamp {
  id: string; hlc: string; device_id: string; deleted_at: string | null;
  created_at: string; updated_at: string;
}
export interface Library extends Stamp { name: string; config: string }
export interface Collection extends Stamp {
  library_id: string; name: string; primary_field_id: string; incoming_field_id: string; config: string;
}
export interface Field extends Stamp {
  collection_id: string; name: string; type: string; config: string;
}
export interface Entry extends Stamp {
  collection_id: string; data: RecordData; created_local: string; updated_local: string; purged: number;
}
export interface Page<T> { items: T[]; next: { updated_at: string; id: string } | null }
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable serialization also makes unchanged saves independent of object key order. */
export function canonical(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k]!)).join(',') + '}';
  }
  throw new Error('invalidData');
}
export function localTimestamp(date: Date): string {
  const pad = (v: number, n = 2) => String(v).padStart(n, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
