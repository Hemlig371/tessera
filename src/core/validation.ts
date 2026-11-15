import { AppError } from './errors';
import { canonical, FIELD_TYPES, UUID_RE } from './model';
import type { Appearance, Field, FieldConfig, FieldType, JsonValue, RecordData } from './model';

export function requireId(id: string): void {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AppError('invalidId');
}
export function nameValue(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200)
    throw new AppError('invalidName');
  return value.trim();
}
export function positionValue(position: number): number {
  if (!Number.isSafeInteger(position) || position < 0) throw new AppError('invalidPosition');
  return position;
}
export function appearanceValue(value: Appearance): Appearance {
  if (value.icon != null && (typeof value.icon !== 'string' || value.icon.length > 16))
    throw new AppError('invalidAppearance');
  if (value.color != null && !/^#[0-9a-f]{6}$/i.test(value.color)) throw new AppError('invalidAppearance');
  return {
    ...(value.icon != null ? { icon: value.icon } : {}),
    ...(value.color ? { color: value.color } : {}),
  };
}
export function isText(type: string): boolean {
  return type === 'text' || type === 'multiline';
}
export function requireFieldType(type: string): asserts type is FieldType {
  if (!(FIELD_TYPES as readonly string[]).includes(type)) throw new AppError('unsupportedField');
}
export function fieldConfig(field: Pick<Field, 'type' | 'config'>): FieldConfig {
  const raw = JSON.parse(field.config) as FieldConfig;
  return { ...raw, fts: isText(field.type) && raw.fts !== false, indexed: raw.indexed === true };
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateValue(
  type: string,
  value: JsonValue | undefined,
  config: FieldConfig,
  primary = false
): void {
  requireFieldType(type);
  if (primary && (typeof value !== 'string' || !value.trim())) throw new AppError('requiredText');
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  if ((config.required || primary) && (empty || (typeof value === 'string' && !value.trim())))
    throw new AppError(primary ? 'requiredText' : 'requiredField');
  if (value == null) return;
  if (type === 'backlink') throw new AppError('readOnlyField');
  if (type === 'relation') {
    if (config.multiple) {
      if (
        !Array.isArray(value) ||
        value.some((id) => typeof id !== 'string') ||
        new Set(value).size !== value.length
      )
        throw new AppError('invalidRelation');
      for (const id of value) requireId(id as string);
    } else {
      if (typeof value !== 'string') throw new AppError('invalidRelation');
      requireId(value);
    }
  }
  if (isText(type) && typeof value !== 'string') throw new AppError('invalidData');
  if (type === 'boolean' && typeof value !== 'boolean') throw new AppError('invalidBoolean');
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new AppError('invalidInteger');
    if ((config.min != null && value < config.min) || (config.max != null && value > config.max))
      throw new AppError('outOfRange');
  }
  if (type === 'date' && (typeof value !== 'string' || !validDate(value))) throw new AppError('invalidDate');
}
export function validateFieldConfig(type: string, input: FieldConfig): FieldConfig {
  requireFieldType(type);
  if (type === 'relation') {
    requireId(input.target_collection_id!);
    if (input.indexed) throw new AppError('invalidRelation');
    if (input.multiple != null && typeof input.multiple !== 'boolean') throw new AppError('invalidRelation');
    if (input.source_field_id != null) throw new AppError('invalidRelation');
  } else if (type === 'backlink') {
    requireId(input.source_field_id!);
    if (
      input.required ||
      Object.hasOwn(input, 'default') ||
      input.indexed ||
      input.target_collection_id != null ||
      input.multiple != null
    )
      throw new AppError('readOnlyField');
  } else if (input.target_collection_id != null || input.multiple != null || input.source_field_id != null)
    throw new AppError('invalidRelation');
  for (const key of ['required', 'fts', 'indexed'] as const) {
    if (input[key] != null && typeof input[key] !== 'boolean') throw new AppError('invalidData');
  }
  if (input.hint != null && (typeof input.hint !== 'string' || input.hint.length > 1000))
    throw new AppError('invalidData');
  if (!isText(type) && input.fts) throw new AppError('invalidData');
  for (const bound of [input.min, input.max]) {
    if (bound != null && (type !== 'integer' || !Number.isSafeInteger(bound)))
      throw new AppError('invalidInteger');
  }
  if (input.min != null && input.max != null && input.min > input.max) throw new AppError('outOfRange');
  if (Object.hasOwn(input, 'default')) validateValue(type, input.default, { ...input, required: false });
  canonical(input as Record<string, JsonValue>);
  return { ...input, fts: isText(type) && input.fts !== false, indexed: input.indexed === true };
}
export function validateData(data: RecordData): void {
  if (!data || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype)
    throw new AppError('invalidData');
  for (const key of Object.keys(data)) requireId(key);
  canonical(data);
}
