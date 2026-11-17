import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BinaryFileAdapter, DatabaseAdapter, FileFacts, SqlSession } from '../core/ports';
import { AppError } from '../core/errors';
import { SerialDatabase } from './serial-database';

export interface DatabaseImportStage {
  db: DatabaseAdapter; files: Pick<BinaryFileAdapter, 'begin' | 'write' | 'finish'>;
  activate(): Promise<void>; abort(): Promise<void>;
}
const android = registerPlugin<{ invoke(options: { op: string; args: Record<string, unknown> }): Promise<{ value: unknown }> }>('ImportFiles');
export async function recoverDatabaseImport(): Promise<void> {
  if (Capacitor.getPlatform() === 'android') await android.invoke({ op: 'recover', args: {} });
}
export async function createDatabaseImportStage(sourceSize: number): Promise<DatabaseImportStage> {
  // STORE ZIP is not a decompression bomb; reserve space for DB pages/indices and original bytes.
  const required = sourceSize * 4 + 16 * 1024 * 1024;
  if (!Number.isSafeInteger(required) || sourceSize <= 0) throw new AppError('invalidArchive');
  const isAndroid = Capacitor.getPlatform() === 'android';
  const send = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    try {
      if (isAndroid) return (await android.invoke({ op, args })).value as T;
      if ('__TAURI_INTERNALS__' in window) return await (await import('@tauri-apps/api/core')).invoke<T>('import_stage', { op, args });
      throw new AppError('nativeRequired');
    } catch (error) { if (typeof error === 'string') throw new AppError(/^[a-zA-Z]+$/.test(error) ? error : 'fileError'); throw error; }
  };
  const info = await send<{ databaseName: string } | null>('prepare', { required });
  let db: DatabaseAdapter;
  try {
    if (isAndroid) db = await (await import('./android-database')).openAndroidDatabase(info!.databaseName);
    else {
      const session: SqlSession = {
        query: (sql, params = []) => send('query', { sql, params }), execute: (sql, params = []) => send('execute', { sql, params }),
        begin: () => send('begin'), commit: () => send('commit'), rollback: () => send('rollback'), close: () => send('close'),
        backup: async () => { throw new AppError('nativeRequired'); },
      };
      db = new SerialDatabase(session);
    }
  } catch (error) { await send('abort').catch(() => undefined); throw error; }
  return {
    db,
    files: {
      begin: id => send('file_begin', { id }),
      write: (id, offset, bytes) => {
        if (!isAndroid) return send('file_write', { id, offset, bytes: [...bytes] });
        let text = ''; for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
        return send('file_write', { id, offset, data: btoa(text) });
      },
      finish: (id, size, sha256) => send<FileFacts>('file_finish', { id, size, sha256 }),
    },
    async activate() { await db.close(); if (isAndroid) await send('seal'); await send('activate'); },
    async abort() { await db.close(); await send('abort'); },
  };
}
