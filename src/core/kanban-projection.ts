import { AppError } from './errors';
import { canonical, type EntryListItem, type Field, type FieldConfig, type JsonValue } from './model';

export interface KanbanColumn { key: string; value: JsonValue; label: string | null; count: number; entries: EntryListItem[]; archived: boolean; unknown: boolean }
/** Stable option IDs; unassigned, false, zero and archived states are never lost through truthiness. */
export class KanbanProjection {
  readonly columns: KanbanColumn[] = [];
  private readonly byKey = new Map<string, KanbanColumn>();
  constructor(private readonly field: Pick<Field, 'id' | 'type' | 'config'>, private readonly previewLimit = 20) {
    if (!['select','boolean'].includes(field.type)) throw new AppError('invalidFilter');
    if (!Number.isSafeInteger(previewLimit) || previewLimit < 0 || previewLimit > 200) throw new AppError('invalidData');
    this.column(null, null);
    if (field.type === 'boolean') { this.column(false, null); this.column(true, null); }
    else for (const option of (JSON.parse(field.config) as FieldConfig).options ?? []) this.column(option.id, option.label, option.archived === true);
  }
  private column(value: JsonValue, label: string | null, archived = false, unknown = false): KanbanColumn {
    const key = canonical(value), previous = this.byKey.get(key);
    if (previous) return previous;
    const column: KanbanColumn = { key, value, label, archived, unknown, count: 0, entries: [] };
    this.columns.push(column); this.byKey.set(key, column); return column;
  }
  add(entry: EntryListItem): void {
    const value = entry.data[this.field.id] ?? null;
    if (value !== null && (this.field.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string')) throw new AppError('invalidData');
    const column = this.byKey.get(canonical(value)) ?? this.column(value, typeof value === 'string' ? value : null, false, true);
    column.count++; if (column.entries.length < this.previewLimit) column.entries.push(entry);
  }
}
