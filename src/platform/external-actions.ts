import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { AppError } from '../core/errors';
import { externalUrl } from '../core/markdown';
import { UUID_RE } from '../core/model';
const native = registerPlugin<{
  openUrl(options: { url: string }): Promise<void>;
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
