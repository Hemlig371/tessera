import { AppError } from './errors';
import type { CreationChoice, Field, PresetDefinition, UiDefinition } from './model';
import { formConfig } from './ui-definition';
import { requireId, validateData, validateValue } from './validation';

export function validateCreationChoice(choice: CreationChoice): void {
  if (!choice || !['standard','quick','preset'].includes(choice.kind)) throw new AppError('invalidPreset');
  if (choice.kind === 'preset') requireId(choice.preset_id);
}
export function collectionCreationChoice(config: string): CreationChoice {
  const choice = (JSON.parse(config) as { creation?: CreationChoice }).creation ?? { kind: 'standard' };
  validateCreationChoice(choice); return choice;
}
/** Presets are partial form input, never stored records or user-supplied executable code. */
export function validatePresetDefinition(definition: PresetDefinition, fields: Field[], form: UiDefinition, primary: string): void {
  if (!definition || !['standard','quick'].includes(definition.form) || !Array.isArray(definition.today_fields) ||
    new Set(definition.today_fields).size !== definition.today_fields.length) throw new AppError('invalidPreset');
  validateData(definition.data);
  const byId = new Map(fields.map(field => [field.id, field]));
  for (const id of [...Object.keys(definition.data), ...definition.today_fields]) {
    requireId(id); const field = byId.get(id);
    if (!field || ['backlink','formula','aggregate','secret','file','image'].includes(field.type)) throw new AppError('invalidPreset');
    if (definition.today_fields.includes(id)) {
      if (field.type !== 'date' || Object.hasOwn(definition.data, id)) throw new AppError('invalidPreset');
    } else validateValue(field.type, definition.data[id], formConfig(field, form.fields.find(item => item.field_id === id)), field.id === primary);
  }
}
