import { LayoutRowsView } from './LayoutRowsView';
import { relationIds } from '../core/relations';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, Entry, Field, RecordData, UiDefinition } from '../core/model';
import { formConfig, layoutItems } from '../core/ui-definition';
import type { Repository } from '../core/repository';
import { RelationBlock } from './RelationBlock';
import { RelationInput } from './RelationInput';
import { FieldInput } from './common';
export function RecordForm({
  api,
  initialData,
  collection,
  fields,
  layout,
  entry,
  save,
  cancel,
  busy,
  change,
  creating = !entry,
  pinnedData,
}: {
  api: Repository;
  initialData?: RecordData;
  collection: Collection;
  fields: Field[];
  layout: UiDefinition;
  entry?: Entry;
  save: (data: RecordData) => void;
  cancel: () => void;
  busy: boolean;
  change?: (data: RecordData) => void;
  creating?: boolean;
  pinnedData?: RecordData;
}) {
  const { t } = useTranslation();
  const items = layoutItems(layout, fields);
  const [data, setData] = useState<RecordData>(() => {
    if (entry) return { ...entry.data };
    const values: RecordData = {};
    fields.forEach((field) => {
      const config = formConfig(
        field,
        items.find((i) => i.field_id === field.id)
      );
      if (Object.hasOwn(config, 'default')) values[field.id] = config.default!;
    });
    return { ...values, ...initialData };
  });
  // Capture creation defaults for close/pause, without writing any database object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { change?.(data); }, []);
  function update(id: string, value: RecordData[string]) {
    const next = { ...data, [id]: value };
    setData(next);
    change?.(next);
  }
  return (
    <form
      onInvalidCapture={event => {
        let element = event.target as HTMLElement | null;
        while (element) { if (element instanceof HTMLDetailsElement) element.open = true; element = element.parentElement; }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        save(data);
      }}
    >
      <LayoutRowsView definition={layout} fields={fields} label={field => collection.system_kind === 'inbox' ? t('inboxContent') : field.name} render={item => {
            const field = fields.find((f) => f.id === item.field_id)!;
            const displayField = collection.system_kind === 'inbox' ? { ...field, name: t('inboxContent'), type: 'markdown' } : field;
            const config = formConfig(field, item),
              required = config.required || field.id === collection.primary_field_id;
            return (
              <div key={field.id}>
                <div className="form-field">
                  {!item.collapsed && displayField.name}
                  {required && <span aria-hidden="true"> *</span>}
                  {field.type === 'backlink' ? (
                    entry ? (
                      <RelationBlock api={api} field={field} entry={entry} busy={busy} readOnly />
                    ) : (
                      <small>{t('relationDerivedHint')}</small>
                    )
                  ) : field.type === 'relation' ? (
                    <RelationInput
                      pinnedIds={relationIds(pinnedData?.[field.id])}
                      api={api}
                      field={displayField}
                      value={data[field.id]}
                      disabled={busy}
                      change={(value) => update(field.id, value)}
                    />
                  ) : (
                    <FieldInput
                      field={displayField}
                      value={data[field.id]}
                      disabled={busy}
                      required={required}
                      change={(value) => update(field.id, value)}
                    />
                  )}
                </div>
                {config.hint && <small>{config.hint}</small>}
              </div>
            );
          }} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={cancel}>
          {t(creating ? 'close' : 'cancel')}
        </button>
        <button className="primary" disabled={busy}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}
