import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryFilter, Field, LayoutItem, ListOptions, UiDefinition, UiKind } from '../core/model';
import { layoutItems } from '../core/ui-definition';
import type { Repository } from '../core/repository';
import { RelationInput } from './RelationInput';
import { FieldInput } from './common';
export function LayoutEditor({
  api,
  kind,
  fields,
  definition,
  save,
  cancel,
  busy,
}: {
  api: Repository;
  kind: UiKind;
  fields: Field[];
  definition: UiDefinition;
  save: (definition: UiDefinition) => void;
  cancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => layoutItems(definition, fields));
  const [list, setList] = useState<ListOptions>(definition.list ?? {});
  function patch(id: string, value: Partial<LayoutItem>) {
    setItems((old) => old.map((item) => (item.field_id === id ? { ...item, ...value } : item)));
  }
  function move(index: number, offset: number) {
    setItems((old) => {
      const next = [...old];
      const [item] = next.splice(index, 1);
      next.splice(index + offset, 0, item!);
      return next;
    });
  }
  function filter(index: number, value: Partial<EntryFilter>) {
    setList((old) => ({
      ...old,
      filters: old.filters?.map((f, i) => (i === index ? { ...f, ...value } : f)) ?? [],
    }));
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ fields: items, ...(kind === 'list' ? { list } : {}) });
      }}
    >
      <p>{t('independentLayouts')}</p>
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
            <div className="field-grid">
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
            </div>
            {kind === 'form' && field.type !== 'backlink' && (
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
                <label className="check">
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
                </label>
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
              onChange={(e) => setList((old) => ({ ...old, mode: e.target.value as ListOptions['mode'] }))}
            >
              {['rows', 'cards', 'table'].map((mode) => (
                <option key={mode} value={mode}>
                  {t(`modes.${mode}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('sortBy')}
            <select
              value={list.sort_field ?? 'updated_at'}
              onChange={(e) => setList((old) => ({ ...old, sort_field: e.target.value }))}
            >
              <option value="updated_at">{t('updatedAt')}</option>
              {fields
                .filter((f) => !['relation', 'backlink'].includes(f.type))
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
                .filter((f) => !['relation', 'backlink'].includes(f.type))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
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
                  {(['relation', 'backlink'].includes(
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
                    ['relation', 'backlink'].includes(
                      fields.find((field) => field.id === f.field_id)?.type ?? ''
                    )
                      ? { ...fields.find((field) => field.id === f.field_id)!, type: 'text' }
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
