import { Capacitor, registerPlugin } from '@capacitor/core';
import { DraftStore } from '../core/drafts';
import type { FileAdapter, PlatformLifecycleAdapter } from '../core/ports';
import { AppError } from '../core/errors';

interface NativeFiles {
  read(options: { path: string }): Promise<{ data: string | null }>;
  write(options: { path: string; data: string }): Promise<void>;
  remove(options: { path: string }): Promise<void>;
  setBackHandling(options: { enabled: boolean }): Promise<void>;
  addListener(name: 'state', callback: (event: { active: boolean }) => void): Promise<{ remove(): Promise<void> }>;
}
const native = registerPlugin<NativeFiles>('LocalFiles');
export function bindSystemBack(handler: () => void, error: () => void): () => void {
  window.addEventListener('tessera-back', handler);
  if (Capacitor.getPlatform() === 'android') void native.setBackHandling({ enabled: true }).catch(error);
  return () => {
    window.removeEventListener('tessera-back', handler);
    if (Capacitor.getPlatform() === 'android') void native.setBackHandling({ enabled: false }).catch(error);
  };
}
export async function openDraftStore(): Promise<DraftStore> {
  let files: FileAdapter;
  const listeners = new Set<(state: 'active' | 'inactive') => void>();
  const emit = (active: boolean) => listeners.forEach(listener => listener(active ? 'active' : 'inactive'));
  if (Capacitor.getPlatform() === 'android') {
    await native.addListener('state', ({ active }) => emit(active));
    files = {
      read: async path => { const { data } = await native.read({ path }); return data === null ? null : Uint8Array.from(atob(data), c => c.charCodeAt(0)); },
      writeAtomic: async (path, bytes) => {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await native.write({ path, data: btoa(binary) });
      },
      remove: path => native.remove({ path }),
    };
  } else if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    files = {
      read: async path => { const bytes = await invoke<number[] | null>('local_read', { path }); return bytes === null ? null : new Uint8Array(bytes); },
      writeAtomic: (path, bytes) => invoke('local_write', { path, bytes: [...bytes] }),
      remove: path => invoke('local_remove', { path }),
    };
  } else throw new AppError('nativeRequired');
  document.addEventListener('visibilitychange', () => emit(document.visibilityState === 'visible'));
  window.addEventListener('pagehide', () => emit(false));
  const lifecycle: PlatformLifecycleAdapter = { subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return new DraftStore(files, lifecycle);
}
