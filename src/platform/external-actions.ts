import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppError } from '../core/errors';
import { externalUrl } from '../core/markdown';
const native = registerPlugin<{ openUrl(options: { url: string }): Promise<void> }>('ExternalActions');
export async function openExternalUrl(input: string): Promise<void> {
  const url = externalUrl(input); if (!url) throw new AppError('invalidUrl');
  if (Capacitor.getPlatform() === 'android') await native.openUrl({ url });
  else if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core'); await invoke('external_open_url', { url });
  } else throw new AppError('nativeRequired');
}
