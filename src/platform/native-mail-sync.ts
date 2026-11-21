import {Capacitor} from '@capacitor/core';
/** Never fall back to a browser or plaintext credential store. */
export function nativeMailSyncSupported():boolean {
  return Capacitor.getPlatform()==='android' || (typeof window!=='undefined' && '__TAURI_INTERNALS__' in window);
}
