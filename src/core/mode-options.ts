import { AppError } from './errors';
import { dateFieldType } from './date-selection';
import type { Field, FieldConfig } from './model';

export type CollectionMode = 'rows' | 'cards' | 'table' | 'kanban' | 'calendar' | 'tree';
export interface ModeOptions { mode?: CollectionMode; mode_field?: string }
export function modeFields(mode: CollectionMode, fields: readonly Field[], collectionId: string): Field[] {
  return fields.filter(field => {
    if (field.collection_id !== collectionId) return false;
    if (mode === 'kanban') return ['select','boolean'].includes(field.type);
    if (mode === 'calendar') return ['date','local_datetime','date_range'].includes(dateFieldType(field));
    if (mode === 'tree') { const config = JSON.parse(field.config) as FieldConfig; return field.type === 'relation' && config.target_collection_id === collectionId && config.multiple !== true; }
    return false;
  });
}
export function validateModeOptions(options: ModeOptions, fields: readonly Field[], collectionId: string): void {
  if (!options.mode || ['rows','cards','table'].includes(options.mode)) return;
  if (!['kanban','calendar','tree'].includes(options.mode) || !modeFields(options.mode, fields, collectionId).some(field => field.id === options.mode_field)) throw new AppError('invalidUiConfig');
}
