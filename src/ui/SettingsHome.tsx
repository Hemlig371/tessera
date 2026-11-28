import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

type Destination = 'mail-sync' | 'appearance' | 'file-settings' | 'large-attachments' | 'diagnostics' | 'history-clear';
interface Props {
  busy:boolean; appearanceReady:boolean; mail:boolean;
  open:(target:Destination) => void; trash:() => void; archive?:() => void;
}
export function SettingsHome({busy, appearanceReady, mail, open, trash, archive}: Props) {
  const {t,i18n} = useTranslation();
  function row(title:string, icon:ComponentProps<typeof Icon>['name'], action:()=>void, disabled=busy) {
    return <button type="button" className="settings-row" disabled={disabled} onClick={action}>
      <Icon name={icon}/><span>{t(title)}</span><Icon name="chevron"/>
    </button>;
  }
  return <div className="settings-page">
    <section className="settings-section"><h2>{t('hybridSettingsAppearance')}</h2>
      {row('deviceAppearance','appearance',()=>open('appearance'),busy || !appearanceReady)}
      <label className="settings-language">{t('language')}<select value={i18n.language} onChange={e=>void i18n.changeLanguage(e.target.value)}>
        <option value="ru">{t('languageRussian')}</option><option value="en">{t('languageEnglish')}</option>
      </select></label>
    </section>
    <section className="settings-section"><h2>{t('hybridSettingsSync')}</h2>
      {mail ? row('mailSyncTitle','inbox',()=>open('mail-sync')) : <p className="screen-hint">{t('hybridSettingsNativeOnly')}</p>}
    </section>
    <section className="settings-section"><h2>{t('hybridSettingsStorage')}</h2>
      {archive && row('databaseArchive','archive',archive)}
      {row('fileSettings','settings',()=>open('file-settings'))}
      {row('largeAttachmentsTitle','document',()=>open('large-attachments'))}
      {row('trash','trash',trash)}
      {row('diagnosticsTitle','tools',()=>open('diagnostics'))}
      {row('clearAllHistory','clock',()=>open('history-clear'))}
    </section>
  </div>;
}
