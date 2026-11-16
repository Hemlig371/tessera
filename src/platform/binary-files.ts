import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BinaryFileAdapter, FileFacts } from '../core/ports';
import { AppError } from '../core/errors';
interface NativeBinary {
  begin(options: { id: string }): Promise<void>;
  write(options: { id: string; offset: number; data: string }): Promise<void>;
  finish(options: { id: string; size: number; sha256?: string }): Promise<{ facts: FileFacts }>;
  stat(options: { id: string }): Promise<{ size: number | null }>;
  inspect(options: { id: string }): Promise<{ facts: FileFacts | null }>;
  read(options: { id: string; offset: number; length: number }): Promise<{ data: string }>;
  remove(options: { id: string; staged: boolean }): Promise<void>;
  export(options: { id: string; name: string; mime: string; size: number; sha256: string }): Promise<{ saved: boolean }>;
}
const android = registerPlugin<NativeBinary>('BinaryFiles');
export function openBinaryFiles(): BinaryFileAdapter {
  if (Capacitor.getPlatform() === 'android') return {
    begin: id => android.begin({ id }),
    write: (id, offset, bytes) => {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return android.write({ id, offset, data: btoa(binary) });
    },
    finish: async (id, size, sha256) => (await android.finish({ id, size, ...(sha256 ? { sha256 } : {}) })).facts,
    stat: async id => (await android.stat({ id })).size,
    inspect: async id => (await android.inspect({ id })).facts,
    read: async (id, offset, length) => Uint8Array.from(atob((await android.read({ id, offset, length })).data), value => value.charCodeAt(0)),
    remove: (id, staged) => android.remove({ id, staged }),
    export: async (id, name, mime, expected) => (await android.export({ id, name, mime, ...expected })).saved,
  };
  if ('__TAURI_INTERNALS__' in window) {
    const invoke = async <T>(op: string, args: Record<string, unknown>): Promise<T> => (await import('@tauri-apps/api/core')).invoke<T>('binary_' + op, args);
    return {
      begin: id => invoke('begin', { id }),
      write: (id, offset, bytes) => invoke('write', { id, offset, bytes: [...bytes] }),
      finish: (id, size, sha256) => invoke('finish', { id, size, sha256: sha256 ?? null }),
      stat: id => invoke('stat', { id }),
      inspect: id => invoke('inspect', { id }),
      read: async (id, offset, length) => new Uint8Array(await invoke<number[]>('read', { id, offset, length })),
      remove: (id, staged) => invoke('remove', { id, staged }),
      export: async (id, name, _mime, expected) => {
        const path = await (await import('@tauri-apps/plugin-dialog')).save({ defaultPath: name });
        if (!path) return false;
        await invoke('export', { id, path, ...expected }); return true;
      },
    };
  }
  throw new AppError('nativeRequired');
}
