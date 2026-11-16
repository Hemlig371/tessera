import { AppError } from './errors';
import type { Field, LayoutItem, LayoutRow, UiDefinition, UiKind } from './model';
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
/** Legacy widths are interpreted in memory. Opening a released database never rewrites its UI JSON. */
export function layoutRows(definition: UiDefinition, fields: readonly Field[], includeHidden = false): LayoutRow[] {
  const items = layoutItems(definition, fields).filter(item => includeHidden || item.visible);
  const available = new Set(items.map(item => item.field_id)), assigned = new Set<string>();
  const rows: LayoutRow[] = [];
  for (const row of definition.rows ?? []) {
    const ids = row.field_ids.filter(id => available.has(id) && !assigned.has(id));
    if (!ids.length) continue;
    rows.push({ ...row, field_ids: ids }); ids.forEach(id => assigned.add(id));
  }
  const remaining = items.filter(item => !assigned.has(item.field_id));
  const rowIds = new Set(rows.map(row => row.id));
  for (let i = 0; i < remaining.length; i++) {
    const item = remaining[i]!, next = remaining[i + 1];
    const ids = [item.field_id];
    if (item.width === 'half' && next?.width === 'half' && (item.group ?? '') === (next.group ?? '')) { ids.push(next.field_id); i++; }
    let id = item.field_id;
    while (rowIds.has(id)) id = id.slice(0, -12) + ((BigInt('0x' + id.slice(-12)) + 1n) % (1n << 48n)).toString(16).padStart(12, '0');
    rowIds.add(id);
    rows.push({ id, columns: item.width === 'half' ? 2 : 1, field_ids: ids, ...(item.group ? { group: item.group } : {}) });
  }
  return rows;
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
    if ((item.collapsed != null && typeof item.collapsed !== 'boolean') || (kind === 'list' && item.collapsed)) throw new AppError('invalidUiConfig');
    if (item.hint != null && (typeof item.hint !== 'string' || item.hint.length > 1000))
      throw new AppError('invalidUiConfig');
    if (field.type === 'backlink' && (item.required || Object.hasOwn(item, 'default')))
      throw new AppError('readOnlyField');
    if (['file', 'image'].includes(field.type) && Object.hasOwn(item, 'default') && item.default != null && (!Array.isArray(item.default) || item.default.length)) throw new AppError('invalidAttachment');
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
  if (definition.rows != null) {
    if (kind === 'list' || !Array.isArray(definition.rows) || definition.rows.length > fields.length) throw new AppError('invalidUiConfig');
    const rowIds = new Set<string>(), assigned = new Set<string>();
    for (const row of definition.rows) {
      requireId(row.id);
      if (rowIds.has(row.id) || ![1,2,3].includes(row.columns) || !Array.isArray(row.field_ids) || !row.field_ids.length || row.field_ids.length > row.columns ||
        (row.group != null && (typeof row.group !== 'string' || row.group.length > 200))) throw new AppError('invalidUiConfig');
      rowIds.add(row.id);
      for (const id of row.field_ids) {
        if (!byId.has(id) || assigned.has(id)) throw new AppError('invalidUiConfig');
        assigned.add(id);
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
