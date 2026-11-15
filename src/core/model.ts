export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RecordData = Record<string, JsonValue>;
export interface Stamp {
  id: string;
  hlc: string;
  device_id: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Library extends Stamp {
  system_kind?: 'inbox' | null;
  name: string;
  config: string;
  position: number;
}
export interface Collection extends Stamp {
  default_profile_id?: string | null;
  system_kind?: 'inbox' | null;
  library_id: string;
  name: string;
  primary_field_id: string;
  incoming_field_id: string;
  config: string;
  position: number;
}
export interface Field extends Stamp {
  collection_id: string;
  name: string;
  type: string;
  config: string;
  position: number;
}
export interface Entry extends Stamp {
  collection_id: string;
  data: RecordData;
  created_local: string;
  updated_local: string;
  purged: number;
}
/** Query-only labels; never included in record snapshots or synchronization payloads. */
export interface EntryListItem extends Entry {
  title: string;
  collection_name: string;
  collection_system_kind?: 'inbox';
  relation_previews?: Record<string, { items: RelationItem[]; count: number }>;
}
export interface EntryCursor {
  updated_at: string;
  id: string;
  sort_value?: string | number | null;
  query_key?: string;
  keys?: (string | number | null)[];
}
export interface Page<T> {
  items: T[];
  next: EntryCursor | null;
}
export const FIELD_TYPES = [
  'text',
  'multiline',
  'boolean',
  'integer',
  'date',
  'relation',
  'backlink',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export interface FieldConfig {
  required?: boolean;
  hint?: string;
  default?: JsonValue;
  fts?: boolean;
  indexed?: boolean;
  min?: number;
  max?: number;
  target_collection_id?: string;
  multiple?: boolean;
  source_field_id?: string;
}
export interface Appearance {
  icon?: string;
  color?: string;
}
export type UiKind = 'form' | 'card' | 'list';
export interface LayoutItem {
  field_id: string;
  visible: boolean;
  width?: 'full' | 'half';
  group?: string;
  required?: boolean;
  hint?: string;
  default?: JsonValue;
}
export interface EntryFilter {
  field_id: string;
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'empty' | 'filled';
  value?: JsonValue;
}
export interface ListOptions {
  sort_field?: string;
  direction?: 'asc' | 'desc';
  filters?: EntryFilter[];
  mode?: 'rows' | 'cards' | 'table';
  group_field?: string;
}
export interface UiDefinition {
  fields: LayoutItem[];
  list?: ListOptions;
}
export interface UiConfiguration extends Stamp {
  collection_id: string;
  kind: UiKind;
  config: string;
}
export interface DisplayProfile extends Stamp {
  collection_id: string;
  name: string;
  position: number;
  config: string;
}
export interface EntryQuery extends ListOptions {
  profile_id?: string;
  collection_id?: string;
  library_id?: string;
  search?: string;
  cursor?: EntryCursor | null;
  limit?: number;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable serialization also makes unchanged saves independent of object key order. */
export function canonical(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]!))
        .join(',') +
      '}'
    );
  }
  throw new Error('invalidData');
}
export function localTimestamp(date: Date): string {
  const pad = (v: number, n = 2) => String(v).padStart(n, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export interface RelationItem {
  id: string;
  title: string;
  status: 'available' | 'deleted' | 'missing';
  collection_id: string;
  collection_name: string;
}
export interface RelationCursor {
  key: string;
  ordinal: number;
  query_key: string;
}
export interface RelationPage {
  items: RelationItem[];
  next: RelationCursor | null;
  available: boolean;
}
export interface RelationSource extends Field {
  collection_name: string;
}
