import { AppError } from './errors';
import type { Collection, Field, RecordData } from './model';
import { isText, requireId } from './validation';
import { splitInboxMarkdown } from './markdown';

export interface InboxMapping { title_field_id: string; body_field_id: string }
export function validateInboxMapping(mapping: InboxMapping, fields: readonly Field[]): void {
  if (!mapping || typeof mapping !== 'object') throw new AppError('invalidInboxMapping');
  requireId(mapping.title_field_id); requireId(mapping.body_field_id);
  if (mapping.title_field_id === mapping.body_field_id || [mapping.title_field_id,mapping.body_field_id].some(id => !fields.some(field => field.id === id && isText(field.type)))) throw new AppError('invalidInboxMapping');
}
export function inboxMoveDefaults(source: Collection, target: Collection, fields: readonly Field[], data: RecordData) {
  const original = data[source.incoming_field_id] ?? '';
  if (typeof original !== 'string') throw new AppError('invalidData');
  const mapping = (JSON.parse(target.config) as { inbox_mapping?: InboxMapping | null }).inbox_mapping;
  let valid = false;
  if (mapping) { try { validateInboxMapping(mapping, fields); valid = true; } catch { /* Preserve all text in the ordinary incoming field. */ } }
  let values: RecordData;
  if (mapping && valid) {
    const split = splitInboxMarkdown(original);
    values = { [mapping.title_field_id]: split.title, [mapping.body_field_id]: split.body };
  } else {
    if (!fields.some(field => field.id === target.incoming_field_id && isText(field.type))) throw new AppError('invalidInboxMapping');
    values = { [target.incoming_field_id]: original };
  }
  // The original remains an unknown UUID value, independent of edits to the mapped title/body.
  return { data: { ...values, [source.incoming_field_id]: original }, original,
    mapping_status: valid ? 'split' as const : mapping ? 'fallback' as const : 'none' as const };
}
