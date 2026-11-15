import type { CSSProperties, ReactNode } from 'react';
import type { Field, LayoutItem, LayoutRow, UiDefinition } from '../core/model';
import { layoutItems, layoutRows } from '../core/ui-definition';

/** Rendering only: visibility and collapse never remove field values from the form state. */
export function LayoutRowsView({ definition, fields, render, label = field => field.name }: {
  definition: UiDefinition; fields: Field[]; render: (item: LayoutItem) => ReactNode; label?: (field: Field) => string;
}) {
  const items = new Map(layoutItems(definition, fields).map(item => [item.field_id, item]));
  const sections: { group?: string; rows: LayoutRow[] }[] = [];
  for (const row of layoutRows(definition, fields)) {
    const last = sections.at(-1);
    if (row.group && last?.group === row.group) last.rows.push(row);
    else sections.push({ group: row.group, rows: [row] });
  }
  const rowView = (row: LayoutRow) => <div key={row.id} className="layout-row" data-layout-row={row.id} style={{ '--layout-columns': row.columns } as CSSProperties}>
    {row.field_ids.map(id => {
      const item = items.get(id)!, field = fields.find(field => field.id === id)!;
      return item.collapsed ? <details key={id} className="layout-cell collapsed-field"><summary>{label(field)}</summary>{render(item)}</details>
        : <div key={id} className="layout-cell">{render(item)}</div>;
    })}
  </div>;
  return <div className="layout-rows">{sections.map(section => section.group ?
    <fieldset key={section.rows[0]!.id} className="layout-group"><legend>{section.group}</legend>{section.rows.map(rowView)}</fieldset>
    : section.rows.map(rowView))}</div>;
}
