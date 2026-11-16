import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceAppearance } from '../core/device-appearance';

export function DeviceAppearanceEditor({ value, busy, save, cancel }: {
  value: DeviceAppearance; busy: boolean; save: (value: DeviceAppearance) => void; cancel: () => void;
}) {
  const { t } = useTranslation(), [draft, setDraft] = useState(value);
  return <form className="settings-form" onSubmit={event => { event.preventDefault(); save(draft); }}>
    <p className="screen-hint">{t('deviceAppearanceHint')}</p>
    <div className="settings-grid">
    <label>{t('theme')}<select disabled={busy} value={draft.theme} onChange={event => setDraft(old => ({ ...old, theme: event.target.value as DeviceAppearance['theme'] }))}>
      {(['system','light','dark'] as const).map(theme => <option key={theme} value={theme}>{t(`themes.${theme}`)}</option>)}
    </select></label>
    <label>{t('density')}<select disabled={busy} value={draft.density} onChange={event => setDraft(old => ({ ...old, density: event.target.value as DeviceAppearance['density'] }))}>
      <option value="comfortable">{t('densityComfortable')}</option><option value="compact">{t('densityCompact')}</option>
    </select></label>
    <label>{t('fontScale')}<select disabled={busy} value={draft.font_scale} onChange={event => setDraft(old => ({ ...old, font_scale: Number(event.target.value) }))}>
      {[1,1.15,1.3,1.5].map(scale => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}
    </select></label>
    <label>{t('librariesLayout')}<select disabled={busy} value={draft.libraries_layout} onChange={event => setDraft(old => ({ ...old, libraries_layout: event.target.value as DeviceAppearance['libraries_layout'] }))}>
      <option value="cards">{t('catalogCards')}</option><option value="list">{t('catalogList')}</option>
    </select></label>
    </div>
    <div className="form-actions"><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button className="primary" disabled={busy}>{t('saveDeviceAppearance')}</button></div>
  </form>;
}
