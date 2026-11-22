import { useRef, useState, type PointerEvent } from 'react';
import type { Field } from '../core/model';

/** Preview reorders UI fields only. It never writes a record or a repository event. */
export function HybridPreviewField({ field, value, selected, disabled, select, move }: {
  field: Field; value: string; selected: boolean; disabled: boolean;
  select: () => void; move: (from: string, to: string) => void;
}) {
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState(false);
  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    pointer.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!pointer.current) return;
    const current = pointer.current;
    if (!current.moved && Math.abs(current.x - event.clientX) + Math.abs(current.y - event.clientY) < 10) return;
    current.moved = true;
    const hover = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-preview-field]');
    setDropTarget(hover?.dataset.previewField === field.id);
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = pointer.current;
    pointer.current = null;
    setDropTarget(false);
    if (!current?.moved || disabled) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-preview-field]')?.dataset.previewField;
    if (target && target !== field.id) move(field.id, target);
  }
  return <div className={'hybrid-preview-block' + (selected ? ' selected' : '') + (dropTarget ? ' drop-target' : '')}
    data-preview-field={field.id}
    onDragOver={event => {
      if (!disabled && event.dataTransfer.types.includes('application/x-tessera-preview-field')) {
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(true);
      }
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(false); }}
    onDrop={event => {
      event.preventDefault();
      const source = event.dataTransfer.getData('application/x-tessera-preview-field');
      if (source && source !== field.id && !disabled) move(source, field.id);
      setDropTarget(false);
    }}>
    <button type="button" className="hybrid-preview-field" disabled={disabled} onClick={select}>
      <small>{field.name}</small><span>{value}</span>
    </button>
    <button type="button" className="hybrid-preview-drag" draggable={!disabled} disabled={disabled}
      aria-label={field.name} title={field.name}
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-tessera-preview-field', field.id); }}
      onDragEnd={() => setDropTarget(false)}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={() => { pointer.current = null; setDropTarget(false); }}>
      ⠿
    </button>
  </div>;
}
