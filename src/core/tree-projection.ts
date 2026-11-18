import { AppError } from './errors';
import type { Entry } from './model';

export interface TreeRow<T> { entry: T; depth: number; parent_id: string | null; cycle: boolean; missing_parent: boolean }
/** Source order is query order. Missing/filtered parents and cycles remain visible, without recursion. */
export function treeProjection<T extends Pick<Entry, 'id' | 'data'>>(entries: readonly T[], parentField: string): TreeRow<T>[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  if (byId.size !== entries.length) throw new AppError('invalidData');
  const parents = new Map<string, string | null>(), cyclic = new Set<string>(), missing = new Set<string>();
  for (const entry of entries) {
    const parent = entry.data[parentField];
    if (parent != null && typeof parent !== 'string') throw new AppError('invalidRelation');
    if (parent && !byId.has(parent)) missing.add(entry.id);
    parents.set(entry.id, typeof parent === 'string' && byId.has(parent) ? parent : null);
  }
  const complete = new Set<string>();
  for (const entry of entries) {
    const path: string[] = [], positions = new Map<string, number>();
    let current: string | null = entry.id;
    while (current && !complete.has(current)) {
      const previous = positions.get(current);
      if (previous != null) {
        const cycle = path.slice(previous);
        for (const id of cycle) cyclic.add(id);
        // Break the same edge regardless of arrival/query order; source values remain untouched.
        parents.set(cycle.reduce((a, b) => a < b ? a : b), null);
        break;
      }
      positions.set(current, path.length); path.push(current); current = parents.get(current) ?? null;
    }
    for (const id of path) complete.add(id);
  }
  const children = new Map<string | null, T[]>();
  for (const entry of entries) { const parent = parents.get(entry.id)!; const siblings = children.get(parent) ?? []; siblings.push(entry); children.set(parent, siblings); }
  const result: TreeRow<T>[] = [], stack = (children.get(null) ?? []).map(entry => ({ entry, depth: 0 })).reverse();
  while (stack.length) {
    const { entry, depth } = stack.pop()!;
    result.push({ entry, depth, parent_id: parents.get(entry.id)!, cycle: cyclic.has(entry.id), missing_parent: missing.has(entry.id) });
    const descendants = children.get(entry.id) ?? [];
    for (let i = descendants.length - 1; i >= 0; i--) stack.push({ entry: descendants[i]!, depth: depth + 1 });
  }
  return result;
}
