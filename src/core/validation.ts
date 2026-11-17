import { AppError } from './errors';
import { canonical, FIELD_TYPES, UUID_RE } from './model';
import type { Appearance, Field, FieldConfig, FieldType, JsonValue, RecordData } from './model';
import { choiceTypes, decimalTypes, normalizeFieldValue, validateAdditionalValue, validDate } from './field-values';
import { Decimal, normalizeDecimal } from './decimal';
import { parseFormula, printFormula } from './formula';
export { validDate } from './field-values';

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
  return ['text', 'multiline', 'markdown', 'url', 'email', 'phone', 'barcode', 'address', 'color', 'icon'].includes(type);
}
export function requireFieldType(type: string): asserts type is FieldType {
  if (!(FIELD_TYPES as readonly string[]).includes(type)) throw new AppError('unsupportedField');
}
export function fieldConfig(field: Pick<Field, 'type' | 'config'>): FieldConfig {
  const raw = JSON.parse(field.config) as FieldConfig;
  return { ...raw, fts: isText(field.type) && raw.fts !== false, indexed: raw.indexed === true };
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
  if (['backlink', 'formula', 'aggregate'].includes(type)) throw new AppError('readOnlyField');
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
  if (type === 'file' || type === 'image') {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !UUID_RE.test(id)) || new Set(value).size !== value.length || (!config.multiple && value.length > 1)) throw new AppError('invalidAttachment');
  }
  if (isText(type) && typeof value !== 'string') throw new AppError('invalidData');
  if (type === 'boolean' && typeof value !== 'boolean') throw new AppError('invalidBoolean');
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new AppError('invalidInteger');
    if ((config.min != null && value < config.min) || (config.max != null && value > config.max))
      throw new AppError('outOfRange');
  }
  if (type === 'date' && (typeof value !== 'string' || !validDate(value))) throw new AppError('invalidDate');
  validateAdditionalValue(type, value, config);
}
export function validateFieldConfig(type: string, input: FieldConfig): FieldConfig {
  requireFieldType(type);
  if (['formula', 'aggregate'].includes(type)) {
    if (typeof input.formula !== 'string' || !input.formula.trim() || input.required || input.fts || Object.hasOwn(input, 'default') ||
      (input.result_type != null && !['decimal', 'text', 'boolean', 'date', 'local_datetime'].includes(input.result_type))) throw new AppError('invalidFormula');
    input = { ...input, formula: printFormula(parseFormula(input.formula)), result_type: input.result_type ?? 'decimal' };
  } else if (input.formula != null || input.result_type != null) throw new AppError('invalidFormula');
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
  } else if (type === 'file' || type === 'image') {
    if (input.indexed || input.target_collection_id != null || input.source_field_id != null || (input.multiple != null && typeof input.multiple !== 'boolean') || (Object.hasOwn(input, 'default') && input.default != null && (!Array.isArray(input.default) || input.default.length))) throw new AppError('invalidAttachment');
  } else if (input.target_collection_id != null || input.multiple != null || input.source_field_id != null)
    throw new AppError('invalidRelation');
  for (const key of ['required', 'fts', 'indexed'] as const) {
    if (input[key] != null && typeof input[key] !== 'boolean') throw new AppError('invalidData');
  }
  if (input.hint != null && (typeof input.hint !== 'string' || input.hint.length > 1000))
    throw new AppError('invalidData');
  if (!isText(type) && input.fts) throw new AppError('invalidData');
  if (type === 'secret' && (input.indexed || Object.hasOwn(input, 'default'))) throw new AppError('invalidSecret');
  if (choiceTypes.has(type)) {
    if (!Array.isArray(input.options) || !input.options.length || input.options.length > 1000 || new Set(input.options.map(option => option.id)).size !== input.options.length) throw new AppError('invalidChoice');
    for (const option of input.options) {
      requireId(option.id); nameValue(option.label);
      if (option.archived != null && typeof option.archived !== 'boolean') throw new AppError('invalidChoice');
    }
  } else if (input.options != null) throw new AppError('invalidChoice');
  if (input.precision != null && (!['decimal', 'money', 'formula', 'aggregate'].includes(type) || !Number.isInteger(input.precision) || input.precision < 0 || input.precision > 5)) throw new AppError('invalidDecimal');
  if (input.currency != null && (!['money', 'formula', 'aggregate'].includes(type) || typeof input.currency !== 'string' || input.currency.length > 16)) throw new AppError('invalidDecimal');
  for (const key of ['decimal_min', 'decimal_max'] as const) if (input[key] != null) {
    const bound = input[key]!;
    if (!decimalTypes.has(type) || typeof bound !== 'string') throw new AppError('invalidDecimal');
    input = { ...input, [key]: normalizeDecimal(bound) };
  }
  if (input.decimal_min != null && input.decimal_max != null && Decimal.parse(input.decimal_min).compare(Decimal.parse(input.decimal_max)) > 0) throw new AppError('outOfRange');
  if (input.widget != null && (!['input', 'counter', 'rating', 'progress', 'slider', 'switch'].includes(input.widget) ||
    (type === 'boolean' ? !['input', 'switch'].includes(input.widget) : !(type === 'integer' || decimalTypes.has(type)) || input.widget === 'switch'))) throw new AppError('invalidWidget');
  if (input.step != null) {
    if (!(type === 'integer' || decimalTypes.has(type)) || typeof input.step !== 'string') throw new AppError('invalidWidget');
    const number = Decimal.parse(input.step);
    if (type === 'integer' && (number.denominator !== 1n || number.numerator > BigInt(Number.MAX_SAFE_INTEGER))) throw new AppError('invalidWidget');
    const step = type === 'integer' ? number.toString(0) : normalizeDecimal(input.step);
    if (Decimal.parse(step).compare(Decimal.parse('0')) <= 0 || (type === 'integer' && !/^\d+$/.test(step))) throw new AppError('invalidWidget');
    input = { ...input, step };
  }
  if (input.barcode_label != null && (type !== 'barcode' || typeof input.barcode_label !== 'string' || input.barcode_label.length > 200)) throw new AppError('invalidData');
  for (const bound of [input.min, input.max]) {
    if (bound != null && (type !== 'integer' || !Number.isSafeInteger(bound)))
      throw new AppError('invalidInteger');
  }
  if (input.min != null && input.max != null && input.min > input.max) throw new AppError('outOfRange');
  if (Object.hasOwn(input, 'default')) {
    const value = normalizeFieldValue(type, input.default);
    validateValue(type, value, { ...input, required: false });
    input = { ...input, default: value };
  }
  canonical(input as Record<string, JsonValue>);
  return { ...input, fts: isText(type) && input.fts !== false, indexed: input.indexed === true };
}
export function validateData(data: RecordData): void {
  if (!data || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype)
    throw new AppError('invalidData');
  for (const key of Object.keys(data)) requireId(key);
  canonical(data);
}
