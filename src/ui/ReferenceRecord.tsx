import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const properties: ReactNode[] = [];
  const sections: { id: string; title: string; nodes: ReactNode[] }[] = [];
  function fieldNode(id: string) {
    const item = configured.get(id)!, field = byId.get(id)!;
    if (item.collapsed) return <details key={id} className="reference-collapsed-field">
      <summary>{label(field)}</summary>{render(item)}
    </details>;
    return <div className="reference-field" key={id}>{render(item)}</div>;
  }
  for (const row of layoutRows(definition, fields)) {
    for (const id of row.field_ids) {
      const field = byId.get(id)!;
      const item = configured.get(id)!;
      const groupName = row.group || item.group;
      const isSection = !!groupName || longTypes.has(field.type);
      if (!isSection) {
        properties.push(<div className="reference-property" key={id}>{fieldNode(id)}</div>);
        continue;
      }
      const title = groupName || label(field);
      // Consecutive rows in the same named group form a single visual section.
      let last = sections.at(-1);
      if (!last || last.title !== title || !groupName) {
        last = { id: id, title, nodes: [] };
        sections.push(last);
      }
      last.nodes.push(<div className="reference-section-item" key={id}>{fieldNode(id)}</div>);
    }
  }
  return <div className="reference-record-fields">
    {properties.length > 0 && <div className="reference-property-sheet">{properties}</div>}
    {sections.map(section => <section className="reference-record-section" key={section.id}>
      <h2>{section.title}</h2>
      <div className="reference-section-body">{section.nodes}</div>
    </section>)}
  </div>;
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
