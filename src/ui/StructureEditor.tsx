import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Appearance, Collection, Field, Library } from '../core/model';
export function StructureEditor({
  kind,
  entity,
  fields,
  save,
  remove,
  cancel,
  busy,
}: {
  kind: 'library' | 'collection';
  entity?: Library | Collection;
  fields: Field[];
  save: (name: string, appearance: Appearance, position: number, primary: string, incoming: string) => void;
  remove: () => void;
  cancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const appearance = entity ? (JSON.parse(entity.config) as Appearance) : {};
  const [name, setName] = useState(entity?.name ?? ''),
    [icon, setIcon] = useState(appearance.icon ?? '◇');
  const [color, setColor] = useState(appearance.color ?? '#126c5d'),
    [position, setPosition] = useState(entity?.position ?? 0);
  const [primary, setPrimary] = useState(
    entity && 'primary_field_id' in entity ? entity.primary_field_id : ''
  );
  const [incoming, setIncoming] = useState(
    entity && 'incoming_field_id' in entity ? entity.incoming_field_id : ''
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(name, { icon, color }, position, primary, incoming);
      }}
    >
      <label>
        {t(kind === 'library' ? 'libraryName' : 'collectionName')}
        <input
          autoFocus
          required
          maxLength={200}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field-grid">
        <label className="half">
          {t('icon')}
          <input maxLength={16} value={icon} onChange={(e) => setIcon(e.target.value)} disabled={busy} />
        </label>
        <label className="half">
          {t('color')}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={busy} />
        </label>
      </div>
      {entity && (
        <label>
          {t('position')}
          <input
            type="number"
            min={0}
            step={1}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            disabled={busy}
          />
        </label>
      )}
      {entity && kind === 'collection' && (
        <>
          <label>
            {t('primaryField')}
            <select value={primary} onChange={(e) => setPrimary(e.target.value)} disabled={busy}>
              {fields
                .filter((f) => f.type === 'text')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('incomingField')}
            <select value={incoming} onChange={(e) => setIncoming(e.target.value)} disabled={busy}>
              {fields
                .filter((f) => f.type === 'text' || f.type === 'multiline')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <div className="actions">
        {entity && (
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            {t('delete')}
          </button>
        )}
        <button type="button" disabled={busy} onClick={cancel}>
          {t('cancel')}
        </button>
        <button className="primary" disabled={busy || !name.trim()}>
          {t(entity ? 'save' : 'create')}
        </button>
      </div>
    </form>
  );
}
