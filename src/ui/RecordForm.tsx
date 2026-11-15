import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, Entry, Field, RecordData, UiDefinition } from '../core/model';
import { formConfig, layoutItems } from '../core/ui-definition';
import { FieldInput } from './common';
export function RecordForm({
  collection,
  fields,
  layout,
  entry,
  save,
  cancel,
  busy,
}: {
  collection: Collection;
  fields: Field[];
  layout: UiDefinition;
  entry?: Entry;
  save: (data: RecordData) => void;
  cancel: () => void;
  busy: boolean;
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
    return values;
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(data);
      }}
    >
      <div className="field-grid">
        {items
          .filter((item) => item.visible)
          .map((item) => {
            const field = fields.find((f) => f.id === item.field_id)!;
            const config = formConfig(field, item),
              required = config.required || field.id === collection.primary_field_id;
            return (
              <div key={field.id} className={item.width === 'half' ? 'half' : 'full'}>
                {item.group && <small className="group-label">{item.group}</small>}
                <label>
                  {field.name}
                  {required && <span aria-hidden="true"> *</span>}
                  <FieldInput
                    field={field}
                    value={data[field.id]}
                    disabled={busy}
                    required={required}
                    change={(value) => setData((old) => ({ ...old, [field.id]: value }))}
                  />
                </label>
                {config.hint && <small>{config.hint}</small>}
              </div>
            );
          })}
      </div>
      <div className="actions">
        <button type="button" disabled={busy} onClick={cancel}>
          {t('cancel')}
        </button>
        <button className="primary" disabled={busy}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}
