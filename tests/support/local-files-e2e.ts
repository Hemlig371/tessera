import { DraftStore } from '../../src/core/drafts';
import type { FileAdapter } from '../../src/core/ports';

export async function openDraftStore() {
  async function request<T>(op: string, path: string, bytes?: number[]): Promise<T> {
    const response = await fetch('/__test-sqlite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, path, bytes }) });
    const result = await response.json() as { value: T; error?: string };
    if (!response.ok || result.error) throw new Error('fileError');
    return result.value;
  }
  const files: FileAdapter = {
    read: async path => { const bytes = await request<number[] | null>('local-read', path); return bytes === null ? null : new Uint8Array(bytes); },
    writeAtomic: (path, bytes) => request('local-write', path, [...bytes]),
    remove: path => request('local-remove', path),
  };
  return new DraftStore(files, { subscribe(listener) {
    const change = () => listener(document.visibilityState === 'visible' ? 'active' : 'inactive');
    document.addEventListener('visibilitychange', change);
    window.addEventListener('pagehide', change);
    return () => { document.removeEventListener('visibilitychange', change); window.removeEventListener('pagehide', change); };
  } });
}
