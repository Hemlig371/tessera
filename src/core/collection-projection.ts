import { AppError } from './errors';
import { CalendarProjection, type CalendarDay } from './calendar-projection';
import { KanbanProjection, type KanbanColumn } from './kanban-projection';
import { validateModeOptions, type ModeOptions } from './mode-options';
import type { EntryListItem, EntryQuery, Field } from './model';
import type { SqlSession } from './ports';
import { freezeQueryDates, queryEntries } from './queries';
import { localDateLiteral } from './relative-dates';
import { treeProjection, type TreeRow } from './tree-projection';
import { requireId } from './validation';

export type CollectionProjection = { mode: 'kanban'; columns: KanbanColumn[] } | { mode: 'calendar'; month: string; days: CalendarDay[] } | { mode: 'tree'; rows: TreeRow<EntryListItem>[] };
/** Stream matching SQL pages in one transaction; bounded board/calendar previews, virtualized tree rows. */
export async function projectCollection(session: SqlSession, query: EntryQuery, options: ModeOptions, month = localDateLiteral().slice(0, 7), signal?: AbortSignal, previewFields: readonly string[] = []): Promise<CollectionProjection> {
  query = await freezeQueryDates(session,query);
  requireId(query.collection_id ?? '');
  const fields = await session.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [query.collection_id!]);
  validateModeOptions(options, fields, query.collection_id!);
  const field = fields.find(field => field.id === options.mode_field);
  if (!field || !['kanban','calendar','tree'].includes(options.mode ?? '')) throw new AppError('invalidUiConfig');
  const board = options.mode === 'kanban' ? new KanbanProjection(field) : null;
  const calendar = options.mode === 'calendar' ? new CalendarProjection(field, month) : null;
  const rows: EntryListItem[] = [];
  const safeFields = new Set([field.id,...previewFields.filter(id => fields.some(candidate => candidate.id === id && candidate.type !== 'secret'))]);
  let cursor: EntryQuery['cursor'] = null;
  do {
    signal?.throwIfAborted();
    const page = await queryEntries(session, { ...query, cursor, limit: 200 });
    for (const row of page.items) {
      // Never expose secret/hidden source data in any collection projection.
      // The mode field itself is required for grouping, while previews and actions are allowlisted.
      const projected: EntryListItem = {
        ...row,
        data: Object.fromEntries(Object.entries(row.data).filter(([id]) => safeFields.has(id))),
      };
      if (row.computed) Object.defineProperty(projected, 'computed', {
        value: Object.fromEntries(Object.entries(row.computed).filter(([id]) => safeFields.has(id))),
      });
      if (row.relation_previews) projected.relation_previews = Object.fromEntries(
        Object.entries(row.relation_previews).filter(([id]) => safeFields.has(id))
      );
      if (board) board.add(projected);
      else if (calendar) calendar.add(projected);
      else rows.push(projected);
    }
    cursor = page.next;
  } while (cursor);
  signal?.throwIfAborted();
  return board ? { mode: 'kanban', columns: board.columns } : calendar ? { mode: 'calendar', month, days: calendar.days } : { mode: 'tree', rows: treeProjection(rows, field.id) };
}
