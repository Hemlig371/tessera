import { AppError } from './errors';
import type { Field, LayoutItem, UiDefinition, UiKind } from './model';
import { canonical } from './model';
import { fieldConfig, requireId, validateValue } from './validation';

export function layoutItems(definition: UiDefinition, fields: readonly Field[]): LayoutItem[] {
  const known = new Set(fields.map((f) => f.id));
  const configured = definition.fields.filter((item) => known.has(item.field_id));
  const present = new Set(configured.map((item) => item.field_id));
  return [
    ...configured,
    ...fields
      .filter((f) => !present.has(f.id))
      .map((f) => ({ field_id: f.id, visible: true, width: 'full' as const })),
  ];
}
export function formConfig(field: Field, item?: LayoutItem) {
  const config = fieldConfig(field);
  return {
    ...config,
    required: config.required === true || item?.required === true,
    ...(item?.hint != null ? { hint: item.hint } : {}),
    ...(item && Object.hasOwn(item, 'default') ? { default: item.default } : {}),
  };
}
export function validateUiDefinition(
  definition: UiDefinition,
  kind: UiKind,
  fields: readonly Field[],
  primary: string
): void {
  if (!definition || !Array.isArray(definition.fields)) throw new AppError('invalidUiConfig');
  const byId = new Map(fields.map((field) => [field.id, field])),
    seen = new Set<string>();
  for (const item of definition.fields) {
    requireId(item.field_id);
    const field = byId.get(item.field_id);
    if (!field || seen.has(item.field_id) || typeof item.visible !== 'boolean')
      throw new AppError('invalidUiConfig');
    seen.add(item.field_id);
    if (item.width && !['full', 'half'].includes(item.width)) throw new AppError('invalidUiConfig');
    if (item.group != null && (typeof item.group !== 'string' || item.group.length > 200))
      throw new AppError('invalidUiConfig');
    if (item.required != null && typeof item.required !== 'boolean') throw new AppError('invalidUiConfig');
    if (item.hint != null && (typeof item.hint !== 'string' || item.hint.length > 1000))
      throw new AppError('invalidUiConfig');
    if (field.type === 'backlink' && (item.required || Object.hasOwn(item, 'default')))
      throw new AppError('readOnlyField');
    if (Object.hasOwn(item, 'default'))
      validateValue(field.type, item.default, { ...fieldConfig(field), required: false });
    if (kind === 'form' && !item.visible) {
      if (field.id === primary) throw new AppError('primaryMustBeVisible');
      const config = formConfig(field, item);
      if (config.required) {
        try {
          validateValue(field.type, config.default, config);
        } catch {
          throw new AppError('hiddenRequiredField');
        }
      }
    }
  }
  if (definition.list) {
    if (kind !== 'list') throw new AppError('invalidUiConfig');
    const list = definition.list;
    if (list.mode && !['rows', 'cards', 'table'].includes(list.mode)) throw new AppError('invalidUiConfig');
    if (list.direction && !['asc', 'desc'].includes(list.direction)) throw new AppError('invalidUiConfig');
    for (const id of [list.sort_field, list.group_field])
      if (
        id &&
        id !== 'updated_at' &&
        (!byId.has(id) || ['relation', 'backlink'].includes(byId.get(id)!.type))
      )
        throw new AppError('invalidUiConfig');
    for (const filter of list.filters ?? []) {
      const field = byId.get(filter.field_id);
      if (!field || !['eq', 'ne', 'gt', 'lt', 'empty', 'filled'].includes(filter.op))
        throw new AppError('invalidUiConfig');
      if (['relation', 'backlink'].includes(field.type) && ['gt', 'lt'].includes(filter.op))
        throw new AppError('invalidFilter');
      if (!['empty', 'filled'].includes(filter.op)) {
        if (['relation', 'backlink'].includes(field.type)) {
          requireId(filter.value as string);
          continue;
        }
        if (filter.value == null) throw new AppError('invalidFilter');
        validateValue(field.type, filter.value, { ...fieldConfig(field), required: false });
      }
    }
  }
  canonical(definition as unknown as import('./model').JsonValue);
}
