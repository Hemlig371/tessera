import { AppError } from './errors';
import { canonical } from './model';
import type { Field, JsonValue, RecordData } from './model';
import type { FileAdapter, PlatformLifecycleAdapter } from './ports';
import { requireId, validateData } from './validation';

export interface DraftScope { dataset_id: string; library_id: string; collection_id: string }
export type DraftAction =
  | { kind: 'save'; create_id: string }
  | { kind: 'linked'; parent_id: string; field_id: string; create_id: string };
export interface Draft extends DraftScope {
  format: 1;
  action: DraftAction;
  opened_at: string;
  updated_at: string;
  field_types: Record<string, string>;
  data: RecordData;
}
export function draftPath(scope: DraftScope): string {
  [scope.dataset_id, scope.library_id, scope.collection_id].forEach(requireId);
  return `drafts/${scope.dataset_id}/${scope.library_id}/${scope.collection_id}.json`;
}
function checkAction(action: DraftAction): void {
  if (!action || typeof action !== 'object') throw new AppError('invalidDraft');
  if (action.kind === 'save') { if (Object.hasOwn(action, 'record_id')) throw new AppError('invalidDraft'); requireId(action.create_id); }
  else if (action.kind === 'linked') [action.parent_id, action.field_id, action.create_id].forEach(requireId);
  else throw new AppError('invalidDraft');
}
function decodeDraft(bytes: Uint8Array, path: string): Draft {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Draft;
    if (value.format !== 1 || draftPath(value) !== path || typeof value.opened_at !== 'string' || typeof value.updated_at !== 'string' ||
      !value.field_types || typeof value.field_types !== 'object' || Array.isArray(value.field_types)) throw new Error();
    checkAction(value.action);
    validateData(value.data);
    for (const id of Object.keys(value.data)) {
      if (typeof value.field_types[id] !== 'string' || value.field_types[id] === 'secret') throw new Error();
    }
    return value;
  } catch { throw new AppError('invalidDraft'); }
}
function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((value, index) => value === b[index]);
}
export class DraftStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly files: FileAdapter, readonly lifecycle: PlatformLifecycleAdapter) {}
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => undefined);
    return next;
  }
  load(scope: DraftScope): Promise<Draft | null> {
    const path = draftPath(scope);
    return this.queue(async () => {
      const bytes = await this.files.read(path);
      if (bytes === null) return null;
      return decodeDraft(bytes, path);
    });
  }
  /** Preserve invalid bytes before freeing the live path; retries reuse the same recovery copy. */
  recoverCorrupt(scope: DraftScope): Promise<{ draft: Draft | null; recovered_path: string | null }> {
    const path = draftPath(scope);
    return this.queue(async () => {
      const bytes = await this.files.read(path);
      if (bytes === null) return { draft: null, recovered_path: null };
      try { return { draft: decodeDraft(bytes, path), recovered_path: null }; }
      catch { /* Only invalid drafts are moved; a valid file queued earlier remains live. */ }
      try {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
        const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
        const recovery = `draft-recovery/${scope.dataset_id}/${scope.library_id}/${scope.collection_id}/${hash}.json`;
        if (!sameBytes(await this.files.read(recovery), bytes)) await this.files.writeAtomic(recovery, bytes);
        if (!sameBytes(await this.files.read(recovery), bytes)) throw new AppError('draftRecovery');
        await this.files.remove(path);
        return { draft: null, recovered_path: recovery };
      } catch { throw new AppError('draftRecovery'); }
    });
  }
  write(draft: Draft): Promise<void> {
    const path = draftPath(draft);
    checkAction(draft.action); validateData(draft.data);
    for (const id of Object.keys(draft.data)) if (!draft.field_types[id] || draft.field_types[id] === 'secret') throw new AppError('invalidDraft');
    return this.queue(() => this.files.writeAtomic(path, new TextEncoder().encode(canonical(draft as unknown as JsonValue))));
  }
  remove(scope: DraftScope): Promise<void> { const path = draftPath(scope); return this.queue(() => this.files.remove(path)); }
}

/** Creation only. Closing flushes input; only a successful record save calls finish(). */
export class DraftSession {
  private timer?: ReturnType<typeof setTimeout>;
  private pending: Draft | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private lastWrite: Promise<void> = Promise.resolve();
  private revision = 0;
  private cancelled = false;
  private disposed = false;
  private unsubscribe: () => void;
  readonly openedAt: string;
  readonly types: Record<string, string>;
  constructor(readonly store: DraftStore, readonly scope: DraftScope, public action: DraftAction,
    fields: readonly Pick<Field, 'id' | 'type'>[], readonly onError: () => void, previous?: Draft, readonly debounceMs = 3000) {
    draftPath(scope); checkAction(action);
    this.openedAt = previous?.opened_at ?? new Date().toISOString();
    this.types = { ...previous?.field_types, ...Object.fromEntries(fields.map(field => [field.id, field.type])) };
    this.unsubscribe = store.lifecycle.subscribe(state => { if (state === 'inactive') void this.flush().catch(onError); });
  }
  change(input: RecordData): void {
    if (this.cancelled || this.disposed) return;
    validateData(input);
    this.revision++;
    const data: RecordData = {};
    for (const [id, value] of Object.entries(input)) if (this.types[id] && this.types[id] !== 'secret' && this.types[id] !== 'backlink') data[id] = value;
    this.pending = { ...this.scope, format: 1, action: this.action, opened_at: this.openedAt, updated_at: new Date().toISOString(),
      field_types: Object.fromEntries(Object.keys(data).map(id => [id, this.types[id]!])), data };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, this.debounceMs);
  }
  async close(): Promise<void> {
    await this.flush(); this.disposed = true; clearTimeout(this.timer); this.unsubscribe();
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    const value = this.pending, revision = this.revision;
    this.pending = null;
    if (!value || this.cancelled) return this.lastWrite;
    const work = this.tail.then(async () => { if (!this.cancelled) await this.store.write(value); });
    this.lastWrite = work;
    // Retry only the latest input. Closing must observe any in-flight failure.
    this.tail = work.catch(() => { if (!this.pending && !this.cancelled && revision === this.revision) this.pending = value; });
    return work;
  }
  async finish(): Promise<void> {
    this.cancelled = true; this.pending = null; clearTimeout(this.timer); this.unsubscribe();
    await this.tail;
    await this.store.remove(this.scope);
  }
  dispose(): void {
    if (this.disposed) return;
    void this.flush().catch(this.onError);
    this.disposed = true; this.unsubscribe(); clearTimeout(this.timer);
  }
}
