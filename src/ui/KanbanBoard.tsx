import { useTranslation } from 'react-i18next';
import type { KanbanColumn } from '../core/kanban-projection';
import type { EntryListItem, JsonValue } from '../core/model';

export function KanbanBoard({ columns, busy, loading, error, open, move, showColumn }: {
  columns: readonly KanbanColumn[]; busy: boolean; loading: boolean; error: string | null;
  open: (id: string) => void; move: (entry: EntryListItem, value: JsonValue) => void; showColumn: (column: KanbanColumn) => void;
}) {
  const { t } = useTranslation();
  const label = (column: KanbanColumn) => column.label ?? t(column.value == null ? 'unset' : column.value === true ? 'yes' : 'no');
  return <section className="kanban-board" aria-label={t('kanban')} data-testid="kanban-board" aria-busy={loading}>
    {error ? <p role="alert">{t('errors.' + error, { defaultValue: t('errors.unexpected') })}</p> : loading ? <p role="status">{t('loadingEntries')}</p> : columns.filter(column => !column.archived || column.count).map(column => <section className="kanban-column" aria-label={label(column)} key={column.key} data-column-key={column.key}>
      <h2>{label(column)} <span>{column.count}</span></h2>
      {column.archived && <p className="screen-hint">{t('archivedChoice')}</p>}{column.unknown && <p className="screen-hint">{t('unavailableChoice')}</p>}
      {!column.count && <p className="screen-hint">{t('noEntries')}</p>}
      {column.entries.map(entry => <article key={entry.id} className="kanban-card" data-record-id={entry.id}>
        <button type="button" data-entry-id={entry.id} disabled={busy} onClick={() => open(entry.id)}>{entry.title || t('unset')}</button>
        <label>{t('moveToColumn')}<select disabled={busy} value={column.key} onChange={event => { const target = columns.find(target => target.key === event.target.value); if (target) move(entry, target.value); }}>
          {columns.filter(target => (!target.archived && !target.unknown) || target.key === column.key).map(target => <option key={target.key} value={target.key}>{label(target)}</option>)}
        </select></label>
      </article>)}
      {column.count > column.entries.length && <button type="button" disabled={busy} onClick={() => showColumn(column)}>{t('showAllCount', { count: column.count })}</button>}
    </section>)}
  </section>;
}
