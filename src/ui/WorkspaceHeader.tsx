import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { TopbarOverflow, type OverflowAction } from './TopbarOverflow';

interface Props {
  title: string;
  subtitle?: string;
  icon?: string;
  color?: string;
  back?: () => void;
  backLabel: string;
  search?: () => void;
  disabled: boolean;
  menu: OverflowAction[];
  registerClose: (close: (() => void) | null) => void;
}

export function WorkspaceHeader({ title, subtitle, icon, color, back, backLabel, search, disabled, menu, registerClose }: Props) {
  const { t } = useTranslation();
  return <header className="workspace-header">
    {back && <button className="icon-button" aria-label={backLabel} disabled={disabled} onClick={back}><Icon name="back" /></button>}
    <span className={'workspace-mark' + (!back ? ' brand-symbol' : '')} aria-hidden="true" style={{color}}>
      {icon && icon !== '◇' ? icon : <Icon name={back ? 'collection' : 'libraries'} />}
    </span>
    <div className="workspace-identity"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
    {search && <button className="icon-button" aria-label={t('globalSearch')} disabled={disabled} onClick={search}><Icon name="search" /></button>}
    <TopbarOverflow actions={menu} registerClose={registerClose} />
  </header>;
}
