import type { CSSProperties, ReactNode } from 'react';
import type { Field, LayoutItem, LayoutRow, UiDefinition } from '../core/model';
import { layoutItems, layoutRows } from '../core/ui-definition';
import { Icon } from './Icon';

const blocks = new Set(['markdown', 'multiline', 'json', 'image', 'file', 'relation', 'backlink']);

export function FieldSections({ definition, fields, label, render }: {
  definition: UiDefinition; fields: Field[]; label: (field: Field) => string; render: (item: LayoutItem) => ReactNode;
}) {
  const items = new Map(layoutItems(definition, fields).map(item => [item.field_id, item]));
  const byId = new Map(fields.map(field => [field.id, field]));
  const groups: { title?: string; standalone: boolean; rows: LayoutRow[] }[] = [];
  for (const row of layoutRows(definition, fields)) {
    const first = byId.get(row.field_ids[0]!)!;
    const group = row.group || items.get(first.id)?.group;
    const standalone = !group && row.field_ids.length === 1 && blocks.has(first.type);
    const title = group || (standalone ? label(first) : undefined);
    const previous = groups.at(-1);
    if (previous && previous.title === title && !standalone && !previous.standalone) previous.rows.push(row);
    else groups.push({title, standalone, rows: [row]});
  }
  return <div className="field-sections">{groups.map(({title, rows, standalone}) => {
    const content = rows.map(row => <div key={row.id} className="layout-row" data-layout-row={row.id}
      style={{'--layout-columns': row.columns} as CSSProperties}>
      {row.field_ids.map(id => {
        const item = items.get(id)!;
        return item.collapsed ? <details key={id} className="layout-cell"><summary>{label(byId.get(id)!)}</summary>{render(item)}</details>
          : <div key={id} className="layout-cell">{render(item)}</div>;
      })}
    </div>);
    return title ? <details key={rows[0]!.id} className="field-block" data-standalone={standalone} data-kind={standalone ? byId.get(rows[0]!.field_ids[0]!)?.type : undefined} open>
      <summary><Icon name={standalone ? (["file","image"].includes(byId.get(rows[0]!.field_ids[0]!)!.type) ? "attachment" : byId.get(rows[0]!.field_ids[0]!)!.type === "markdown" ? "checklist" : "document") : "collection"}/>{title}</summary>{content}
    </details> : <section className="properties" key={rows[0]!.id}>{content}</section>;
  })}</div>;
}
