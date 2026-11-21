import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BinaryFileAdapter, FileFacts } from '../core/ports';
import { AppError } from '../core/errors';
import { exportFileName } from '../core/attachments';
import type { Repository } from '../core/repository';
interface NativeBinary {
  begin(options: { id: string }): Promise<void>;
  write(options: { id: string; offset: number; data: string }): Promise<void>;
  finish(options: { id: string; size: number; sha256?: string }): Promise<{ facts: FileFacts }>;
  stat(options: { id: string }): Promise<{ size: number | null }>;
  inspect(options: { id: string }): Promise<{ facts: FileFacts | null }>;
  read(options: { id: string; offset: number; length: number }): Promise<{ data: string }>;
  remove(options: { id: string; staged: boolean }): Promise<void>;
  export(options: { id: string; name: string; mime: string; size: number; sha256: string }): Promise<{ saved: boolean }>;
  exportGroup(options: { files: ExportGroupFile[] }): Promise<{ saved: boolean; count?: number }>;
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

interface ExportGroupFile { id: string; name: string; mime: string; size: number; sha256: string; folders: string[] }
export interface LargeExportItem { id: string; record_id: string; library_name: string; collection_name: string; record_title: string }
/** Verify bytes and hashes before asking the OS for one destination folder. */
export async function exportAttachmentGroup(api: Repository, selected: readonly LargeExportItem[]): Promise<number | null> {
  if (selected.length < 1 || selected.length > 100 || new Set(selected.map(item => item.id)).size !== selected.length)
    throw new AppError('invalidAttachment');
  const files: ExportGroupFile[] = [];
  for (const item of selected) {
    const view = await api.getAttachmentView(item.id, item.record_id, true);
    if (view.status !== 'present') throw new AppError(view.status === 'corrupt' ? 'fileCorrupt' : 'fileMissing');
    // Bound UTF-8 path components, not just UTF-16 code units. Keep UUID collision suffixes.
    const safeSegment = (value: string, max = 40): string =>
      Array.from(exportFileName(value)).slice(0, max).join('') || 'untitled';
    const safeName = exportFileName(view.name);
    const dot = safeName.lastIndexOf('.');
    const suffix = '-' + item.id.slice(0, 8);
    const name = dot > 0 ? safeSegment(safeName.slice(0, dot), 30) + suffix + safeName.slice(dot) :
      safeSegment(safeName, 30) + suffix;
    files.push({
      id: item.id, size: view.size, sha256: view.sha256, mime: view.mime, name,
      folders: [
        safeSegment(item.library_name),
        safeSegment(item.collection_name),
        safeSegment(item.record_title || 'record', 30) + '-' + item.record_id.slice(0, 8),
      ],
    });
  }
  if (Capacitor.getPlatform() === 'android') {
    const result = await android.exportGroup({ files });
    return result.saved ? result.count ?? files.length : null;
  }
  if ('__TAURI_INTERNALS__' in window) {
    const folder = await (await import('@tauri-apps/plugin-dialog')).open({ directory: true, multiple: false });
    if (!folder || typeof folder !== 'string') return null;
    const { invoke } = await import('@tauri-apps/api/core');
    const count = await invoke<number>('binary_export_batch', { folder, files });
    try { await invoke('external_open_folder', { path: folder }); }
    catch { /* The verified files are already saved; users can open the chosen folder manually. */ }
    return count;
  }
  throw new AppError('nativeRequired');
}
