import { AppError } from './errors';
import { Decimal } from './decimal';
import { navigationLibrary } from './library-navigation';
import { normalizeLibrarySummary, type SummaryWidget } from './library-summary';
import { readProfileQuery } from './query-insights';
import { evaluateQueryFormula } from './query-formula';
import { GroupedSummary, type SummaryGroup } from './grouped-summary';
import { freezeQueryDates, queryEntries } from './queries';
import { projectCollection } from './collection-projection';
import { localDateLiteral } from './relative-dates';
import type { CalendarDay } from './calendar-projection';
import type { EntryListItem, EntryQuery, Field, JsonValue } from './model';
import type { QuickActionDefinition } from './quick-actions';
import type { SqlSession } from './ports';

export type SummaryWidgetData = { kind: 'metric' | 'progress'; value: JsonValue } |
  { kind: 'chart'; groups: SummaryGroup[]; field: Field } |
  { kind: 'list' | 'table'; entries: EntryListItem[]; fields: Field[]; actions?: QuickActionDefinition[] } |
  { kind: 'calendar'; days: CalendarDay[]; month: string } | { kind: 'create' };

/** Each widget gets a coherent transaction over its full filter/profile, with no library/record updates. */
export async function readSummaryWidget(session: SqlSession, libraryId: string, input: SummaryWidget, month = localDateLiteral().slice(0,7), signal?: AbortSignal): Promise<SummaryWidgetData> {
  await navigationLibrary(session,libraryId);
  const widget = (await normalizeLibrarySummary(session,libraryId,{ widgets: [input] })).widgets[0]!;
  signal?.throwIfAborted();
  if (widget.kind === 'create') return { kind: 'create' };
  const base: EntryQuery = widget.profile_id ? await readProfileQuery(session,widget.collection_id,widget.profile_id) : { collection_id: widget.collection_id, date_selection: null, filters: [], sort_field: 'updated_at', direction: 'desc', group_field: '' };
  const query = await freezeQueryDates(session,{ ...base, filters: [...base.filters ?? [], ...widget.filters ?? []] });
  if (widget.kind === 'metric' || widget.kind === 'progress') {
    const value = await evaluateQueryFormula(session,query,widget.formula,signal);
    if (widget.kind === 'progress' && value != null) { if (typeof value !== 'string') throw new AppError('formulaType'); Decimal.parse(value); }
    return { kind: widget.kind,value };
  }
  const fields = await session.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL',[widget.collection_id]);
  if (widget.kind === 'chart') {
    const summary = new GroupedSummary(widget.group_field,widget.measure,fields,widget.group_period);
    let cursor: EntryQuery['cursor'] = null;
    do {
      signal?.throwIfAborted();
      const page = await queryEntries(session,{ ...query,cursor,limit: 200 });
      for (const entry of page.items) summary.add(entry);
      cursor = page.next;
    } while (cursor);
    const groups = summary.result();
    if (widget.group_period && widget.group_period !== 'value') groups.sort((a,b) => a.value == null ? 1 : b.value == null ? -1 : String(a.value).localeCompare(String(b.value),'en'));
    return { kind: 'chart',groups,field: fields.find(field => field.id === widget.group_field)! };
  }
  if (widget.kind === 'calendar') {
    const projection = await projectCollection(session,query,{ mode: 'calendar',mode_field: widget.calendar_field },month,signal);
    if (projection.mode !== 'calendar') throw new AppError('invalidUiConfig');
    return { kind: 'calendar',days: projection.days,month: projection.month };
  }
  if (widget.kind !== 'list' && widget.kind !== 'table') throw new AppError('invalidUiConfig');
  const page = await queryEntries(session, { ...query, cursor: null, limit: widget.limit });
  const [profile] = widget.profile_id ? await session.query<{ config: string }>('SELECT config FROM display_profiles WHERE id=?',[widget.profile_id]) : [];
  const actions = profile ? (JSON.parse(profile.config) as { quick_actions?: QuickActionDefinition[] }).quick_actions : undefined;
  const publicFields = fields.filter(field => field.type !== 'secret');
  const allowed = new Set(publicFields.map(field => field.id));
  // Widget previews must never expose secret values, even in non-rendered object keys.
  const entries = page.items.map(entry => ({
    ...entry,
    data: Object.fromEntries(Object.entries(entry.data).filter(([id]) => allowed.has(id))),
    ...(entry.relation_previews ? { relation_previews: Object.fromEntries(Object.entries(entry.relation_previews).filter(([id]) => allowed.has(id))) } : {}),
  }));
  return { kind: widget.kind, entries, fields: publicFields, ...(actions ? { actions } : {}) };
}
