import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Field, LayoutItem, UiDefinition } from '../core/model';
import { layoutItems, layoutRows } from '../core/ui-definition';
import { Icon } from './Icon';

const longTypes = new Set(['markdown', 'multiline', 'json', 'file', 'image', 'relation', 'backlink']);

/** Record reading composition independent of the schema editor.
 * Uses the existing named card definition, field visibility, row ordering,
 * user groups and collapsed flags. Never persists or rewrites a layout. */
export function ReferenceRecordFields({ definition, fields, label, render }: {
  definition: UiDefinition; fields: Field[];
  label: (field: Field) => string; render: (item: LayoutItem) => ReactNode;
}) {
  const byId = new Map(fields.map(field => [field.id, field]));
  const configured = new Map(layoutItems(definition, fields).map(item => [item.field_id, item]));
  const sections: {id: string; title?: string; rows: ReactNode[]}[] = [];
  for (const row of layoutRows(definition, fields)) {
    const first = byId.get(row.field_ids[0]!);
    if (!first) continue;
    const group = row.group || configured.get(first.id)?.group;
    const standalone = !group && row.field_ids.length === 1 && longTypes.has(first.type);
    const title = group || (standalone ? label(first) : undefined);
    let section = sections.at(-1);
    if (!section || section.title !== title || standalone) {
      section = {id: row.id, title, rows: []};
      sections.push(section);
    }
    section.rows.push(<div key={row.id} className="layout-row" style={{'--layout-columns': row.columns} as CSSProperties}>
      {row.field_ids.map(id => {
        const item = configured.get(id)!, field = byId.get(id)!;
        return item.collapsed ? <details className="layout-cell" key={id}><summary>{label(field)}</summary>{render(item)}</details>
          : <div className={'layout-cell' + (standalone ? ' section-value' : '')} key={id}>{render(item)}</div>;
      })}
    </div>);
  }
  return <div className="record-sections">{sections.map(section => section.title
    ? <details key={section.id} className="record-section" open><summary>{section.title}</summary>{section.rows}</details>
    : <div key={section.id} className="property-sheet">{section.rows}</div>)}</div>;
}

/** The edit action is first-class; history and destructive actions are
 * available through a deliberate, keyboard-accessible overflow. */
export function ReferenceRecordActions({ disabled, edit, history, remove, move }: {
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
