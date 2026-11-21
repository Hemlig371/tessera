import { DateSelectionEditor } from './DateSelectionEditor';
import { QueryTotalsEditor } from './QueryTotalsEditor';
import { modeFields } from '../core/mode-options';
import type { SummaryMeasure } from '../core/query-summary';
import { LayoutRowsEditor } from './LayoutRowsEditor';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryFilter, Field, LayoutItem, LayoutRow, ListOptions, UiDefinition, UiKind } from '../core/model';
import { layoutItems, layoutRows } from '../core/ui-definition';
import type { Repository } from '../core/repository';
import { RelationInput } from './RelationInput';
import { FieldInput } from './common';
import { fieldConfig } from '../core/validation';
import { QuickActionsEditor } from './QuickActionsEditor';
import type { QuickActionDefinition } from '../core/quick-actions';
export function LayoutEditor({
  api,
  kind,
  fields,
  definition,
  save,
  cancel,
  busy,
  allowQuickActions = true,
}: {
  api: Repository;
  kind: UiKind;
  fields: Field[];
  definition: UiDefinition;
  save: (definition: UiDefinition) => void;
  cancel: () => void;
  busy: boolean;
  allowQuickActions?: boolean;
}) {
  const { t } = useTranslation();
  const [storedItems, setItems] = useState(() => layoutItems(definition, fields));
  const [rows, setRows] = useState<LayoutRow[]>(() => kind === 'list' ? [] : layoutRows(definition, fields, true));
  const order = new Map(rows.flatMap(row => row.field_ids).map((id, index) => [id, index]));
  const items = kind === 'list' ? storedItems : [...storedItems].sort((a, b) => (order.get(a.field_id) ?? Infinity) - (order.get(b.field_id) ?? Infinity));
  const [list, setList] = useState<ListOptions>(definition.list ?? {});
  const [actions, setActions] = useState<QuickActionDefinition[]>(definition.quick_actions ?? []);
  const [totals, setTotals] = useState<SummaryMeasure[]>(definition.totals ?? []);
  function patch(id: string, value: Partial<LayoutItem>) {
    setItems((old) => old.map((item) => (item.field_id === id ? { ...item, ...value } : item)));
  }
  function move(index: number, offset: number) {
    if (kind !== 'list') {
      const first = items[index]!.field_id, second = items[index + offset]!.field_id;
      // Every field stays assigned; moving across a row swaps its cell with its neighbour.
      setRows(current => {
        const complete = layoutRows({ fields: storedItems, rows: current.filter(row => row.field_ids.length) }, fields, true);
        return complete.map(row => ({ ...row, field_ids: row.field_ids.map(id => id === first ? second : id === second ? first : id) }));
      });
    } else setItems(old => { const next = [...old], [item] = next.splice(index, 1); next.splice(index + offset, 0, item!); return next; });
  }
  function filter(index: number, value: Partial<EntryFilter>) {
    setList((old) => ({
      ...old,
      filters: old.filters?.map((f, i) => (i === index ? { ...f, ...value } : f)) ?? [],
    }));
  }
  return (
    <form
      className="layout-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save({ ...definition, fields: items, ...(allowQuickActions && kind !== 'form' ? { quick_actions: actions } : {}), ...(kind === 'list' ? { list, totals } : { rows: rows.filter(row => row.field_ids.length) }) });
      }}
    >
      <p className="screen-hint">{t('independentLayouts')}</p>
      {kind !== 'list' && <LayoutRowsEditor rows={rows} fields={fields} busy={busy} change={setRows} />}
      {items.map((item, index) => {
        const field = fields.find((f) => f.id === item.field_id)!;
        return (
          <fieldset key={field.id} disabled={busy}>
            <legend>{field.name}</legend>
            <div className="layout-heading">
              <label className="check">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={(e) => patch(field.id, { visible: e.target.checked })}
                />
                {t('visible')}
              </label>
              <button
                type="button"
                aria-label={t('moveUp', { name: field.name })}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={t('moveDown', { name: field.name })}
                disabled={busy || index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            {kind === 'list' && <div className="field-grid">
              <label className="half">
                {t('width')}
                <select
                  value={item.width ?? 'full'}
                  onChange={(e) => patch(field.id, { width: e.target.value as 'full' | 'half' })}
                >
                  <option value="full">{t('fullWidth')}</option>
                  <option value="half">{t('halfWidth')}</option>
                </select>
              </label>
              <label className="half">
                {t('fieldGroup')}
                <input
                  maxLength={200}
                  value={item.group ?? ''}
                  onChange={(e) => patch(field.id, { group: e.target.value })}
                />
              </label>
            </div>}
            {kind !== 'list' && <label className="check"><input type="checkbox" checked={item.collapsed ?? false} onChange={event => patch(field.id, { collapsed: event.target.checked })} />{t('fieldCollapsed')}</label>}
            {kind === 'form' && !['backlink', 'formula', 'aggregate'].includes(field.type) && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={item.required ?? false}
                    onChange={(e) => patch(field.id, { required: e.target.checked })}
                  />
                  {t('required')}
                </label>
                <label>
                  {t('hint')}
                  <input
                    maxLength={1000}
                    value={item.hint ?? ''}
                    onChange={(e) => patch(field.id, { hint: e.target.value })}
                  />
                </label>
                {!['secret','file','image'].includes(field.type) && <>                <label className="check">
                  <input
                    type="checkbox"
                    checked={Object.hasOwn(item, 'default')}
                    onChange={(e) => {
                      if (e.target.checked) patch(field.id, { default: null });
                      else
                        setItems((old) =>
                          old.map((row) => {
                            if (row.field_id !== field.id) return row;
                            const next = { ...row };
                            delete next.default;
                            return next;
                          })
                        );
                    }}
                  />
                  {t('overrideDefault')}
                </label></>}
                {Object.hasOwn(item, 'default') &&
                  (field.type === 'relation' ? (
                    <RelationInput
                      api={api}
                      field={field}
                      value={item.default}
                      change={(value) => patch(field.id, { default: value })}
                      disabled={busy}
                    />
                  ) : (
                    <FieldInput
                      field={field}
                      label={t('defaultValue')}
                      value={item.default}
                      change={(value) => patch(field.id, { default: value })}
                    />
                  ))}
              </>
            )}
          </fieldset>
        );
      })}
      {kind === 'list' && (
        <fieldset disabled={busy}>
          <legend>{t('listSettings')}</legend>
          <label>
            {t('listMode')}
            <select
              value={list.mode ?? 'rows'}
              onChange={(e) => setList((old) => ({ ...old, mode: e.target.value as ListOptions['mode'], mode_field: undefined }))}
            >
              {(['rows', 'cards', 'table', 'kanban', 'calendar', 'tree'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`modes.${mode}`)}
                </option>
              ))}
            </select>
          </label>
          {list.mode && ['kanban', 'calendar', 'tree'].includes(list.mode) && <label>{t('modeField')}<select value={list.mode_field ?? ''} onChange={event => setList(old => ({ ...old, mode_field: event.target.value || undefined }))}>
            <option value="">{t('chooseField')}</option>
            {modeFields(list.mode, fields, fields[0]?.collection_id ?? '').map(field => <option value={field.id} key={field.id}>{field.name}</option>)}
          </select></label>}
          <label>
            {t('sortBy')}
            <select
              value={list.sort_field ?? 'updated_at'}
              onChange={(e) => setList((old) => ({ ...old, sort_field: e.target.value }))}
            >
              <option value="updated_at">{t('updatedAt')}</option>
              {fields
                .filter((f) => !['relation', 'backlink', 'file', 'image'].includes(f.type))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('direction')}
            <select
              value={list.direction ?? 'desc'}
              onChange={(e) => setList((old) => ({ ...old, direction: e.target.value as 'asc' | 'desc' }))}
            >
              <option value="asc">{t('ascending')}</option>
              <option value="desc">{t('descending')}</option>
            </select>
          </label>
          <label>
            {t('groupBy')}
            <select
              value={list.group_field ?? ''}
              onChange={(e) => setList((old) => ({ ...old, group_field: e.target.value }))}
            >
              <option value="">{t('noGrouping')}</option>
              {fields
                .filter((f) => !['relation', 'backlink', 'file', 'image'].includes(f.type))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <DateSelectionEditor fields={fields} value={list.date_selection} change={value => setList(old => ({ ...old, date_selection: value }))} />
          <QueryTotalsEditor fields={fields} measures={totals} change={setTotals} busy={busy} />
          <h3>{t('filters')}</h3>
          {list.filters?.map((f, index) => (
            <div className="filter" key={index}>
              <label>
                {t('field')}
                <select
                  value={f.field_id}
                  onChange={(e) => filter(index, { field_id: e.target.value, value: null, op: 'empty' })}
                >
                  {fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('condition')}
                <select
                  value={f.op}
                  onChange={(e) => {
                    const op = e.target.value as EntryFilter['op'];
                    filter(index, {
                      op,
                      ...(['empty', 'filled'].includes(op)
                        ? {}
                        : {
                            value:
                              fields.find((field) => field.id === f.field_id)?.type === 'text' ? '' : null,
                          }),
                    });
                  }}
                >
                  {(['file', 'image'].includes(fields.find((field) => field.id === f.field_id)?.type ?? '') ? ['empty', 'filled'] : ['relation', 'backlink'].includes(
                    fields.find((field) => field.id === f.field_id)?.type ?? ''
                  )
                    ? ['eq', 'ne', 'empty', 'filled']
                    : ['eq', 'ne', 'gt', 'lt', 'empty', 'filled']
                  ).map((op) => (
                    <option key={op} value={op}>
                      {t(`operators.${op}`)}
                    </option>
                  ))}
                </select>
              </label>
              {!['empty', 'filled'].includes(f.op) && (
                <FieldInput
                  field={
                    ['relation', 'backlink', 'file', 'image'].includes(
                      fields.find((field) => field.id === f.field_id)?.type ?? ''
                    )
                      ? { ...fields.find((field) => field.id === f.field_id)!, type: 'text' }
                      : ['formula', 'aggregate'].includes(fields.find(field => field.id === f.field_id)?.type ?? '')
                        ? { ...fields.find(field => field.id === f.field_id)!, type: fieldConfig(fields.find(field => field.id === f.field_id)!).result_type ?? 'decimal' }
                        : fields.find((field) => field.id === f.field_id)!
                  }
                  label={t('filterValue')}
                  value={f.value}
                  change={(value) => filter(index, { value })}
                />
              )}
              <button
                type="button"
                onClick={() =>
                  setList((old) => ({ ...old, filters: old.filters?.filter((_, i) => i !== index) ?? [] }))
                }
              >
                {t('removeFilter')}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setList((old) => ({
                ...old,
                filters: [...(old.filters ?? []), { field_id: fields[0]!.id, op: 'filled' }],
              }))
            }
          >
            {t('addFilter')}
          </button>
        </fieldset>
      )}
      {allowQuickActions && kind !== 'form' && <QuickActionsEditor fields={fields} actions={actions} change={setActions} busy={busy} />}
      <div className="actions">
        <button type="button" disabled={busy} onClick={cancel}>
          {t('cancel')}
        </button>
        <button className="primary" disabled={busy}>
          {t('saveLayout')}
        </button>
      </div>
    </form>
  );
}
