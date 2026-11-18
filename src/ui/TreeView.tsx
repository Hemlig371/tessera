import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TreeRow } from '../core/tree-projection';
import type { EntryListItem } from '../core/model';

export function TreeView({ rows, busy, loading, error, open }: {
  rows: readonly TreeRow<EntryListItem>[]; busy: boolean; loading: boolean; error: string | null; open: (id: string) => void;
}) {
  const { t } = useTranslation(), scroll = useRef<HTMLDivElement>(null), [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { visible, children } = useMemo(() => {
    const children = new Set(rows.filter(row => row.parent_id).map(row => row.parent_id!)), visible: TreeRow<EntryListItem>[] = [];
    let hiddenDepth: number | null = null;
    for (const row of rows) {
      if (hiddenDepth != null && row.depth > hiddenDepth) continue;
      hiddenDepth = null; visible.push(row); if (collapsed.has(row.entry.id)) hiddenDepth = row.depth;
    }
    return { visible, children };
  }, [rows, collapsed]);
  // TanStack Virtual is intentionally not memoized by React Compiler, as in the main list.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({ count: visible.length, getScrollElement: () => scroll.current, estimateSize: () => 76, getItemKey: index => visible[index]!.entry.id, overscan: 6 });
  return <section className="collection-tree" aria-label={t('tree')} data-testid="collection-tree" aria-busy={loading}>
    <div className="tree-toolbar"><button type="button" disabled={busy} onClick={() => setCollapsed(new Set())}>{t('expandAll')}</button><button type="button" disabled={busy} onClick={() => setCollapsed(new Set(children))}>{t('collapseAll')}</button></div>
    {error ? <p role="alert">{t('errors.' + error, { defaultValue: t('errors.unexpected') })}</p> : loading ? <p role="status">{t('loadingEntries')}</p> : !rows.length ? <p>{t('noEntries')}</p> : <div className="tree-scroll" ref={scroll} role="list">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>{virtual.getVirtualItems().map(item => {
        const row = visible[item.index]!, hasChildren = children.has(row.entry.id), expanded = !collapsed.has(row.entry.id);
        return <div role="listitem" data-index={item.index} data-depth={row.depth} key={row.entry.id} ref={virtual.measureElement} className="tree-row" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)`, paddingInlineStart: Math.min(row.depth, 4) * 14 }}>
          {hasChildren ? <button type="button" className="tree-toggle" disabled={busy} aria-expanded={expanded} aria-label={t(expanded ? 'collapseBranch' : 'expandBranch', { name: row.entry.title || t('unset') })} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(row.entry.id)) next.delete(row.entry.id); else next.add(row.entry.id); return next; })}>{expanded ? '▾' : '▸'}</button> : <span className="tree-spacer" aria-hidden="true" />}
          <div className="tree-content"><button type="button" data-entry-id={row.entry.id} disabled={busy} onClick={() => open(row.entry.id)}>{row.entry.title || t('unset')}</button>
            {(row.cycle || row.missing_parent || row.depth > 4) && <small>{[row.cycle ? t('treeCycle') : '', row.missing_parent ? t('treeMissingParent') : '', row.depth > 4 ? t('treeDepth', { count: row.depth }) : ''].filter(Boolean).join(' · ')}</small>}
          </div>
        </div>;
      })}</div>
    </div>}
  </section>;
}
