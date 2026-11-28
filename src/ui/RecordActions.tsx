import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Icon} from './Icon';

export function RecordActions({ disabled, edit, history, remove, move }: {
  disabled: boolean; edit: () => void; history: () => void; remove: () => void; move?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  const action = (call: () => void) => { setOpen(false); call(); };
  return <div className="reference-record-actions" ref={ref}>
    <button className="reference-record-more-button" type="button" disabled={disabled} title={t('moreActions')}
      aria-label={t('moreActions')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" /></button>
    {open && <div className="reference-record-more-menu" role="menu" aria-label={t('moreActions')}>
      {move && <button role="menuitem" type="button" disabled={disabled} onClick={() => action(move)}>{t('moveFromInbox')}</button>}
      <button role="menuitem" type="button" disabled={disabled} onClick={() => action(history)}><Icon name="clock" />{t('recordHistory')}</button>
      <button role="menuitem" type="button" className="danger" disabled={disabled} onClick={() => action(remove)}><Icon name="trash" />{t('delete')}</button>
    </div>}
    <button className="tessera-record-edit reference-record-edit" type="button" disabled={disabled} onClick={edit} aria-label={t('edit')}><Icon name="edit" /><span>{t('edit')}</span></button>
  </div>;
}
