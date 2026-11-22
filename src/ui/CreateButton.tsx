import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import type { CreationChoice } from '../core/model';

export function CreateButton({ disabled, create, options, registerMenuClose }: { disabled: boolean; create: (choice?: CreationChoice) => void;
  registerMenuClose: (close: (() => void) | null) => void;
  options: { label: string; choice: CreationChoice }[] }) {
  const { t } = useTranslation(), [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), held = useRef(false);
  const stopHold = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    registerMenuClose(open && !disabled ? () => setOpen(false) : null);
    return () => registerMenuClose(null);
  }, [open, disabled, registerMenuClose]);
  return <div className="create-button" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
  }}>
    <div className="split-button">
      <button className="primary" title={'+ ' + t('newEntry')} aria-label={'+ ' + t('newEntry')} disabled={disabled} onClick={event => { if (event.detail === 0 || !held.current) { held.current = false; setOpen(false); create(); } }}
        onPointerDown={event => { if (event.button !== 0) return; held.current = false; timer.current = setTimeout(() => { held.current = true; setOpen(true); }, 550); }}
        onPointerUp={stopHold} onPointerCancel={stopHold} onPointerLeave={stopHold}
        onContextMenu={event => { event.preventDefault(); stopHold(); setOpen(true); }}
        onKeyDown={event => { if (event.key === 'ArrowDown' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setOpen(true); } }}>
        <Icon name="capture" /><span className="visually-hidden">+ </span><span className="create-button-label">{t('newEntry')}</span>
      </button>
      <button disabled={disabled} aria-label={t('creationAlternatives')} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>▾</button>
    </div>
    {open && !disabled && <div role="menu" aria-label={t('creationAlternatives')} className="creation-menu">
      {options.map((option, index) => <button role="menuitem" key={index} onClick={() => { setOpen(false); held.current = false; create(option.choice); }}>{option.label}</button>)}
    </div>}
  </div>;
}
