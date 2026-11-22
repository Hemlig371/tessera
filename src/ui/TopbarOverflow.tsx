import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

export interface OverflowAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
  pressed?: boolean;
}

/** Keyboard/touch-accessible compact tools. The actions themselves remain
 * existing App callbacks; this component never writes library or record data. */
export function TopbarOverflow({ actions, registerClose }: {
  actions: OverflowAction[];
  registerClose: (close: (() => void) | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    registerClose(open ? () => { setOpen(false); button.current?.focus({ preventScroll: true }); } : null);
    return () => registerClose(null);
  }, [open, registerClose]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        setOpen(false);
        button.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return <div className="tessera-topbar-overflow" ref={host}>
    <button ref={button} className="icon-button tessera-overflow-trigger" type="button"
      aria-haspopup="menu" aria-expanded={open} aria-label={t('moreActions')}
      title={t('moreActions')} onClick={() => setOpen(value => !value)}>
      <Icon name="more" />
    </button>
    {open && <div className="tessera-overflow-popover" role="menu" aria-label={t('moreActions')}>
      {actions.map(action => <button type="button" role="menuitem" key={action.id}
        disabled={action.disabled} aria-current={action.pressed ? 'true' : undefined}
        onClick={() => { setOpen(false); action.run(); }}>
        <span className="tessera-overflow-action-icon" aria-hidden="true">{action.icon}</span>
        <span>{action.label}</span>
        {action.pressed && <Icon name="check" />}
      </button>)}
    </div>}
  </div>;
}
