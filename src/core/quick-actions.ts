import { AppError } from './errors';
import { Decimal, normalizeDecimal } from './decimal';
import { decimalTypes, normalizeFieldValue } from './field-values';
import type { Field, JsonValue } from './model';
import { fieldConfig, validateValue } from './validation';

export type QuickControl = 'toggle' | 'counter' | 'choice' | 'rating' | 'slider' | 'progress';
export interface QuickActionDefinition { field_id: string; control: QuickControl }
export type QuickMutation = { kind: 'toggle' } | { kind: 'increment'; direction: 1 | -1 } | { kind: 'set'; value: JsonValue };
export function quickControls(field: Pick<Field, 'type'>): QuickControl[] {
  return field.type === 'boolean' ? ['toggle'] : field.type === 'select' ? ['choice'] : field.type === 'integer' || decimalTypes.has(field.type) ? ['counter', 'rating', 'slider', 'progress'] : [];
}
/** Only typed one-step mutations qualify; all persistence remains in Repository. */
export function quickValue(field: Field, previous: JsonValue | undefined, mutation: QuickMutation): JsonValue {
  const config = fieldConfig(field), numeric = field.type === 'integer' || decimalTypes.has(field.type);
  let value: JsonValue;
  if (mutation.kind === 'toggle') {
    if (field.type !== 'boolean' || (previous != null && typeof previous !== 'boolean')) throw new AppError('invalidQuickAction');
    value = previous !== true;
  } else if (mutation.kind === 'increment') {
    if (!numeric || ![1, -1].includes(mutation.direction)) throw new AppError('invalidQuickAction');
    if (previous != null && (field.type === 'integer' ? typeof previous !== 'number' || !Number.isSafeInteger(previous) : typeof previous !== 'string')) throw new AppError('invalidQuickAction');
    const next = Decimal.parse(previous == null ? '0' : String(previous)).add(Decimal.parse(config.step ?? '1').multiply(new Decimal(BigInt(mutation.direction))));
    if (field.type === 'integer') {
      if (next.denominator !== 1n || next.numerator > BigInt(Number.MAX_SAFE_INTEGER) || next.numerator < BigInt(Number.MIN_SAFE_INTEGER)) throw new AppError('invalidInteger');
      value = Number(next.numerator);
    } else value = normalizeDecimal(next.toString());
  } else if (mutation.kind === 'set') {
    if (!numeric && !['boolean', 'select'].includes(field.type)) throw new AppError('invalidQuickAction');
    value = normalizeFieldValue(field.type, mutation.value)!;
  } else throw new AppError('invalidQuickAction');
  validateValue(field.type, value, config);
  return value;
}
