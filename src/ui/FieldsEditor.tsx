import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FIELD_TYPES, type Collection, type Field, type FieldConfig, type JsonValue } from '../core/model';
import { fieldConfig, isText } from '../core/validation';
import { FieldInput } from './common';
export function FieldsEditor({
  collection,
  fields,
  save,
  remove,
  busy,
}: {
  collection: Collection;
  fields: Field[];
  save: (id: string | undefined, name: string, type: string, config: FieldConfig, position: number) => void;
  remove: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div>
      <div className="field-list">
        {fields.map((f) => (
          <div key={f.id}>
            <span>
              <b>{f.name}</b> <small>{t(`types.${f.type}`)}</small>
            </span>
            <button disabled={busy} onClick={() => setEditing(f.id)}>
              {t('edit')}
            </button>
          </div>
        ))}
      </div>
      <button disabled={busy} onClick={() => setEditing('new')}>
        + {t('newField')}
      </button>
      {editing && (
        <FieldEditor
          key={editing}
          field={fields.find((f) => f.id === editing)}
          count={fields.length}
          protectedField={editing === collection.primary_field_id || editing === collection.incoming_field_id}
          busy={busy}
          save={(...args) => save(editing === 'new' ? undefined : editing, ...args)}
          remove={() => remove(editing)}
          cancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
function FieldEditor({
  field,
  count,
  protectedField,
  save,
  remove,
  cancel,
  busy,
}: {
  field?: Field;
  count: number;
  protectedField: boolean;
  busy: boolean;
  save: (name: string, type: string, config: FieldConfig, position: number) => void;
  remove: () => void;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const config = field ? fieldConfig(field) : {};
  const [name, setName] = useState(field?.name ?? ''),
    [type, setType] = useState(field?.type ?? 'text');
  const [required, setRequired] = useState(config.required ?? false),
    [hint, setHint] = useState(config.hint ?? '');
  const [indexed, setIndexed] = useState(config.indexed ?? false),
    [fts, setFts] = useState(config.fts ?? true);
  const [hasDefault, setHasDefault] = useState(Object.hasOwn(config, 'default')),
    [value, setValue] = useState<JsonValue>(config.default ?? null);
  const [min, setMin] = useState(config.min == null ? '' : String(config.min)),
    [max, setMax] = useState(config.max == null ? '' : String(config.max));
  const [position, setPosition] = useState(field?.position ?? count);
  return (
    <form
      className="sub-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save(
          name,
          type,
          {
            required,
            hint,
            indexed,
            fts: isText(type) && fts,
            ...(hasDefault ? { default: value } : {}),
            ...(type === 'integer' && min !== '' ? { min: Number(min) } : {}),
            ...(type === 'integer' && max !== '' ? { max: Number(max) } : {}),
          },
          position
        );
      }}
    >
      <label>
        {t('fieldName')}
        <input
          autoFocus
          required
          maxLength={200}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {t('fieldType')}
        <select
          value={type}
          disabled={!!field || busy}
          onChange={(e) => {
            setType(e.target.value);
            setValue(null);
            setHasDefault(false);
          }}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`types.${type}`)}
            </option>
          ))}
        </select>
      </label>
      {field && <small>{t('stableFieldType')}</small>}
      <label className="check">
        <input
          type="checkbox"
          checked={required}
          disabled={busy}
          onChange={(e) => setRequired(e.target.checked)}
        />
        {t('required')}
      </label>
      <label>
        {t('hint')}
        <input maxLength={1000} value={hint} disabled={busy} onChange={(e) => setHint(e.target.value)} />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={hasDefault}
          disabled={busy}
          onChange={(e) => setHasDefault(e.target.checked)}
        />
        {t('useDefault')}
      </label>
      {hasDefault && (
        <FieldInput
          field={{ name: t('defaultValue'), type }}
          value={value}
          disabled={busy}
          change={setValue}
        />
      )}
      {type === 'integer' && (
        <div className="field-grid">
          <label className="half">
            {t('minimum')}
            <input
              type="number"
              step={1}
              value={min}
              disabled={busy}
              onChange={(e) => setMin(e.target.value)}
            />
          </label>
          <label className="half">
            {t('maximum')}
            <input
              type="number"
              step={1}
              value={max}
              disabled={busy}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={indexed}
          disabled={busy}
          onChange={(e) => setIndexed(e.target.checked)}
        />
        {t('indexed')}
      </label>
      {isText(type) && (
        <label className="check">
          <input type="checkbox" checked={fts} disabled={busy} onChange={(e) => setFts(e.target.checked)} />
          {t('fts')}
        </label>
      )}
      <label>
        {t('position')}
        <input
          type="number"
          min={0}
          step={1}
          value={position}
          disabled={busy}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <div className="actions">
        {field && (
          <button type="button" className="danger" disabled={busy || protectedField} onClick={remove}>
            {t('delete')}
          </button>
        )}
        <button type="button" disabled={busy} onClick={cancel}>
          {t('cancel')}
        </button>
        <button className="primary" disabled={busy || !name.trim()}>
          {t('saveField')}
        </button>
      </div>
    </form>
  );
}
