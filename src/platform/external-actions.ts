import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { AppError } from '../core/errors';
import { externalUrl } from '../core/markdown';
import { UUID_RE } from '../core/model';
const native = registerPlugin<{
  openUrl(options: { url: string }): Promise<void>;
  createCalendarEvent(options: { title: string; start: number; end: number; allDay: boolean; description?: string; location?: string }): Promise<void>;
  createReminder(options: { title: string; description?: string }): Promise<void>;
  pendingSharedText(): Promise<{ items: Array<{ id: string; text: string }>; error?: string }>;
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

export interface IncomingSharedText { id: string; text: string }
export async function pendingAndroidShares(): Promise<{ items: IncomingSharedText[]; error?: string }> {
  if (Capacitor.getPlatform() !== 'android') return { items: [] };
  const result = await native.pendingSharedText();
  if (!Array.isArray(result.items) || result.items.length > 32) throw new AppError('shareUnavailable');
  const items = result.items.map(item => {
    if (typeof item?.id !== 'string' || !UUID_RE.test(item.id) ||
      typeof item.text !== 'string' || !item.text || item.text.length > 65536)
      throw new AppError('invalidSharedText');
    return { id: item.id, text: item.text };
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
