import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isText } from '../core/validation';
import type { InboxMapping } from '../core/inbox-mapping';
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
  save: (name: string, appearance: Appearance, position: number, primary: string, incoming: string, mapping: InboxMapping | null) => void;
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
  const initialMapping = entity && kind === 'collection' ? (JSON.parse(entity.config) as { inbox_mapping?: InboxMapping | null }).inbox_mapping : null;
  const [mapEnabled, setMapEnabled] = useState(!!initialMapping),
    [mapTitle, setMapTitle] = useState(initialMapping?.title_field_id ?? primary),
    [mapBody, setMapBody] = useState(initialMapping?.body_field_id ?? fields.find(field => isText(field.type) && field.id !== primary)?.id ?? '');
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(name, { icon, color }, position, primary, incoming, mapEnabled ? { title_field_id: mapTitle, body_field_id: mapBody } : null);
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
                .filter((f) => isText(f.type))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset disabled={busy}><legend>{t('inboxMarkdownMapping')}</legend>
            <label className="check"><input type="checkbox" checked={mapEnabled} onChange={event => setMapEnabled(event.target.checked)} />{t('splitInboxMarkdown')}</label>
            {mapEnabled && <>
              <label>{t('markdownTitleField')}<select required value={mapTitle} onChange={event => setMapTitle(event.target.value)}><option value="">{t('chooseField')}</option>
                {fields.filter(field => isText(field.type)).map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
              </select></label>
              <label>{t('markdownBodyField')}<select required value={mapBody} onChange={event => setMapBody(event.target.value)}><option value="">{t('chooseField')}</option>
                {fields.filter(field => isText(field.type) && field.id !== mapTitle).map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
              </select></label>
            </>}
          </fieldset>
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
