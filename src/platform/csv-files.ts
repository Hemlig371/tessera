import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ArchiveWriter } from '../core/archive-zip';
import type { CsvWriter } from '../core/csv';
import { AppError } from '../core/errors';
interface NativeCsv {
  begin(options: { name: string; title: string; mime?: string }): Promise<{ cancelled?: boolean }>;
  write(options: { text: string }): Promise<void>;
  writeBytes(options: { data: string }): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}
const android = registerPlugin<NativeCsv>('CsvFiles');
/** Only file picker/bytes cross the native boundary. CSV and DB rules remain TypeScript. */
export async function chooseCsvWriter(name: string, title: string): Promise<CsvWriter | null> {
  let send: (op: 'write' | 'finish' | 'abort', text?: string) => Promise<void>;
  if (Capacitor.getPlatform() === 'android') {
    if ((await android.begin({ name, title })).cancelled) return null;
    send = (op, text) => (op === 'write' ? android.write({ text: text! }) : android[op]());
  } else if ('__TAURI_INTERNALS__' in window) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ title, defaultPath: name, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!path) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('csv_open', { path });
    send = (op, text) => invoke('csv_' + op, text == null ? {} : { text });
  } else throw new AppError('nativeRequired');
  return {
    async write(text) {
      // Bound native messages and never split a UTF-16 surrogate pair.
      for (let i = 0; i < text.length; ) {
        let end = Math.min(i + 32000, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
        await send('write', text.slice(i, end));
        i = end;
      }
    },
    finish: () => send('finish'),
    abort: () => send('abort'),
  };
}

/** Reuse the same private staging and native document picker for the single DB archive export. */
export async function chooseDatabaseArchiveWriter(title: string): Promise<ArchiveWriter | null> {
  const name = 'Tessera-' + new Date().toISOString().slice(0, 10) + '.zip';
  if (Capacitor.getPlatform() === 'android') {
    if ((await android.begin({ name, title, mime: 'application/zip' })).cancelled) return null;
    return {
      async write(bytes) {
        let text = ''; for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
        await android.writeBytes({ data: btoa(text) });
      },
      finish: () => android.finish(), abort: () => android.abort(),
    };
  }
  if ('__TAURI_INTERNALS__' in window) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ title, defaultPath: name, filters: [{ name: 'Tessera ZIP', extensions: ['zip'] }] });
    if (!path) return null;
    const { invoke } = await import('@tauri-apps/api/core'); await invoke('csv_open', { path });
    return { write: bytes => invoke('csv_write_bytes', { bytes: [...bytes] }), finish: () => invoke('csv_finish'), abort: () => invoke('csv_abort') };
  }
  throw new AppError('nativeRequired');
}

/** Desktop ICS uses the existing OS save dialog and atomic staged text writer. */
export async function chooseIcsWriter(name: string, title: string): Promise<CsvWriter | null> {
  if (!('__TAURI_INTERNALS__' in window)) throw new AppError('nativeRequired');
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ title, defaultPath: name, filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
  if (!path) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('csv_open', { path });
  return {
    write: text => invoke('csv_write', { text }),
    finish: () => invoke('csv_finish'),
    abort: () => invoke('csv_abort'),
  };
}
