import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationChoice, CreationPreset, Field, PresetDefinition, RecordData } from '../core/model';
import type { Repository } from '../core/repository';
import { localTimestamp } from '../core/model';
import { FieldInput } from './common';
import { RelationInput } from './RelationInput';

export function PresetsEditor({ api, presets, fields, choice, busy, setChoice, save, remove }: {
  api: Repository; presets: CreationPreset[]; fields: Field[]; choice: CreationChoice; busy: boolean;
  setChoice: (choice: CreationChoice) => void;
  save: (id: string | null, name: string, position: number, definition: PresetDefinition, makeDefault: boolean) => void;
  remove: (id: string) => void;
}) {
  const { t } = useTranslation(), [selected, setSelected] = useState(presets[0]?.id ?? 'new');
  const current = presets.find(preset => preset.id === selected);
  return <>
    <DefaultCreation key={JSON.stringify(choice)} {...{ choice, presets, busy }} save={setChoice} />
    <label>{t('presetToConfigure')}<select disabled={busy} value={current?.id ?? 'new'} onChange={event => setSelected(event.target.value)}>
      <option value="new">{t('newPreset')}</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select></label>
    <PresetProperties key={current ? current.id + current.hlc : 'new'} {...{ api, fields, busy }} preset={current}
      isDefault={!!current && choice.kind === 'preset' && choice.preset_id === current.id}
      save={(name, position, definition, makeDefault) => save(current?.id ?? null, name, position, definition, makeDefault)} />
    {current && <button disabled={busy} onClick={() => remove(current.id)}>{t('deletePreset')}</button>}
  </>;
}
function DefaultCreation({ choice, presets, busy, save }: { choice: CreationChoice; presets: CreationPreset[]; busy: boolean; save: (choice: CreationChoice) => void }) {
  const { t } = useTranslation(), [value, setValue] = useState(choice.kind === 'preset' ? choice.preset_id : choice.kind);
  return <form onSubmit={event => { event.preventDefault(); save(value === 'standard' || value === 'quick' ? { kind: value } : { kind: 'preset', preset_id: value }); }}>
    <label>{t('defaultCreation')}<select value={value} disabled={busy} onChange={event => setValue(event.target.value)}>
      <option value="standard">{t('standardForm')}</option><option value="quick">{t('quickEntry')}</option>
      {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select></label><button disabled={busy}>{t('saveDefaultCreation')}</button>
  </form>;
}
function PresetProperties({ api, fields, preset, isDefault, busy, save }: { api: Repository; fields: Field[]; preset?: CreationPreset; isDefault: boolean; busy: boolean;
  save: (name: string, position: number, definition: PresetDefinition, makeDefault: boolean) => void }) {
  const { t } = useTranslation(), [name, setName] = useState(preset?.name ?? ''), [position, setPosition] = useState(preset?.position ?? 0), [makeDefault, setMakeDefault] = useState(false);
  const [definition, setDefinition] = useState<PresetDefinition>(() => preset ? JSON.parse(preset.config) as PresetDefinition : { form: 'standard', data: {}, today_fields: [] });
  function include(field: Field, enabled: boolean) {
    setDefinition(old => {
      const data = { ...old.data }, today_fields = old.today_fields.filter(id => id !== field.id);
      if (!enabled) delete data[field.id];
      else data[field.id] = field.type === 'integer' ? 0 : field.type === 'boolean' ? false : field.type === 'date' ? localTimestamp(new Date()).slice(0,10) : field.type === 'relation' ? null : '';
      return { ...old, data, today_fields };
    });
  }
  function change(id: string, value: RecordData[string]) { setDefinition(old => ({ ...old, data: { ...old.data, [id]: value } })); }
  return <form onSubmit={event => { event.preventDefault(); save(name, position, definition, makeDefault); }}>
    <label>{t('presetName')}<input required maxLength={200} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>{t('position')}<input type="number" min={0} step={1} required disabled={busy} value={position} onChange={event => setPosition(Number(event.target.value))} /></label>
    <label>{t('presetForm')}<select disabled={busy} value={definition.form} onChange={event => setDefinition(old => ({ ...old, form: event.target.value as PresetDefinition['form'] }))}>
      <option value="standard">{t('standardForm')}</option><option value="quick">{t('quickEntry')}</option>
    </select></label>
    <label className="check"><input type="checkbox" disabled={busy || isDefault} checked={isDefault || makeDefault} onChange={event => setMakeDefault(event.target.checked)} />{t('usePresetByDefault')}</label>
    <p>{t('presetValuesHint')}</p>
    {fields.filter(field => !['backlink','secret'].includes(field.type)).map(field => {
      const today = definition.today_fields.includes(field.id), included = today || Object.hasOwn(definition.data, field.id);
      return <fieldset key={field.id} disabled={busy}><legend>{field.name}</legend>
        <label className="check"><input type="checkbox" checked={included} onChange={event => include(field, event.target.checked)} />{t('presetInclude')}</label>
        {included && <>
          {field.type === 'date' && <label className="check"><input type="checkbox" checked={today} onChange={event => setDefinition(old => {
            const data = { ...old.data }, today_fields = old.today_fields.filter(id => id !== field.id);
            if (event.target.checked) { delete data[field.id]; today_fields.push(field.id); }
            else data[field.id] = localTimestamp(new Date()).slice(0,10);
            return { ...old, data, today_fields };
          })} />{t('presetToday')}</label>}
          {!today && (field.type === 'relation' ? <RelationInput api={api} field={field} value={definition.data[field.id]} disabled={busy} change={value => change(field.id, value)} /> :
            <FieldInput field={field} value={definition.data[field.id]} disabled={busy} change={value => change(field.id, value)} />)}
        </>}
      </fieldset>;
    })}
    {[...new Set([...Object.keys(definition.data), ...definition.today_fields])].filter(id => !fields.some(field => field.id === id && !['backlink','secret'].includes(field.type))).map(id => <p key={id}>{t('presetUnknownField', { id })}
      <button type="button" disabled={busy} onClick={() => setDefinition(old => { const data = { ...old.data }; delete data[id]; return { ...old, data, today_fields: old.today_fields.filter(fieldId => fieldId !== id) }; })}>{t('presetRemoveValue')}</button></p>)}
    <button disabled={busy} className="primary">{t('savePreset')}</button>
  </form>;
}
