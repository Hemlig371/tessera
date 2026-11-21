import { AppError } from './errors';
import type { Library } from './model';
import type { SqlSession } from './ports';
import { requireId } from './validation';

export type LibraryLocation = { kind: 'collections' } | { kind: 'summary' } | { kind: 'collection'; collection_id: string; profile_id?: string };
export interface LibraryNavigation {
  start: LibraryLocation | { kind: 'last' };
  collections_layout: 'list' | 'cards';
}
export const defaultLibraryNavigation: LibraryNavigation = { start: { kind: 'collections' }, collections_layout: 'cards' };
export function validateLibraryNavigation(value: unknown): LibraryNavigation {
  const config = value as Partial<LibraryNavigation> | null;
  if (!config || !['list', 'cards'].includes(config.collections_layout ?? '') || !config.start) throw new AppError('invalidLibraryNavigation');
  const start = config.start;
  if (start.kind === 'collection') {
    requireId(start.collection_id);
    if (start.profile_id !== undefined) requireId(start.profile_id);
    return { start: { kind: 'collection', collection_id: start.collection_id, ...(start.profile_id ? { profile_id: start.profile_id } : {}) }, collections_layout: config.collections_layout! };
  }
  if (start.kind !== 'collections' && start.kind !== 'summary' && start.kind !== 'last') throw new AppError('invalidLibraryNavigation');
  return { start: { kind: start.kind }, collections_layout: config.collections_layout! };
}
export function libraryNavigation(library: Library): LibraryNavigation {
  try {
    const value = (JSON.parse(library.config) as { navigation?: unknown }).navigation;
    return value ? validateLibraryNavigation(value) : structuredClone(defaultLibraryNavigation);
  } catch { return structuredClone(defaultLibraryNavigation); }
}
export async function navigationLibrary(s: SqlSession, id: string): Promise<Library> {
  requireId(id);
  const [library] = await s.query<Library>('SELECT * FROM libraries WHERE id=? AND deleted_at IS NULL AND system_kind IS NULL', [id]);
  if (!library) throw new AppError('notFound');
  return library;
}
export async function validLibraryLocation(s: SqlSession, libraryId: string, location: LibraryLocation): Promise<boolean> {
  if (location.kind === 'collections' || location.kind === 'summary') return true;
  const [collection] = await s.query('SELECT id FROM collections WHERE id=? AND library_id=? AND deleted_at IS NULL AND system_kind IS NULL', [location.collection_id, libraryId]);
  if (!collection) return false;
  return !location.profile_id || !!(await s.query('SELECT id FROM display_profiles WHERE id=? AND collection_id=? AND deleted_at IS NULL', [location.profile_id, location.collection_id]))[0];
}
export async function resolveLibraryStart(s: SqlSession, libraryId: string): Promise<LibraryLocation> {
  const navigation = libraryNavigation(await navigationLibrary(s, libraryId));
  let target = navigation.start;
  if (target.kind === 'last') {
    const [last] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', [`library_last:${libraryId}`]);
    try { target = last ? validateLibraryNavigation({ start: JSON.parse(last.value), collections_layout: 'cards' }).start : { kind: 'collections' }; }
    catch { return { kind: 'collections' }; }
  }
  if (target.kind === 'last' || !await validLibraryLocation(s, libraryId, target)) return { kind: 'collections' };
  return target;
}
