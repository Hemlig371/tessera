import { AppError } from './errors';
import type { Collection, Field, RecordData, UiDefinition } from './model';
import { formConfig } from './ui-definition';
import { validateData, validateValue } from './validation';
export class FieldError extends AppError {
  constructor(
    code: string,
    readonly field: string
  ) {
    super(code);
  }
}
export class RowError extends AppError {
  constructor(
    readonly row: number,
    readonly field: string,
    code: string
  ) {
    super(code);
  }
}
export function entryRules(collection: Collection, fields: readonly Field[], form: UiDefinition) {
  return fields.map((field) => ({
    field,
    config: formConfig(
      field,
      form.fields.find((item) => item.field_id === field.id)
    ),
    primary: field.id === collection.primary_field_id,
  }));
}
export function prepareEntryData(
  input: RecordData,
  rules: ReturnType<typeof entryRules>,
  previous?: RecordData
): RecordData {
  validateData(input);
  const data = { ...previous, ...input };
  for (const { field, config, primary } of rules) {
    if (!previous && !Object.hasOwn(data, field.id) && Object.hasOwn(config, 'default'))
      data[field.id] = config.default!;
    try {
      validateValue(field.type, data[field.id], config, primary);
    } catch (e) {
      throw new FieldError(e instanceof Error ? e.message : 'invalidData', field.name);
    }
  }
  return data;
}
