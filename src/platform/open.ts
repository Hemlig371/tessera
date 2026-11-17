import { Capacitor } from '@capacitor/core';
import { AppError } from '../core/errors';
import type { DatabaseAdapter } from '../core/ports';
export async function openDatabase(): Promise<DatabaseAdapter> {
  if (Capacitor.getPlatform() === 'android') {
    await (await import('./database-import')).recoverDatabaseImport();
    return (await import('./android-database')).openAndroidDatabase();
  }
  if ('__TAURI_INTERNALS__' in window) return (await import('./tauri-database')).openTauriDatabase();
  throw new AppError('nativeRequired');
}
