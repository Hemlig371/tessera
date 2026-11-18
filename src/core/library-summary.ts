import { AppError } from './errors';
import { canonical, type Collection, type EntryFilter, type Field, type FieldConfig, type JsonValue, type Library } from './model';
import { Decimal, normalizeDecimal } from './decimal';
import { parseFormula, printFormula, formulaReferences } from './formula';
import type { SqlSession } from './ports';
import { navigationLibrary } from './library-navigation';
import { readProfileQuery } from './query-insights';
import { validateSummaryMeasure, type SummaryMeasure } from './query-summary';
import { modeFields } from './mode-options';
import { validateUiDefinition } from './ui-definition';
import { requireId } from './validation';
import type { GroupPeriod } from './grouped-summary';

interface WidgetBase { id: string; title: string; width: 1 | 2; collection_id: string; profile_id?: string; filters?: EntryFilter[] }
export type SummaryWidget = WidgetBase & (
  { kind: 'metric'; formula: string; precision?: number; currency?: string } |
  { kind: 'progress'; formula: string; goal: string; precision?: number; currency?: string } |
  { kind: 'chart'; group_field: string; group_period?: GroupPeriod; measure: SummaryMeasure; style: 'bar' | 'line' } |
  { kind: 'list' | 'table'; field_ids: string[]; limit: number } |
  { kind: 'calendar'; calendar_field: string } |
  { kind: 'create' }
);
export interface LibrarySummaryDefinition { widgets: SummaryWidget[] }
export function librarySummary(library: Library): LibrarySummaryDefinition {
  const value = (JSON.parse(library.config) as { summary?: LibrarySummaryDefinition }).summary;
  return value && Array.isArray(value.widgets) ? value : { widgets: [] };
}
/** Validation is read-only; Repository persists the normalized config as one ordinary library update. */
export async function normalizeLibrarySummary(session: SqlSession, libraryId: string, input: LibrarySummaryDefinition): Promise<LibrarySummaryDefinition> {
  await navigationLibrary(session, libraryId);
  if (!input || !Array.isArray(input.widgets)) throw new AppError('invalidUiConfig');
  canonical(input as unknown as JsonValue);
  const seen = new Set<string>(), widgets: SummaryWidget[] = [];
  for (const widget of input.widgets) {
    if (!widget || typeof widget !== 'object' || typeof widget.title !== 'string' || !widget.title.trim() || widget.title.length > 200 || ![1,2].includes(widget.width)) throw new AppError('invalidUiConfig');
    requireId(widget.id); requireId(widget.collection_id);
    if (seen.has(widget.id)) throw new AppError('invalidUiConfig'); seen.add(widget.id);
    const [collection] = await session.query<Collection>('SELECT * FROM collections WHERE id=? AND library_id=? AND deleted_at IS NULL AND system_kind IS NULL',[widget.collection_id,libraryId]);
    if (!collection) throw new AppError('notFound');
    const fields = await session.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL',[collection.id]);
    if (widget.profile_id) await readProfileQuery(session, collection.id, widget.profile_id);
    if (widget.filters) validateUiDefinition({ fields: [], list: { filters: widget.filters } },'list',fields,collection.primary_field_id);
    const normalized = { ...widget, title: widget.title.trim() };
    if (normalized.kind === 'metric' || normalized.kind === 'progress') {
      const expression = parseFormula(normalized.formula);
      for (const path of formulaReferences(expression)) {
        const field = fields.find(field => field.id === path[0]);
        if (path.length !== 1 || !field || field.type === 'secret') throw new AppError('formulaReference');
        if (['file','image','json','coordinates','date_range','relation','backlink','multiselect'].includes(field.type)) throw new AppError('formulaType');
      }
      normalized.formula = printFormula(expression);
      if (normalized.precision != null && (!Number.isInteger(normalized.precision) || normalized.precision < 0 || normalized.precision > 5)) throw new AppError('invalidUiConfig');
      if (normalized.currency != null && (typeof normalized.currency !== 'string' || normalized.currency.length > 12)) throw new AppError('invalidUiConfig');
      if (normalized.kind === 'progress') {
        normalized.goal = normalizeDecimal(normalized.goal);
        if (Decimal.parse(normalized.goal).compare(new Decimal(0n)) <= 0) throw new AppError('invalidUiConfig');
      }
    } else if (normalized.kind === 'chart') {
      const field = fields.find(field => field.id === normalized.group_field);
      if (!field || ['secret','relation','backlink','file','image','json','coordinates','date_range','multiselect'].includes(field.type) || !['bar','line'].includes(normalized.style)) throw new AppError('invalidUiConfig');
      validateSummaryMeasure(normalized.measure,fields);
      if (normalized.group_period && normalized.group_period !== 'value') {
        const type = ['formula','aggregate'].includes(field.type) ? (JSON.parse(field.config) as FieldConfig).result_type ?? 'decimal' : field.type;
        if (!['day','week','month'].includes(normalized.group_period) || !['date','local_datetime'].includes(type)) throw new AppError('invalidUiConfig');
      }
    } else if (normalized.kind === 'list' || normalized.kind === 'table') {
      if (!Array.isArray(normalized.field_ids) || new Set(normalized.field_ids).size !== normalized.field_ids.length || !Number.isInteger(normalized.limit) || normalized.limit < 1 || normalized.limit > 50) throw new AppError('invalidUiConfig');
      for (const id of normalized.field_ids) { const field = fields.find(field => field.id === id); if (!field) throw new AppError('invalidFilter'); if (field.type === 'secret') throw new AppError('invalidSecret'); }
    } else if (normalized.kind === 'calendar') {
      if (!modeFields('calendar',fields,collection.id).some(field => field.id === normalized.calendar_field)) throw new AppError('invalidUiConfig');
    } else if (normalized.kind !== 'create') throw new AppError('invalidUiConfig');
    widgets.push(normalized);
  }
  return { ...input, widgets };
}
