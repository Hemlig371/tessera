import { AppError } from './errors';
import type { Entry } from './model';
import type { SqlSession } from './ports';

export const retentionDays = [7, 14, 30, 90, null] as const;
export type TrashRetention = typeof retentionDays[number];
export interface TrashCursor { deleted_at: string; id: string }
export interface TrashItem extends Entry {
  title: string;
  library_id: string;
  library_name: string;
  collection_name: string;
  restorable: boolean;
}
export interface TrashPage { items: TrashItem[]; next: TrashCursor | null }
export function validateRetention(value: unknown): TrashRetention {
  if (!retentionDays.includes(value as TrashRetention)) throw new AppError('invalidRetention');
  return value as TrashRetention;
}
export async function readRetention(s: SqlSession): Promise<TrashRetention> {
  const [row] = await s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='trash:retention'");
  return row ? validateRetention((JSON.parse(row.value) as { days: unknown }).days) : 30;
}
