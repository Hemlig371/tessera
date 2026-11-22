import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Field, LayoutRow } from '../core/model';

export function LayoutRowsEditor({ rows, fields, busy, change }: {
  rows: LayoutRow[]; fields: Field[]; busy: boolean; change: (rows: LayoutRow[]) => void;
}) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  function columns(index: number, count: LayoutRow['columns']) {
    const current = rows[index]!, chunks: LayoutRow[] = [];
    for (let offset = 0; offset < Math.max(current.field_ids.length, 1); offset += count)
      chunks.push({ ...current, id: offset ? crypto.randomUUID() : current.id, columns: count, field_ids: current.field_ids.slice(offset, offset + count) });
    change([...rows.slice(0, index), ...chunks, ...rows.slice(index + 1)]);
  }
  function assign(index: number, slot: number, id: string) {
    const old = rows[index]!.field_ids[slot];
    const next = rows.map((row, rowIndex) => ({ ...row, field_ids: row.field_ids.flatMap((value, columnIndex) => {
      if (rowIndex === index && columnIndex === slot) return id ? [id] : [];
      if (id && value === id) return old ? [old] : [];
      return [value];
    }) }));
    if (slot >= rows[index]!.field_ids.length && id) next[index]!.field_ids.push(id);
    change(next);
  }
  function move(index: number, offset: number) {
    const next = [...rows], [row] = next.splice(index, 1); next.splice(index + offset, 0, row!); change(next);
  }
  function dropOn(target: string) {
    const from = rows.findIndex(row => row.id === draggedId);
    const to = rows.findIndex(row => row.id === target);
    if (from !== -1 && to !== -1 && from !== to && !busy) move(from, to - from);
    setDraggedId(null);
    setTargetId(null);
  }
  return <section className="layout-designer" aria-label={t('rowDesigner')}>
    <h3>{t('rowDesigner')}</h3><p>{t('rowDesignerHint')}</p>
    {rows.map((row, index) => <fieldset key={row.id} disabled={busy} className={'row-designer' + (targetId === row.id && draggedId !== row.id ? ' drop-target' : '')} data-row-id={row.id}
      onDragOver={event => { if (!busy && draggedId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTargetId(row.id); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setTargetId(null); }}
      onDrop={event => { event.preventDefault(); dropOn(row.id); }}>
      <legend>{t('layoutRow', { count: index + 1 })}</legend>
      <div className="row-designer-tools">
        <button type="button" className="row-drag-handle" draggable={!busy} disabled={busy} title={t('dragLayoutRow')}
          aria-label={t('dragLayoutRow')}
          onDragStart={event => { setDraggedId(row.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.id); }}
          onDragEnd={() => { setDraggedId(null); setTargetId(null); }}>⠿</button>
        <label>{t('columnCount')}<select value={row.columns} onChange={event => columns(index, Number(event.target.value) as LayoutRow['columns'])}>
          {[1,2,3].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>{t('fieldGroup')}<input maxLength={200} value={row.group ?? ''} onChange={event => change(rows.map((value, at) => at === index ? { ...value, group: event.target.value } : value))} /></label>
        <button type="button" disabled={busy || index === 0} aria-label={t('moveRowUp', { count: index + 1 })} onClick={() => move(index, -1)}>↑</button>
        <button type="button" disabled={busy || index === rows.length - 1} aria-label={t('moveRowDown', { count: index + 1 })} onClick={() => move(index, 1)}>↓</button>
        <button type="button" onClick={() => change(rows.filter((_, at) => at !== index))}>{t('removeLayoutRow')}</button>
      </div>
      <div className="layout-row row-designer-cells" style={{ '--layout-columns': row.columns } as CSSProperties}>
        {Array.from({ length: Math.min(row.columns, row.field_ids.length + 1) }, (_, slot) => <label key={slot}>{t('layoutCell', { count: slot + 1 })}
          <select value={row.field_ids[slot] ?? ''} onChange={event => assign(index, slot, event.target.value)}>
            <option value="">{t('emptyLayoutCell')}</option>
            {fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
          </select>
          <small>{row.field_ids[slot] ? t(`types.${fields.find(field => field.id === row.field_ids[slot])?.type}`) : ''}</small>
        </label>)}
      </div>
    </fieldset>)}
    <button type="button" disabled={busy} onClick={() => change([...rows, { id: crypto.randomUUID(), columns: 1, field_ids: [] }])}>{t('addLayoutRow')}</button>
  </section>;
}
