import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { AppError } from '../core/errors';
import { externalUrl } from '../core/markdown';
import { UUID_RE } from '../core/model';
import type { ByteSource } from '../core/attachments';
const native = registerPlugin<{
  openUrl(options: { url: string }): Promise<void>;
  createCalendarEvent(options: { title: string; start: number; end: number; allDay: boolean; description?: string; location?: string }): Promise<void>;
  createReminder(options: { title: string; description?: string }): Promise<void>;
  pendingSharedText(): Promise<{ items: Array<{ id: string; text: string; files?: Array<{ index: number; name: string; mime: string; size: number }> }>; error?: string }>;
  readSharedFile(options: { id: string; index: number; offset: number; length: number }): Promise<{ data: string }>;
  ackSharedText(options: { id: string }): Promise<void>;
  addListener(name: 'shareReceived', listener: () => void): Promise<PluginListenerHandle>;
  shortcutSupported(): Promise<{ supported: boolean }>;
  pinLibraryShortcut(options: { id: string; name: string }): Promise<{ requested: boolean }>;
  addListener(name: 'openLibrary', listener: (event: { id: string }) => void): Promise<PluginListenerHandle>;
}>('ExternalActions');
export const androidLibraryShortcuts = Capacitor.getPlatform() === 'android';
export async function libraryShortcutSupported(): Promise<boolean> {
  if (!androidLibraryShortcuts) return false;
  return (await native.shortcutSupported()).supported;
}
export async function pinLibraryShortcut(id: string, name: string): Promise<void> {
  if (!androidLibraryShortcuts) throw new AppError('nativeRequired');
  if (!UUID_RE.test(id)) throw new AppError('invalidId');
  if (!(await native.pinLibraryShortcut({ id, name })).requested) throw new AppError('shortcutUnavailable');
}
export async function subscribeLibraryLaunch(listener: (id: string) => void): Promise<() => void> {
  if (!androidLibraryShortcuts) throw new AppError('nativeRequired');
  const handle = await native.addListener('openLibrary', event => {
    if (typeof event.id === 'string' && UUID_RE.test(event.id)) listener(event.id);
  });
  return () => { void handle.remove().catch(() => undefined); };
}
export async function openExternalUrl(input: string): Promise<void> {
  const url = externalUrl(input); if (!url) throw new AppError('invalidUrl');
  if (Capacitor.getPlatform() === 'android') await native.openUrl({ url });
  else if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core'); await invoke('external_open_url', { url });
  } else throw new AppError('nativeRequired');
}

/** The OS editor owns the final save; opening it does not mutate the Tessera record. */
export async function openAndroidCalendarEvent(options: { title: string; start: number; end: number; allDay: boolean; description?: string; location?: string }): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') throw new AppError('nativeRequired');
  if (!options.title.trim() || !Number.isSafeInteger(options.start) || !Number.isSafeInteger(options.end) ||
      options.start < 0 || options.end <= options.start) throw new AppError('invalidCalendarEvent');
  await native.createCalendarEvent(options);
}
export async function openAndroidReminder(title: string, description?: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') throw new AppError('nativeRequired');
  if (!title.trim()) throw new AppError('invalidCalendarEvent');
  await native.createReminder({ title, description });
}

export interface IncomingSharedText { id: string; text: string; files: Array<{ index: number; name: string; mime: string; size: number }> }
export async function pendingAndroidShares(): Promise<{ items: IncomingSharedText[]; error?: string }> {
  if (Capacitor.getPlatform() !== 'android') return { items: [] };
  const result = await native.pendingSharedText();
  if (!Array.isArray(result.items) || result.items.length > 32) throw new AppError('shareUnavailable');
  const items = result.items.map(item => {
    if (typeof item?.id !== 'string' || !UUID_RE.test(item.id) ||
      typeof item.text !== 'string' || item.text.length > 65536)
      throw new AppError('invalidSharedText');
    const files = item.files ?? [];
    if (!Array.isArray(files) || files.length > 16 ||
        files.some((file, index) => !file || file.index !== index || typeof file.name !== 'string' ||
          !file.name || typeof file.mime !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0))
      throw new AppError('invalidSharedFile');
    if (!item.text.trim() && files.length === 0) throw new AppError('invalidSharedText');
    return { id: item.id, text: item.text, files };
  });
  return { items, error: result.error };
}
export async function acknowledgeAndroidShare(id: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') throw new AppError('nativeRequired');
  if (!UUID_RE.test(id)) throw new AppError('invalidId');
  await native.ackSharedText({ id });
}
export async function subscribeAndroidShares(listener: () => void): Promise<() => void> {
  if (Capacitor.getPlatform() !== 'android') return () => undefined;
  const handle = await native.addListener('shareReceived', listener);
  return () => { void handle.remove().catch(() => undefined); };
}

/** Share bytes live in a private OS staging area, never in navigation state. */
export function sharedFileSource(shareId: string, file: IncomingSharedText['files'][number]): ByteSource {
  if (!UUID_RE.test(shareId) || !Number.isInteger(file.index) || file.index < 0 || file.index > 15) throw new AppError('invalidSharedFile');
  return {
    name: file.name, mime: file.mime, size: file.size,
    async read(offset, length) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 256 * 1024 || offset + length > file.size)
        throw new AppError('invalidSharedFile');
      const result = await native.readSharedFile({ id: shareId, index: file.index, offset, length });
      const binary = atob(result.data);
      if (binary.length !== length) throw new AppError('invalidSharedFile');
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    },
  };
}
