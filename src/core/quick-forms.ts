import { AppError } from './errors';
import type { Collection, Field, UiDefinition } from './model';
import type { SqlSession } from './ports';
import { formConfig, validateUiDefinition } from './ui-definition';
import { validateValue } from './validation';

function needsInput(field: Field, primary: string, form: UiDefinition): boolean {
  if (field.type === 'backlink') return false;
  const config = formConfig(field, form.fields.find(item => item.field_id === field.id));
  if (!config.required && field.id !== primary) return false;
  try { validateValue(field.type, config.default, config, field.id === primary); return false; }
  catch { return true; }
}
export function validateQuickForm(definition: UiDefinition, collection: Collection, fields: Field[], form: UiDefinition): void {
  validateUiDefinition(definition, 'card', fields, collection.primary_field_id);
  const visible = new Set(definition.fields.filter(item => item.visible).map(item => item.field_id));
  for (const item of definition.fields) {
    // A quick form selects controls; validation and defaults come from the normal form.
    if (item.required != null || item.hint != null || Object.hasOwn(item, 'default')) throw new AppError('invalidUiConfig');
  }
  for (const field of fields) {
    if (field.type === 'backlink' && visible.has(field.id)) throw new AppError('readOnlyField');
    if (!visible.has(field.id) && needsInput(field, collection.primary_field_id, form)) throw new AppError('hiddenRequiredField');
  }
}
export async function readQuickForm(s: SqlSession, collection: Collection, fields: Field[], form: UiDefinition): Promise<UiDefinition> {
  const [stored] = await s.query<{ config: string }>('SELECT config FROM quick_forms WHERE collection_id=? AND deleted_at IS NULL', [collection.id]);
  if (stored) {
    const definition = JSON.parse(stored.config) as UiDefinition;
    const active = new Set(fields.map(field => field.id));
    return { fields: definition.fields.filter(item => active.has(item.field_id)) };
  }
  return { fields: fields.map(field => ({ field_id: field.id,
    visible: field.id === collection.primary_field_id || needsInput(field, collection.primary_field_id, form), width: 'full' })) };
}
