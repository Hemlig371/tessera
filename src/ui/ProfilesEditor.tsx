import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayProfile, NamedCardLayout, UiDefinition } from '../core/model';

export function ProfilesEditor({ profiles, defaultId, cardLayouts, busy, create, update, remove, cancel }: {
  profiles: DisplayProfile[]; defaultId: string | null; cardLayouts: NamedCardLayout[]; busy: boolean;
  create: (name: string) => void;
  update: (id: string, patch: { name: string; position: number; make_default: boolean; detail_layout_id: string }) => void;
  remove: (id: string) => void; cancel: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(defaultId), [newName, setNewName] = useState('');
  const current = profiles.find(profile => profile.id === selected) ?? profiles[0];
  return <div className="profiles-editor">
    <label>{t('profileToConfigure')}<select disabled={busy} value={current?.id ?? ''} onChange={event => setSelected(event.target.value)}>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select></label>
    <div className="configuration-layout">{current && <ProfileProperties key={current.id + current.hlc + defaultId} profile={current} isDefault={current.id === defaultId}
      busy={busy} cardLayouts={cardLayouts} save={patch => update(current.id, patch)} remove={() => remove(current.id)} canRemove={profiles.length > 1} />}
    <form className="configuration-secondary" onSubmit={event => { event.preventDefault(); create(newName); }}>
      <h2>{t('newDisplayProfile')}</h2><p className="screen-hint">{t('profileCopyHint')}</p>
      <label>{t('profileName')}<input required maxLength={200} disabled={busy} value={newName} onChange={event => setNewName(event.target.value)} /></label>
      <button disabled={busy} className="primary">{t('createDisplayProfile')}</button>
    </form></div>
    <div className="form-actions"><button disabled={busy} onClick={cancel}>{t('close')}</button></div>
  </div>;
}
function ProfileProperties({ profile, isDefault, busy, cardLayouts, save, remove, canRemove }: {
  profile: DisplayProfile; isDefault: boolean; busy: boolean; canRemove: boolean; cardLayouts: NamedCardLayout[];
  save: (patch: { name: string; position: number; make_default: boolean; detail_layout_id: string }) => void; remove: () => void;
}) {
  const { t } = useTranslation();
  const linked = (JSON.parse(profile.config) as UiDefinition).detail_layout_id ?? '';
  const [name, setName] = useState(profile.name), [position, setPosition] = useState(profile.position), [makeDefault, setMakeDefault] = useState(isDefault),
    [detailLayoutId, setDetailLayoutId] = useState(linked);
  return <form className="configuration-properties" onSubmit={event => { event.preventDefault(); save({ name, position, make_default: makeDefault, detail_layout_id: detailLayoutId }); }}>
    <h2 title={profile.name}>{profile.name}</h2>
    <label>{t('profileName')}<input required maxLength={200} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>{t('position')}<input type="number" min={0} step={1} required disabled={busy} value={position} onChange={event => setPosition(Number(event.target.value))} /></label>
    <label>{t('profileDetailLayout')}<select disabled={busy} value={cardLayouts.some(card => card.id === detailLayoutId) ? detailLayoutId : ''} onChange={event => setDetailLayoutId(event.target.value)}>
      <option value="">{t('defaultCardLayout')}</option>
      {cardLayouts.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
    </select></label>
    <label className="check"><input type="checkbox" checked={makeDefault} disabled={busy || isDefault} onChange={event => setMakeDefault(event.target.checked)} />{t('defaultDisplayProfile')}</label>
    <div className="actions"><button className="primary" disabled={busy}>{t('saveDisplayProfile')}</button>
      <button className="danger" type="button" disabled={busy || !canRemove} onClick={remove}>{t('deleteDisplayProfile')}</button></div>
  </form>;
}
